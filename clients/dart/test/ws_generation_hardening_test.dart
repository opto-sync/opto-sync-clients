import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:opto_sync_client/transport_ws.dart';
import 'package:test/test.dart';

final class _Server {
  _Server(this.http);

  final HttpServer http;
  final List<WebSocket> sockets = <WebSocket>[];
  void Function(WebSocket socket, Map<String, dynamic> frame)? onFrame;

  static Future<_Server> start() async {
    final http = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final server = _Server(http);
    http.listen((request) async {
      final socket = await WebSocketTransformer.upgrade(request);
      server.sockets.add(socket);
      socket.listen((data) {
        if (data is! String) return;
        final decoded = jsonDecode(data) as Map<String, dynamic>;
        server.onFrame?.call(socket, decoded);
      });
    });
    return server;
  }

  String get url => 'ws://${http.address.host}:${http.port}/sync/ws';

  Future<void> close() async {
    for (final socket in sockets) {
      await socket.close();
    }
    await http.close(force: true);
  }
}

TypeMatcher<SyncTransportException> transportError(
  String code, {
  bool? retryable,
}) {
  var matcher = isA<SyncTransportException>().having(
    (error) => error.code,
    'code',
    code,
  );
  if (retryable != null) {
    matcher = matcher.having(
      (error) => error.retryable,
      'retryable',
      retryable,
    );
  }
  return matcher;
}

void main() {
  late _Server server;

  setUp(() async {
    server = await _Server.start();
  });

  tearDown(() => server.close());

  test(
    'dispose cancels an unresolved dial and fences its late socket',
    () async {
      final dial = Completer<WebSocket>();
      final transport = WebSocketProtocolTransport(
        url: server.url,
        connect: (_) => dial.future,
        requestTimeout: const Duration(seconds: 1),
      );

      final pending = transport.pull('0', 10, ProtocolCancellationToken());
      final rejection = expectLater(
        pending,
        throwsA(transportError('WS_DISPOSED', retryable: false)),
      );
      await Future<void>.delayed(Duration.zero);
      await transport.dispose();
      await rejection;

      final lateSocket = await WebSocket.connect(server.url);
      dial.complete(lateSocket);
      for (
        var attempt = 0;
        attempt < 50 && lateSocket.readyState == WebSocket.open;
        attempt += 1
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      expect(lateSocket.readyState, isNot(WebSocket.open));
    },
  );

  test('dial timeout is bounded and invalidates the late generation', () async {
    final dial = Completer<WebSocket>();
    final transport = WebSocketProtocolTransport(
      url: server.url,
      connect: (_) => dial.future,
      requestTimeout: const Duration(milliseconds: 30),
    );

    await expectLater(
      transport.pull('0', 10, ProtocolCancellationToken()),
      throwsA(transportError('WS_DIAL_TIMEOUT')),
    );
    final lateSocket = await WebSocket.connect(server.url);
    dial.complete(lateSocket);
    for (
      var attempt = 0;
      attempt < 50 && lateSocket.readyState == WebSocket.open;
      attempt += 1
    ) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(lateSocket.readyState, isNot(WebSocket.open));
    await transport.dispose();
  });

  test('authentication and connector failures are redacted', () async {
    final authFailure = WebSocketProtocolTransport(
      url: server.url,
      auth: () => throw StateError('secret-jwt-value'),
    );
    await expectLater(
      authFailure.pull('0', 10, ProtocolCancellationToken()),
      throwsA(
        transportError('WS_AUTH_FAILED').having(
          (error) => error.message,
          'message',
          isNot(contains('secret-jwt-value')),
        ),
      ),
    );
    await authFailure.dispose();

    final connectorFailure = WebSocketProtocolTransport(
      url: server.url,
      connect: (_) => throw StateError('secret-url-or-token'),
    );
    await expectLater(
      connectorFailure.pull('0', 10, ProtocolCancellationToken()),
      throwsA(
        transportError('WS_DIAL_FAILED').having(
          (error) => error.message,
          'message',
          isNot(contains('secret-url-or-token')),
        ),
      ),
    );
    await connectorFailure.dispose();
  });

  test('authenticated public cleartext and fragment URLs never dial', () async {
    var dials = 0;
    Future<WebSocket> connect(String _) async {
      dials += 1;
      throw StateError('must not dial');
    }

    final cleartext = WebSocketProtocolTransport(
      url: 'ws://example.com/sync/ws',
      auth: () => 'session-token',
      connect: connect,
    );
    await expectLater(
      cleartext.pull('0', 10, ProtocolCancellationToken()),
      throwsA(transportError('WS_CLEARTEXT_AUTH', retryable: false)),
    );
    await cleartext.dispose();

    final fragment = WebSocketProtocolTransport(
      url: 'wss://example.com/sync/ws#shadow-token',
      auth: () => 'session-token',
      connect: connect,
    );
    await expectLater(
      fragment.pull('0', 10, ProtocolCancellationToken()),
      throwsA(transportError('WS_INVALID_URL', retryable: false)),
    );
    await fragment.dispose();
    expect(dials, 0);
  });

  test('response type confusion fails the owning generation', () async {
    server.onFrame = (socket, frame) {
      socket.add(
        jsonEncode({
          'v': 1,
          'type': 'push-result',
          'requestId': frame['requestId'],
          'protocolVersion': 1,
          'lastMutationId': '0',
          'results': <Object>[],
        }),
      );
    };
    final transport = WebSocketProtocolTransport(url: server.url);

    await expectLater(
      transport.pull('0', 10, ProtocolCancellationToken()),
      throwsA(transportError('WS_PROTOCOL_MISMATCH', retryable: false)),
    );
    await transport.dispose();
  });

  test(
    'binary responses fail the owning generation as non-retryable',
    () async {
      server.onFrame = (socket, _) {
        socket.add(<int>[1, 2, 3]);
      };
      final transport = WebSocketProtocolTransport(url: server.url);

      await expectLater(
        transport.pull('0', 10, ProtocolCancellationToken()),
        throwsA(transportError('WS_BINARY_FRAME', retryable: false)),
      );
      await transport.dispose();
    },
  );
}
