import 'dart:async';
import 'dart:io';

import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:opto_sync_client/transport_ws.dart';
import 'package:test/test.dart';

TypeMatcher<SyncTransportException> transportError(String code) =>
    isA<SyncTransportException>().having(
      (error) => error.code,
      'code',
      code,
    );

void main() {
  test('authenticated cleartext rejects public and ambiguous hostnames', () async {
    final dials = <String>[];

    Future<WebSocket> connect(String target) async {
      dials.add(target);
      throw StateError('connector reached');
    }

    for (final target in <String>[
      'ws://fcustomer.example.com/sync/ws',
      'ws://fdomain.example.com/sync/ws',
      'ws://fe80-public.example.com/sync/ws',
      'ws://sync-service/sync/ws',
      'ws://8.8.8.8/sync/ws',
      'ws://172.15.255.255/sync/ws',
      'ws://172.32.0.1/sync/ws',
      'ws://192.169.0.1/sync/ws',
      'ws://169.253.0.1/sync/ws',
      'ws://[2001:4860:4860::8888]/sync/ws',
    ]) {
      final transport = WebSocketProtocolTransport(
        url: target,
        auth: () => 'session-token',
        connect: connect,
      );
      await expectLater(
        transport.pull('0', 1, ProtocolCancellationToken()),
        throwsA(transportError('WS_CLEARTEXT_AUTH')),
        reason: target,
      );
      await transport.dispose();
    }

    final missingHost = WebSocketProtocolTransport(
      url: 'ws:///sync/ws',
      auth: () => 'session-token',
      connect: connect,
    );
    await expectLater(
      missingHost.pull('0', 1, ProtocolCancellationToken()),
      throwsA(transportError('WS_INVALID_URL')),
    );
    await missingHost.dispose();

    expect(dials, isEmpty);
  });

  test('authenticated cleartext retains explicit private targets', () async {
    final dials = <String>[];

    Future<WebSocket> connect(String target) async {
      dials.add(target);
      throw StateError('expected connector stop');
    }

    final targets = <String>[
      'ws://localhost/sync/ws',
      'ws://api.localhost/sync/ws',
      'ws://127.0.0.1/sync/ws',
      'ws://10.0.0.1/sync/ws',
      'ws://172.16.0.1/sync/ws',
      'ws://172.31.255.255/sync/ws',
      'ws://192.168.0.1/sync/ws',
      'ws://169.254.0.1/sync/ws',
      'ws://[::1]/sync/ws',
      'ws://[fc00::1]/sync/ws',
      'ws://[fd00::1]/sync/ws',
      'ws://[fe80::1]/sync/ws',
      'ws://sync.internal/sync/ws',
      'ws://sync.default.svc.cluster.local/sync/ws',
    ];

    for (final target in targets) {
      final transport = WebSocketProtocolTransport(
        url: target,
        auth: () => 'session-token',
        connect: connect,
      );
      await expectLater(
        transport.pull('0', 1, ProtocolCancellationToken()),
        throwsA(transportError('WS_DIAL_FAILED')),
        reason: target,
      );
      await transport.dispose();
    }

    expect(dials, hasLength(targets.length));
    for (final target in dials) {
      expect(target, contains('token=session-token'));
    }
  });

  test('transport security policy does not block public wss or no-token ws', () async {
    final dials = <String>[];

    Future<WebSocket> connect(String target) async {
      dials.add(target);
      throw StateError('expected connector stop');
    }

    final secure = WebSocketProtocolTransport(
      url: 'wss://example.com/sync/ws',
      auth: () => 'session-token',
      connect: connect,
    );
    await expectLater(
      secure.pull('0', 1, ProtocolCancellationToken()),
      throwsA(transportError('WS_DIAL_FAILED')),
    );
    await secure.dispose();

    final unauthenticated = WebSocketProtocolTransport(
      url: 'ws://example.com/sync/ws',
      connect: connect,
    );
    await expectLater(
      unauthenticated.pull('0', 1, ProtocolCancellationToken()),
      throwsA(transportError('WS_DIAL_FAILED')),
    );
    await unauthenticated.dispose();

    expect(dials, <String>[
      'wss://example.com/sync/ws?token=session-token',
      'ws://example.com/sync/ws',
    ]);
  });
}
