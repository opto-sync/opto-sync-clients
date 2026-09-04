import 'dart:async';

import 'package:rxdart/rxdart.dart';

import 'ridl_frame.dart';

/// A framed bidirectional link — a WebSocket or a TCP socket — carrying ridl
/// frames as wire strings. Abstracted so the transport can be driven by a fake
/// in tests without opening a socket.
abstract interface class RidlChannel {
  /// Inbound frames, one wire string per frame.
  Stream<String> get frames;

  void send(String frame);

  Future<void> close();
}

/// Raised when the peer closes an exchange with an `error` frame.
class RidlRpcError implements Exception {
  RidlRpcError({required this.id, required this.code, this.message});

  final String id;
  final String code;
  final String? message;

  @override
  String toString() =>
      'RidlRpcError($code${message == null ? '' : ': $message'})';
}

/// Raised when the link drops while an exchange is still open.
class RidlChannelClosed implements Exception {
  RidlChannelClosed(this.id);

  final String id;

  @override
  String toString() => 'RidlChannelClosed(exchange $id was still open)';
}

/// Speaks the v2 ridl frame protocol over a [RidlChannel].
///
/// The frame protocol is already stream-shaped — `call` opens an exchange,
/// `data` carries zero or more payloads, `end` closes it, `error` fails it,
/// `cancel` abandons it — so one exchange maps exactly onto one Dart stream,
/// with no correlation map to leak. Cancelling the subscription sends a
/// `cancel` frame, which is the whole reason to model it this way: the peer
/// stops producing when the UI stops listening.
class RidlRpcTransport {
  RidlRpcTransport({
    required RidlChannel channel,
    String Function()? nextId,
    Map<String, Object?> Function()? metaFor,
  })  : _channel = channel,
        _nextId = nextId,
        _metaFor = metaFor {
    _inbound = _channel.frames.map(RidlFrame.decode).share();
    _inboundDone = _inbound.listen(
      null,
      onError: (Object _, StackTrace __) {},
      onDone: () => _closed = true,
      cancelOnError: false,
    );
  }

  final RidlChannel _channel;
  final String Function()? _nextId;
  final Map<String, Object?> Function()? _metaFor;

  late final Stream<RidlFrame> _inbound;
  StreamSubscription<RidlFrame>? _inboundDone;
  int _counter = 0;
  bool _closed = false;

  String _allocateId() => _nextId?.call() ?? '${++_counter}';

  /// Opens an exchange and returns its payloads.
  ///
  /// The returned stream completes on `end`, errors with [RidlRpcError] on
  /// `error`, and errors with [RidlChannelClosed] if the link drops first.
  /// Cancelling it sends `cancel` upstream.
  Stream<Object?> call({
    required String key,
    required String method,
    required String path,
    List<List<String>>? query,
    Object? body,
    bool hasBody = false,
    Map<String, Object?>? meta,
  }) {
    final id = _allocateId();
    late StreamController<Object?> controller;
    StreamSubscription<RidlFrame>? sub;
    var settled = false;

    Future<void> stop({bool cancelPeer = false}) async {
      if (cancelPeer && !settled && !_closed) {
        try {
          _channel.send(RidlFrame.cancel(id: id).encode());
        } catch (_) {
          // link already gone; nothing to abandon
        }
      }
      settled = true;
      await sub?.cancel();
      sub = null;
    }

    controller = StreamController<Object?>(
      onListen: () {
        sub = _inbound.where((f) => f.id == id).listen(
          (frame) {
            switch (frame.type) {
              case RidlFrameType.data:
                controller.add(frame.body);
                break;
              case RidlFrameType.end:
                settled = true;
                controller.close();
                break;
              case RidlFrameType.error:
                settled = true;
                controller.addError(RidlRpcError(
                  id: id,
                  code: frame.code ?? 'unknown',
                  message: frame.message,
                ));
                controller.close();
                break;
              case RidlFrameType.cancel:
                // The peer abandoned it; close quietly rather than erroring.
                settled = true;
                controller.close();
                break;
              case RidlFrameType.call:
                // A call frame addressed to our own id is a protocol fault.
                settled = true;
                controller.addError(RidlRpcError(
                  id: id,
                  code: 'protocol',
                  message: 'unexpected call frame on an open exchange',
                ));
                controller.close();
                break;
            }
          },
          onError: controller.addError,
          onDone: () {
            if (!settled) {
              controller.addError(RidlChannelClosed(id));
            }
            controller.close();
          },
        );

        try {
          _channel.send(RidlFrame.call(
            id: id,
            key: key,
            method: method,
            path: path,
            query: query,
            body: body,
            hasBody: hasBody,
            meta: meta ?? _metaFor?.call(),
          ).encode());
        } catch (error, stack) {
          controller.addError(error, stack);
          controller.close();
        }
      },
      onCancel: () => stop(cancelPeer: true),
    );

    return controller.stream;
  }

  /// A call expected to yield exactly one payload — the unary case.
  ///
  /// Errors if the exchange ends without one, rather than returning null,
  /// so a silently empty response cannot be mistaken for a null result.
  Future<Object?> unary({
    required String key,
    required String method,
    required String path,
    List<List<String>>? query,
    Object? body,
    bool hasBody = false,
    Map<String, Object?>? meta,
  }) {
    return call(
      key: key,
      method: method,
      path: path,
      query: query,
      body: body,
      hasBody: hasBody,
      meta: meta,
    ).first;
  }

  Future<void> dispose() async {
    await _inboundDone?.cancel();
    _inboundDone = null;
    await _channel.close();
  }
}
