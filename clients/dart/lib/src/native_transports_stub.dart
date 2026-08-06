import 'dart:async';
import 'dart:math';
import 'dart:typed_data';

import 'protocol_sync_loop.dart';

typedef ProtocolHeaderProvider =
    FutureOr<Map<String, String>> Function();

/// Web stub for the native `dart:io` protocol transport.
final class DartIoProtocolTransport implements ProtocolTransport {
  DartIoProtocolTransport({
    required Uri baseUri,
    String pushPath = 'push',
    String pullPath = 'pull',
    String snapshotPath = 'snapshot',
    ProtocolHeaderProvider? headers,
    Object? Function()? createClient,
  }) {
    throw UnsupportedError(
      'DartIoProtocolTransport is unavailable on the web; use a '
      'service-worker/fetch transport',
    );
  }

  @override
  Future<ProtocolJson> push(
    ProtocolJson request,
    ProtocolCancellationToken cancellation,
  ) => throw UnsupportedError('dart:io is unavailable on the web');

  @override
  Future<ProtocolJson> pull(
    String checkpoint,
    int limit,
    ProtocolCancellationToken cancellation,
  ) => throw UnsupportedError('dart:io is unavailable on the web');

  @override
  Future<ProtocolJson> snapshot(
    ProtocolCancellationToken cancellation, [
    ProtocolJson? reset,
  ]) => throw UnsupportedError('dart:io is unavailable on the web');
}

Stream<Object?> dartIoWebSocketSyncHints(
  Uri uri, {
  Iterable<String>? protocols,
  Map<String, dynamic>? headers,
  Duration retryBase = const Duration(milliseconds: 500),
  Duration retryMaximum = const Duration(seconds: 30),
  Object? Function(Object? frame)? decode,
  void Function(Object error, StackTrace stack)? onError,
  Random? random,
}) => Stream<Object?>.error(
  UnsupportedError(
    'dart:io WebSocket is unavailable on the web; use the browser WebSocket',
  ),
);

Stream<Uint8List> dartIoTcpSyncHints(
  String host,
  int port, {
  bool secure = true,
  Duration retryBase = const Duration(milliseconds: 500),
  Duration retryMaximum = const Duration(seconds: 30),
  void Function(Object error, StackTrace stack)? onError,
  Random? random,
}) => Stream<Uint8List>.error(
  UnsupportedError('raw TCP is unavailable in browsers and service workers'),
);
