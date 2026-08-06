import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:opto_sync_client/transport_ws.dart';
import 'package:test/test.dart';

/// Minimal in-process /sync/ws server speaking the shared frame contract.
class _WsServer {
  _WsServer(this.server);

  final HttpServer server;
  final List<WebSocket> sockets = [];
  final List<Map<String, dynamic>> received = [];
  Map<String, dynamic> Function(Map<String, dynamic> frame)? responder;
  Uri? lastUri;

  static Future<_WsServer> start() async {
    final http = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final wrapper = _WsServer(http);
    http.listen((request) async {
      wrapper.lastUri = request.uri;
      final socket = await WebSocketTransformer.upgrade(request);
      wrapper.sockets.add(socket);
      socket.listen((data) {
        final frame = jsonDecode(data as String) as Map<String, dynamic>;
        wrapper.received.add(frame);
        final respond = wrapper.responder;
        if (respond != null) {
          socket.add(jsonEncode(respond(frame)));
        }
      });
    });
    return wrapper;
  }

  String get url => 'ws://${server.address.host}:${server.port}/sync/ws';

  void broadcast(Map<String, dynamic> frame) {
    for (final socket in sockets) {
      socket.add(jsonEncode(frame));
    }
  }

  Future<void> close() async {
    for (final socket in sockets) {
      await socket.close();
    }
    await server.close(force: true);
  }
}

void main() {
  late _WsServer server;

  setUp(() async {
    server = await _WsServer.start();
  });

  tearDown(() => server.close());

  test(
    'pull round-trips through result frames with requestId correlation',
    () async {
      server.responder = (frame) => {
        'v': 1,
        'type': 'pull-result',
        'requestId': frame['requestId'],
        'protocolVersion': 1,
        'checkpoint': '5',
        'hasMore': false,
        'changes': <Object>[],
      };
      final transport = WebSocketProtocolTransport(url: server.url);
      final result = await transport.pull(
        '0',
        100,
        ProtocolCancellationToken(),
      );
      expect(result['checkpoint'], '5');
      expect(server.received.single['type'], 'pull');
      expect(server.received.single['checkpoint'], '0');
      expect(server.received.single['limit'], 100);
      expect(server.received.single['v'], 1);
      await transport.dispose();
    },
  );

  test('push sends the request body and unwraps the result envelope', () async {
    server.responder = (frame) => {
      'v': 1,
      'type': 'push-result',
      'requestId': frame['requestId'],
      'protocolVersion': 1,
      'lastMutationId': '3',
      'results': <Object>[],
    };
    final transport = WebSocketProtocolTransport(url: server.url);
    final response = await transport.push({
      'protocolVersion': 1,
      'clientId': 'c-1',
      'mutations': <Object>[],
    }, ProtocolCancellationToken());
    expect(response['lastMutationId'], '3');
    expect(response.containsKey('type'), isFalse);
    expect(server.received.single['clientId'], 'c-1');
    await transport.dispose();
  });

  test(
    'error frames become SyncTransportException with code and retryability',
    () async {
      server.responder = (frame) => {
        'v': 1,
        'type': 'error',
        'requestId': frame['requestId'],
        'code': 'AUTH_EXPIRED',
        'message': 'token expired',
        'retryable': false,
      };
      final transport = WebSocketProtocolTransport(url: server.url);
      await expectLater(
        transport.pull('0', 10, ProtocolCancellationToken()),
        throwsA(
          isA<SyncTransportException>()
              .having((e) => e.code, 'code', 'AUTH_EXPIRED')
              .having((e) => e.retryable, 'retryable', false),
        ),
      );
      await transport.dispose();
    },
  );

  test('unsolicited changed frames invoke onChanged', () async {
    final hints = <num>[];
    server.responder = (frame) => {
      'v': 1,
      'type': 'pull-result',
      'requestId': frame['requestId'],
      'protocolVersion': 1,
      'checkpoint': '1',
      'hasMore': false,
      'changes': <Object>[],
    };
    final transport = WebSocketProtocolTransport(
      url: server.url,
      onChanged: hints.add,
    );
    await transport.pull('0', 10, ProtocolCancellationToken());
    server.broadcast({'v': 1, 'type': 'changed', 'watermark': 42});
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(hints, [42]);
    await transport.dispose();
  });

  test('auth token is appended to the dial URL', () async {
    server.responder = (frame) => {
      'v': 1,
      'type': 'pull-result',
      'requestId': frame['requestId'],
      'protocolVersion': 1,
      'checkpoint': '0',
      'hasMore': false,
      'changes': <Object>[],
    };
    final transport = WebSocketProtocolTransport(
      url: server.url,
      auth: () async => 'session-token-123',
    );
    await transport.pull('0', 10, ProtocolCancellationToken());
    expect(server.lastUri?.queryParameters['token'], 'session-token-123');
    await transport.dispose();
  });

  test(
    'dial failure without fallback throws retryable WS_DIAL_FAILED with backoff',
    () async {
      final transport = WebSocketProtocolTransport(
        url: 'ws://127.0.0.1:1/sync/ws', // nothing listens on port 1
      );
      await expectLater(
        transport.pull('0', 10, ProtocolCancellationToken()),
        throwsA(
          isA<SyncTransportException>()
              .having((e) => e.code, 'code', 'WS_DIAL_FAILED')
              .having((e) => e.retryable, 'retryable', true)
              .having((e) => e.retryAfter, 'retryAfter', isNotNull),
        ),
      );
      await transport.dispose();
    },
  );

  test('dial failure falls back to the provided transport', () async {
    final calls = <String>[];
    final transport = WebSocketProtocolTransport(
      url: 'ws://127.0.0.1:1/sync/ws',
      fallback: _FakeTransport(calls),
    );
    final result = await transport.pull('7', 10, ProtocolCancellationToken());
    expect(result['checkpoint'], '7');
    expect(calls, ['pull:7']);
    await transport.dispose();
  });

  test('request timeout surfaces as retryable WS_TIMEOUT', () async {
    server.responder = null; // never answer
    final transport = WebSocketProtocolTransport(
      url: server.url,
      requestTimeout: const Duration(milliseconds: 100),
    );
    await expectLater(
      transport.pull('0', 10, ProtocolCancellationToken()),
      throwsA(
        isA<SyncTransportException>().having(
          (e) => e.code,
          'code',
          'WS_TIMEOUT',
        ),
      ),
    );
    await transport.dispose();
  });
}

class _FakeTransport implements ProtocolTransport {
  _FakeTransport(this.calls);

  final List<String> calls;

  @override
  Future<Map<String, dynamic>> push(
    Map<String, dynamic> request,
    ProtocolCancellationToken cancellation,
  ) async {
    calls.add('push');
    return {'protocolVersion': 1, 'lastMutationId': '0', 'results': <Object>[]};
  }

  @override
  Future<Map<String, dynamic>> pull(
    String checkpoint,
    int limit,
    ProtocolCancellationToken cancellation,
  ) async {
    calls.add('pull:$checkpoint');
    return {
      'protocolVersion': 1,
      'checkpoint': checkpoint,
      'hasMore': false,
      'changes': <Object>[],
    };
  }

  @override
  Future<Map<String, dynamic>> snapshot(
    ProtocolCancellationToken cancellation, [
    Map<String, dynamic>? reset,
  ]) async {
    calls.add('snapshot');
    return {'protocolVersion': 1, 'checkpoint': '0', 'records': <Object>[]};
  }
}
