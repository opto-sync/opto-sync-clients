/// WebSocket implementation of [ProtocolTransport] (native platforms).
///
/// Wire contract (shared with the reference node server and the TS client —
/// do not deviate):
/// - endpoint `/sync/ws`, JSON text frames, one JSON object per frame;
/// - client→server `{"v":1,"type":"push"|"pull"|"snapshot","requestId":"<unique>", ...body}`;
/// - server→client `{"v":1,"type":"<type>-result","requestId",...body}`,
///   `{"v":1,"type":"error","requestId","code","message","retryable?"}`, and
///   the unsolicited pull hint `{"v":1,"type":"changed","watermark":<num>}`.
///
/// Uses `dart:io`; browsers should use the JS client or a `package:web`
/// transport. Hints reach the app through [onChanged], which should call
/// `ProtocolSyncLoop.hint()` — a hint is a wake-up, never data.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import '../protocol_sync_loop.dart';

/// Pluggable session source (Supabase session, shared-auth, ...). The token
/// is appended as a `token` query parameter at dial time, so an expired
/// token picks up its replacement on the next reconnect.
typedef AuthTokenProvider = FutureOr<String?> Function();

const _maxInboundFrameBytes = 32 * 1024 * 1024;
const _maxSafeJavascriptInteger = 9007199254740991;
const _resultTypeByRequest = <String, String>{
  'push': 'push-result',
  'pull': 'pull-result',
  'snapshot': 'snapshot-result',
};
const _resultTypes = <String>{'push-result', 'pull-result', 'snapshot-result'};
const _credentialQueryKeys = <String>{
  'access_token',
  'apikey',
  'authorization',
  'ticket',
  'token',
};

final class _Connection {
  const _Connection(this.socket, this.generation);

  final WebSocket socket;
  final int generation;
}

final class _PendingRequest {
  const _PendingRequest({
    required this.generation,
    required this.expectedType,
    required this.completer,
  });

  final int generation;
  final String expectedType;
  final Completer<Map<String, dynamic>> completer;
}

class WebSocketProtocolTransport implements ProtocolTransport {
  WebSocketProtocolTransport({
    required this.url,
    this.auth,
    this.onChanged,
    this.fallback,
    this.requestTimeout = const Duration(seconds: 20),
    this.reconnectBase = const Duration(milliseconds: 500),
    this.reconnectMax = const Duration(seconds: 30),
    FutureOr<WebSocket> Function(String url)? connect,
    Random? random,
  }) : _connect = connect ?? WebSocket.connect,
       _random = random ?? Random() {
    if (requestTimeout <= Duration.zero) {
      throw ArgumentError.value(
        requestTimeout,
        'requestTimeout',
        'must be positive',
      );
    }
    if (reconnectBase <= Duration.zero || reconnectMax < reconnectBase) {
      throw ArgumentError('invalid websocket reconnect policy');
    }
  }

  final String url;
  final AuthTokenProvider? auth;
  final void Function(num watermark)? onChanged;

  /// Used when the socket cannot be established (typically the HTTP
  /// transport) and preferred for large snapshot downloads.
  final ProtocolTransport? fallback;
  final Duration requestTimeout;
  final Duration reconnectBase;
  final Duration reconnectMax;

  final FutureOr<WebSocket> Function(String url) _connect;
  final Random _random;
  final Map<String, _PendingRequest> _pending = {};
  final Completer<void> _disposeSignal = Completer<void>();
  _Connection? _connection;
  Future<_Connection>? _connecting;
  int _socketGeneration = 0;
  int _nextRequestId = 0;
  int _consecutiveDialFailures = 0;
  bool _disposed = false;
  late final String _seed = _random.nextInt(1 << 30).toRadixString(36);

  @override
  Future<Map<String, dynamic>> push(
    Map<String, dynamic> request,
    ProtocolCancellationToken cancellation,
  ) => _request('push', request, cancellation);

  @override
  Future<Map<String, dynamic>> pull(
    String checkpoint,
    int limit,
    ProtocolCancellationToken cancellation,
  ) => _request('pull', {
    'checkpoint': checkpoint,
    'limit': limit,
  }, cancellation);

  @override
  Future<Map<String, dynamic>> snapshot(
    ProtocolCancellationToken cancellation, [
    Map<String, dynamic>? reset,
  ]) {
    final delegate = fallback;
    if (delegate != null) return delegate.snapshot(cancellation, reset);
    return _request('snapshot', const {}, cancellation);
  }

  /// Closes the active socket, cancels a dial, and permanently fails requests.
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _socketGeneration += 1;
    if (!_disposeSignal.isCompleted) _disposeSignal.complete();
    _failPending(
      const SyncTransportException(
        'transport disposed',
        retryable: false,
        code: 'WS_DISPOSED',
      ),
    );
    final active = _connection;
    _connection = null;
    if (active != null) {
      await _closeSocket(active.socket, 1000, 'dispose');
    }
  }

  Future<Map<String, dynamic>> _request(
    String type,
    Map<String, dynamic> body,
    ProtocolCancellationToken cancellation,
  ) async {
    if (_disposed) throw _disposedError();
    cancellation.throwIfCancelled();

    _Connection connection;
    try {
      connection = await _ensureConnection();
    } on SyncTransportException {
      final delegate = fallback;
      if (delegate == null || _disposed) rethrow;
      return switch (type) {
        'push' => delegate.push(body, cancellation),
        'pull' => delegate.pull(
          body['checkpoint'] as String,
          body['limit'] as int,
          cancellation,
        ),
        _ => delegate.snapshot(cancellation),
      };
    }
    cancellation.throwIfCancelled();
    if (!_isActive(connection)) {
      throw const SyncTransportException(
        'websocket closed before request send',
        code: 'WS_CLOSED',
      );
    }

    final requestId = '$_seed-${++_nextRequestId}';
    final completer = Completer<Map<String, dynamic>>();
    _pending[requestId] = _PendingRequest(
      generation: connection.generation,
      expectedType: _resultTypeByRequest[type]!,
      completer: completer,
    );
    try {
      connection.socket.add(
        jsonEncode({'v': 1, 'type': type, 'requestId': requestId, ...body}),
      );
    } catch (_) {
      _pending.remove(requestId);
      _failConnection(
        connection.socket,
        connection.generation,
        const SyncTransportException(
          'websocket send failed',
          code: 'WS_SEND_FAILED',
        ),
        1011,
        'send failed',
      );
      throw const SyncTransportException(
        'websocket send failed',
        code: 'WS_SEND_FAILED',
      );
    }

    try {
      return await completer.future.timeout(requestTimeout);
    } on TimeoutException {
      throw const SyncTransportException(
        'websocket request timed out',
        code: 'WS_TIMEOUT',
      );
    } finally {
      final current = _pending[requestId];
      if (identical(current?.completer, completer)) {
        _pending.remove(requestId);
      }
    }
  }

  Future<_Connection> _ensureConnection() {
    if (_disposed) return Future.error(_disposedError());
    final current = _connection;
    if (current != null && _isActive(current)) return Future.value(current);
    final existing = _connecting;
    if (existing != null) return existing;

    final generation = ++_socketGeneration;
    late final Future<_Connection> task;
    task = _dial(generation).whenComplete(() {
      if (identical(_connecting, task)) _connecting = null;
    });
    _connecting = task;
    return task;
  }

  Future<_Connection> _dial(int generation) async {
    String? token;
    try {
      token = await auth?.call();
    } catch (_) {
      _invalidateGeneration(generation);
      throw _dialFailure(
        'websocket authentication token lookup failed',
        'WS_AUTH_FAILED',
      );
    }
    if (_disposed || generation != _socketGeneration) throw _disposedError();

    final target = _validatedTarget(token);
    final connectAttempt = Future<WebSocket>.sync(() => _connect(target));
    unawaited(
      connectAttempt.then((socket) async {
        if (_disposed || generation != _socketGeneration) {
          await _closeSocket(socket, 1000, 'superseded dial');
        }
      }, onError: (_) {}),
    );

    final WebSocket socket;
    try {
      socket = await Future.any<WebSocket>([
        connectAttempt.timeout(requestTimeout),
        _disposeSignal.future.then<WebSocket>((_) => throw _disposedError()),
      ]);
    } on TimeoutException {
      _invalidateGeneration(generation);
      throw _dialFailure('websocket dial timed out', 'WS_DIAL_TIMEOUT');
    } on SyncTransportException {
      _invalidateGeneration(generation);
      rethrow;
    } catch (_) {
      _invalidateGeneration(generation);
      throw _dialFailure('websocket dial failed', 'WS_DIAL_FAILED');
    }

    if (_disposed || generation != _socketGeneration) {
      await _closeSocket(socket, 1000, 'superseded dial');
      throw _disposedError();
    }

    _consecutiveDialFailures = 0;
    final connection = _Connection(socket, generation);
    _connection = connection;
    socket.listen(
      (data) => _onFrame(data, socket, generation),
      onDone: () => _onClosed(socket, generation),
      onError: (Object _) => _failConnection(
        socket,
        generation,
        const SyncTransportException(
          'websocket connection error',
          code: 'WS_SOCKET_ERROR',
        ),
        1011,
        'connection error',
      ),
      cancelOnError: false,
    );
    return connection;
  }

  String _validatedTarget(String? token) {
    final Uri parsed;
    try {
      parsed = Uri.parse(url);
    } catch (_) {
      throw const SyncTransportException(
        'invalid websocket URL',
        retryable: false,
        code: 'WS_INVALID_URL',
      );
    }
    if (parsed.scheme != 'ws' && parsed.scheme != 'wss') {
      throw const SyncTransportException(
        'websocket URL must use ws or wss',
        retryable: false,
        code: 'WS_INVALID_URL',
      );
    }
    if (parsed.userInfo.isNotEmpty || parsed.fragment.isNotEmpty) {
      throw const SyncTransportException(
        'websocket URL must not embed credentials or fragments',
        retryable: false,
        code: 'WS_INVALID_URL',
      );
    }
    if (token == null || token.isEmpty) return url;
    if (token.trim() != token) {
      throw const SyncTransportException(
        'websocket authentication token is not normalized',
        retryable: false,
        code: 'WS_INVALID_TOKEN',
      );
    }
    for (final key in parsed.queryParametersAll.keys) {
      if (_credentialQueryKeys.contains(key.toLowerCase())) {
        throw const SyncTransportException(
          'websocket URL already contains a credential query parameter',
          retryable: false,
          code: 'WS_INVALID_URL',
        );
      }
    }
    if (parsed.scheme == 'ws' && !_internalHostAllowed(parsed.host)) {
      throw const SyncTransportException(
        'refusing to send a session token over a public cleartext websocket',
        retryable: false,
        code: 'WS_CLEARTEXT_AUTH',
      );
    }
    final separator = url.contains('?') ? '&' : '?';
    return '$url${separator}token=${Uri.encodeQueryComponent(token)}';
  }

  bool _internalHostAllowed(String host) {
    final normalized = host.toLowerCase();
    if (normalized.isEmpty ||
        normalized == 'localhost' ||
        normalized.endsWith('.localhost') ||
        normalized == '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        RegExp(r'^fe[89ab]').hasMatch(normalized)) {
      return true;
    }
    final octets = normalized.split('.').map(int.tryParse).toList();
    if (octets.length == 4 && octets.every((value) => value != null)) {
      final a = octets[0]!;
      final b = octets[1]!;
      return a == 127 ||
          a == 10 ||
          (a == 172 && b >= 16 && b <= 31) ||
          (a == 192 && b == 168) ||
          (a == 169 && b == 254);
    }
    return !normalized.contains('.') ||
        normalized.endsWith('.svc.cluster.local') ||
        normalized.endsWith('.internal');
  }

  SyncTransportException _dialFailure(String message, String code) {
    _consecutiveDialFailures += 1;
    final retryAfter = computeProtocolRetryDelay(
      min(_consecutiveDialFailures, 20),
      base: reconnectBase,
      maximum: reconnectMax,
      random: _random.nextDouble,
    );
    return SyncTransportException(message, retryAfter: retryAfter, code: code);
  }

  SyncTransportException _disposedError() => const SyncTransportException(
    'transport disposed',
    retryable: false,
    code: 'WS_DISPOSED',
  );

  void _invalidateGeneration(int generation) {
    if (_socketGeneration == generation) _socketGeneration += 1;
  }

  bool _owns(WebSocket socket, int generation) {
    final active = _connection;
    return !_disposed &&
        generation == _socketGeneration &&
        active?.generation == generation &&
        identical(active?.socket, socket);
  }

  bool _isActive(_Connection connection) =>
      !_disposed &&
      connection.generation == _socketGeneration &&
      identical(_connection, connection) &&
      connection.socket.readyState == WebSocket.open;

  void _onClosed(WebSocket socket, int generation) {
    if (!_owns(socket, generation)) return;
    _connection = null;
    _invalidateGeneration(generation);
    _failPending(
      const SyncTransportException('websocket closed', code: 'WS_CLOSED'),
      generation,
    );
  }

  void _failConnection(
    WebSocket socket,
    int generation,
    SyncTransportException error,
    int closeCode,
    String closeReason,
  ) {
    if (!_owns(socket, generation)) return;
    _connection = null;
    _invalidateGeneration(generation);
    _failPending(error, generation);
    unawaited(_closeSocket(socket, closeCode, closeReason));
  }

  void _failPending(SyncTransportException error, [int? generation]) {
    final requestIds = _pending.entries
        .where(
          (entry) => generation == null || entry.value.generation == generation,
        )
        .map((entry) => entry.key)
        .toList(growable: false);
    for (final requestId in requestIds) {
      final waiter = _pending.remove(requestId)?.completer;
      if (waiter != null && !waiter.isCompleted) waiter.completeError(error);
    }
  }

  Future<void> _closeSocket(WebSocket socket, int code, String reason) async {
    try {
      await socket.close(code, reason);
    } catch (_) {
      // Generation ownership, not provider close success, is authoritative.
    }
  }

  void _onFrame(dynamic data, WebSocket socket, int generation) {
    if (!_owns(socket, generation)) return;
    if (data is! String) {
      _failConnection(
        socket,
        generation,
        const SyncTransportException(
          'websocket protocol requires text frames',
          retryable: false,
          code: 'WS_BINARY_FRAME',
        ),
        1003,
        'text frames required',
      );
      return;
    }
    if (utf8.encode(data).length > _maxInboundFrameBytes) {
      _failConnection(
        socket,
        generation,
        const SyncTransportException(
          'websocket frame exceeds the protocol limit',
          retryable: false,
          code: 'WS_FRAME_TOO_LARGE',
        ),
        1009,
        'frame too large',
      );
      return;
    }

    final Object? decoded;
    try {
      decoded = jsonDecode(data);
    } on FormatException {
      return;
    }
    if (decoded is! Map<String, dynamic> || decoded['v'] != 1) return;

    if (decoded['type'] == 'changed') {
      final watermark = decoded['watermark'];
      if (watermark is int &&
          watermark >= 0 &&
          watermark <= _maxSafeJavascriptInteger) {
        try {
          onChanged?.call(watermark);
        } catch (_) {
          // Hints are best-effort and cannot break entity synchronization.
        }
      }
      return;
    }

    final requestId = decoded['requestId'];
    if (requestId is! String) return;
    final pending = _pending[requestId];
    if (pending == null ||
        pending.generation != generation ||
        pending.completer.isCompleted) {
      return;
    }

    final type = decoded['type'];
    if (type == 'error') {
      _pending.remove(requestId);
      pending.completer.completeError(
        SyncTransportException(
          decoded['message'] is String
              ? decoded['message'] as String
              : 'sync websocket error',
          retryable: decoded['retryable'] != false,
          code: decoded['code'] is String
              ? decoded['code'] as String
              : 'WS_ERROR',
        ),
      );
      return;
    }
    if (type != pending.expectedType) {
      if (type is String && _resultTypes.contains(type)) {
        _failConnection(
          socket,
          generation,
          SyncTransportException(
            'websocket response type does not match ${pending.expectedType}',
            retryable: false,
            code: 'WS_PROTOCOL_MISMATCH',
          ),
          1002,
          'response type mismatch',
        );
      }
      return;
    }

    _pending.remove(requestId);
    pending.completer.complete(
      Map<String, dynamic>.from(decoded)
        ..remove('v')
        ..remove('type')
        ..remove('requestId'),
    );
  }
}
