import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'protocol_sync_loop.dart';
import 'session_sync.dart';

typedef ProtocolHeaderProvider = FutureOr<Map<String, String>> Function();

final class DartIoProtocolTransport implements ProtocolTransport {
  final Uri baseUri;
  final String pushPath;
  final String pullPath;
  final String snapshotPath;
  final ProtocolHeaderProvider? headers;
  final HttpClient Function() createClient;

  DartIoProtocolTransport({
    required this.baseUri,
    this.pushPath = 'push',
    this.pullPath = 'pull',
    this.snapshotPath = 'snapshot',
    this.headers,
    HttpClient Function()? createClient,
  }) : createClient = createClient ?? HttpClient.new;

  @override
  Future<ProtocolJson> push(
    ProtocolJson request,
    ProtocolCancellationToken cancellation,
  ) {
    return _request(
      baseUri.resolve(pushPath),
      method: 'POST',
      body: request,
      cancellation: cancellation,
    );
  }

  @override
  Future<ProtocolJson> pull(
    String checkpoint,
    int limit,
    ProtocolCancellationToken cancellation,
  ) {
    final endpoint = baseUri.resolve(pullPath);
    return _request(
      endpoint.replace(
        queryParameters: {
          ...endpoint.queryParameters,
          'checkpoint': checkpoint,
          'limit': '$limit',
        },
      ),
      method: 'GET',
      cancellation: cancellation,
    );
  }

  @override
  Future<ProtocolJson> snapshot(
    ProtocolCancellationToken cancellation, [
    ProtocolJson? reset,
  ]) {
    final supplied = reset?['snapshotUrl'];
    final endpoint = supplied is String
        ? baseUri.resolve(supplied)
        : baseUri.resolve(snapshotPath);
    return _request(endpoint, method: 'GET', cancellation: cancellation);
  }

  Future<ProtocolJson> _request(
    Uri uri, {
    required String method,
    required ProtocolCancellationToken cancellation,
    ProtocolJson? body,
  }) async {
    cancellation.throwIfCancelled();
    final client = createClient();
    try {
      final configured = await headers?.call() ?? const <String, String>{};
      cancellation.throwIfCancelled();
      final request = await client.openUrl(method, uri);
      request.headers.set(HttpHeaders.acceptHeader, ContentType.json.mimeType);
      configured.forEach(request.headers.set);
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      cancellation.throwIfCancelled();
      final response = await request.close();
      final responseBody = await utf8.decoder.bind(response).join();
      cancellation.throwIfCancelled();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw SyncTransportException(
          'sync endpoint returned HTTP ${response.statusCode}',
          retryable: _retryableStatus(response.statusCode),
          retryAfter: _retryAfter(response),
          code: 'HTTP_${response.statusCode}',
        );
      }
      final decoded = jsonDecode(responseBody);
      if (decoded is! Map || !decoded.keys.every((key) => key is String)) {
        throw const SyncTransportException(
          'sync endpoint returned invalid JSON',
          retryable: false,
          code: 'INVALID_JSON_RESPONSE',
        );
      }
      return Map<String, dynamic>.from(decoded);
    } on ProtocolSyncCancelled {
      rethrow;
    } on SyncSessionException catch (error) {
      throw SyncTransportException(
        error.message,
        retryable: error.retryable,
        code: error.code,
      );
    } on SyncTransportException {
      rethrow;
    } on FormatException catch (error) {
      throw SyncTransportException(
        'sync endpoint returned invalid JSON: $error',
        retryable: false,
        code: 'INVALID_JSON_RESPONSE',
      );
    } on Object catch (error) {
      throw SyncTransportException(
        '$error',
        retryable: true,
        code: 'NETWORK_ERROR',
      );
    } finally {
      client.close(force: cancellation.isCancelled);
    }
  }
}

bool _retryableStatus(int status) =>
    status == 408 || status == 425 || status == 429 || status >= 500;

Duration? _retryAfter(HttpClientResponse response) {
  final value = response.headers.value(HttpHeaders.retryAfterHeader);
  if (value == null) return null;
  final seconds = int.tryParse(value);
  if (seconds != null && seconds >= 0) return Duration(seconds: seconds);
  try {
    final date = HttpDate.parse(value);
    final delay = date.difference(DateTime.now().toUtc());
    return delay.isNegative ? Duration.zero : delay;
  } on FormatException {
    return null;
  }
}

/// Reconnecting WebSocket wake stream for native Dart/Flutter.
///
/// Frames are hints only. The protocol loop performs an ordered HTTP pull so a
/// frame lost while the process was suspended cannot create a permanent gap.
Stream<Object?> dartIoWebSocketSyncHints(
  Uri uri, {
  Iterable<String>? protocols,
  Map<String, dynamic>? headers,
  Duration retryBase = const Duration(milliseconds: 500),
  Duration retryMaximum = const Duration(seconds: 30),
  Object? Function(Object? frame)? decode,
  void Function(Object error, StackTrace stack)? onError,
  Random? random,
}) async* {
  var failures = 0;
  final jitter = random ?? Random.secure();
  while (true) {
    WebSocket? socket;
    try {
      socket = await WebSocket.connect(
        uri.toString(),
        protocols: protocols,
        headers: headers,
      );
      failures = 0;
      yield null;
      await for (final frame in socket) {
        yield decode?.call(frame) ?? frame;
      }
    } on Object catch (error, stack) {
      onError?.call(error, stack);
    } finally {
      await socket?.close();
    }
    failures++;
    final ceiling = min(
      retryMaximum.inMilliseconds,
      retryBase.inMilliseconds * pow(2, min(failures - 1, 30)),
    ).toInt();
    await Future<void>.delayed(
      Duration(milliseconds: (jitter.nextDouble() * ceiling).ceil()),
    );
  }
}

/// Reconnecting newline- or chunk-oriented TCP wake stream for native targets.
///
/// Raw TCP is not available to browsers or service workers. Use this only on a
/// trusted native network path (normally TLS via [SecureSocket.connect]) and
/// continue to treat bytes as wake hints rather than authoritative changes.
Stream<Uint8List> dartIoTcpSyncHints(
  String host,
  int port, {
  bool secure = true,
  Duration retryBase = const Duration(milliseconds: 500),
  Duration retryMaximum = const Duration(seconds: 30),
  void Function(Object error, StackTrace stack)? onError,
  Random? random,
}) async* {
  var failures = 0;
  final jitter = random ?? Random.secure();
  while (true) {
    Socket? socket;
    try {
      socket = secure
          ? await SecureSocket.connect(host, port)
          : await Socket.connect(host, port);
      failures = 0;
      yield Uint8List(0);
      await for (final bytes in socket) {
        yield Uint8List.fromList(bytes);
      }
    } on Object catch (error, stack) {
      onError?.call(error, stack);
    } finally {
      await socket?.close();
    }
    failures++;
    final ceiling = min(
      retryMaximum.inMilliseconds,
      retryBase.inMilliseconds * pow(2, min(failures - 1, 30)),
    ).toInt();
    await Future<void>.delayed(
      Duration(milliseconds: (jitter.nextDouble() * ceiling).ceil()),
    );
  }
}
