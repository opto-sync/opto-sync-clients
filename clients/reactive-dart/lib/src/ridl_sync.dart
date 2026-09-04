import 'dart:async';

import 'contracts.dart';
import 'optimism.dart';
import 'ridl_rpc.dart';

/// Adapters joining the ridl RPC transport to the optimism layer.
///
/// [writeWithOptimism] already knows the three strategies; what it needs from a
/// caller is a [RemoteConfirmedWriter] that can actually reach the server, and
/// a record stream to feed [ReactiveRecordController]. Those are the two seams
/// filled here, so a Flutter app supplies only its own local store.

/// Writes a value over ridl RPC and returns the server's authoritative version.
///
/// Plugged into [writeWithOptimism] as the `remote` argument. Under
/// `SyncOptimism.remoteConfirmed` the UI waits for this; under `localDurable`
/// and `localThenRemote` the local commit lands first and this settles later.
class RidlRemoteWriter<T> implements RemoteConfirmedWriter<T> {
  RidlRemoteWriter({
    required RidlRpcTransport transport,
    required String routeKey,
    required String path,
    required Map<String, Object?> Function(T value) encode,
    required T Function(Object? payload) decode,
    String method = 'POST',
    Map<String, Object?> Function()? meta,
  })  : _transport = transport,
        _routeKey = routeKey,
        _path = path,
        _encode = encode,
        _decode = decode,
        _method = method,
        _meta = meta;

  final RidlRpcTransport _transport;
  final String _routeKey;
  final String _path;
  final String _method;
  final Map<String, Object?> Function(T value) _encode;
  final T Function(Object? payload) _decode;
  final Map<String, Object?> Function()? _meta;

  @override
  Future<T> write(T value) async {
    final payload = await _transport.unary(
      key: _routeKey,
      method: _method,
      path: _path,
      body: _encode(value),
      hasBody: true,
      meta: _meta?.call(),
    );
    return _decode(payload);
  }
}

/// Builds a [SyncRecordSource] from a long-lived ridl exchange.
///
/// The server holds the exchange open and emits a `data` frame per change; the
/// stream ends on `end` and fails on `error`. Because the subscription owns the
/// exchange, a screen that stops listening sends `cancel` and the server stops
/// producing — the backpressure story the frame protocol was designed for.
///
/// [decodeEvent] receives one `data` payload and the identity it arrived under,
/// and returns the event, or null to drop the frame (heartbeats, acks).
SyncRecordSource<T> ridlRecordSource<T>({
  required String name,
  required RidlRpcTransport transport,
  required String routeKey,
  required String path,
  required SyncRecordEvent<T>? Function(
    Object? payload,
    SyncSessionIdentity identity,
  ) decodeEvent,
  String method = 'GET',
  List<List<String>> Function(SyncSessionIdentity identity)? query,
  Map<String, Object?> Function(SyncSessionIdentity identity)? meta,
}) {
  return SyncRecordSource<T>(
    name: name,
    events: (identity) {
      return transport
          .call(
            key: routeKey,
            method: method,
            path: path,
            query: query?.call(identity),
            meta: meta?.call(identity),
          )
          .map((payload) => decodeEvent(payload, identity))
          .where((event) => event != null)
          .cast<SyncRecordEvent<T>>();
    },
  );
}

/// Drives a foreground sync cycle over ridl RPC.
///
/// [hint] is deliberately fire-and-forget: it tells the server work is waiting
/// without making the UI await a round trip, which is what makes the optimistic
/// path feel immediate. [syncNow] is the awaited cycle.
class RidlForegroundSync implements ForegroundSyncCycle<Object?> {
  RidlForegroundSync({
    required RidlRpcTransport transport,
    required String hintRouteKey,
    required String hintPath,
    required String syncRouteKey,
    required String syncPath,
    void Function(Object error, StackTrace stackTrace)? onHintError,
  })  : _transport = transport,
        _hintRouteKey = hintRouteKey,
        _hintPath = hintPath,
        _syncRouteKey = syncRouteKey,
        _syncPath = syncPath,
        _onHintError = onHintError;

  final RidlRpcTransport _transport;
  final String _hintRouteKey;
  final String _hintPath;
  final String _syncRouteKey;
  final String _syncPath;
  final void Function(Object error, StackTrace stackTrace)? _onHintError;

  @override
  void hint() {
    unawaited(
      _transport
          .unary(key: _hintRouteKey, method: 'POST', path: _hintPath)
          .catchError((Object error, StackTrace stack) {
        // A dropped hint is recoverable: the next syncNow or background wake
        // still carries the queued work. Surface it, do not fail the write.
        _onHintError?.call(error, stack);
        return null;
      }),
    );
  }

  @override
  Future<Object?> syncNow() => _transport.unary(
        key: _syncRouteKey,
        method: 'POST',
        path: _syncPath,
      );
}
