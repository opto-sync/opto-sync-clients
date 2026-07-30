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
       _random = random ?? Random();

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
  final Map<String, Completer<Map<String, dynamic>>> _pending = {};
  WebSocket? _socket;
  Future<WebSocket>? _connecting;
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
  ) => _request('pull', {'checkpoint': checkpoint, 'limit': limit}, cancellation);

  @override
  Future<Map<String, dynamic>> snapshot(
    ProtocolCancellationToken cancellation, [
    Map<String, dynamic>? reset,
  ]) {
    final delegate = fallback;
    if (delegate != null) return delegate.snapshot(cancellation, reset);
    return _request('snapshot', const {}, cancellation);
  }

  /// Closes the socket and fails all in-flight requests.
  Future<void> dispose() async {
    _disposed = true;
    _failAllPending(
      const SyncTransportException('transport disposed', retryable: false),
    );
    await _socket?.close(1000, 'dispose');
    _socket = null;
  }

  Future<Map<String, dynamic>> _request(
    String type,
    Map<String, dynamic> body,
    ProtocolCancellationToken cancellation,
  ) async {
    if (_disposed) {
      throw const SyncTransportException('transport disposed', retryable: false);
    }
    cancellation.throwIfCancelled();

    WebSocket socket;
    try {
      socket = await _ensureSocket();
    } on SyncTransportException {
      final delegate = fallback;
      if (delegate == null) rethrow;
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

    final requestId = '$_seed-${++_nextRequestId}';
    final completer = Completer<Map<String, dynamic>>();
    _pending[requestId] = completer;
    try {
      socket.add(jsonEncode({'v': 1, 'type': type, 'requestId': requestId, ...body}));
    } catch (error) {
      _pending.remove(requestId);
      throw SyncTransportException(
        'websocket send failed: $error',
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
      _pending.remove(requestId);
    }
  }

  Future<WebSocket> _ensureSocket() {
    final current = _socket;
    if (current != null && current.readyState == WebSocket.open) {
      return Future.value(current);
    }
    return _connecting ??= _dial().whenComplete(() => _connecting = null);
  }

  Future<WebSocket> _dial() async {
    var target = url;
    final token = await auth?.call();
    if (token != null && token.isNotEmpty) {
      final separator = target.contains('?') ? '&' : '?';
      target = '$target$separator'
          'token=${Uri.encodeQueryComponent(token)}';
    }
    final WebSocket socket;
    try {
      socket = await _connect(target);
    } catch (error) {
      _consecutiveDialFailures += 1;
      final retryAfter = computeProtocolRetryDelay(
        min(_consecutiveDialFailures, 20),
        base: reconnectBase,
        maximum: reconnectMax,
        random: _random.nextDouble,
      );
      throw SyncTransportException(
        'websocket dial failed: $error',
        retryAfter: retryAfter,
        code: 'WS_DIAL_FAILED',
      );
    }
    _consecutiveDialFailures = 0;
    _socket = socket;
    socket.listen(
      _onFrame,
      onDone: () {
        if (identical(_socket, socket)) _socket = null;
        _failAllPending(
          const SyncTransportException('websocket closed', code: 'WS_CLOSED'),
        );
      },
      onError: (Object _) {
        // onDone follows and carries the terminal handling.
      },
      cancelOnError: false,
    );
    return socket;
  }

  void _failAllPending(SyncTransportException error) {
    final waiters = List.of(_pending.values);
    _pending.clear();
    for (final waiter in waiters) {
      if (!waiter.isCompleted) waiter.completeError(error);
    }
  }

  void _onFrame(dynamic data) {
    if (data is! String) return;
    final Object? decoded;
    try {
      decoded = jsonDecode(data);
    } on FormatException {
      return; // one malformed broadcast must not kill the connection
    }
    if (decoded is! Map<String, dynamic> || decoded['v'] != 1) return;

    if (decoded['type'] == 'changed') {
      final watermark = decoded['watermark'];
      if (watermark is num) {
        try {
          onChanged?.call(watermark);
        } catch (_) {
          // hints are best-effort
        }
      }
      return;
    }

    final requestId = decoded['requestId'];
    if (requestId is! String) return;
    final waiter = _pending.remove(requestId);
    if (waiter == null || waiter.isCompleted) return;

    switch (decoded['type']) {
      case 'error':
        waiter.completeError(
          SyncTransportException(
            decoded['message'] is String
                ? decoded['message'] as String
                : 'sync websocket error',
            retryable: decoded['retryable'] != false,
            code: decoded['code'] is String ? decoded['code'] as String : 'WS_ERROR',
          ),
        );
      case 'push-result' || 'pull-result' || 'snapshot-result':
        waiter.complete(
          Map<String, dynamic>.from(decoded)
            ..remove('v')
            ..remove('type')
            ..remove('requestId'),
        );
      default:
        _pending[requestId] = waiter; // unknown frame: keep waiting
    }
  }
}
