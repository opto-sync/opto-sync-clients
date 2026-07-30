import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { Duplex } from 'node:stream';
import test from 'node:test';

import { BehaviorSubject, firstValueFrom, take } from 'rxjs';

import {
  createWebSocketHints$,
  transportSessionKey,
} from '../src/index.ts';
import type { SyncSession } from '../src/index.ts';

const identity = {
  shared_user_id: 'user-real-ws',
  provider: 'shared-auth',
  provider_tenant: 'test-app',
  provider_subject: 'subject-real-ws',
  session_id: 'session-real-ws',
};

function textFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length >= 126) {
    throw new RangeError('test WebSocket frame must fit the short length form');
  }
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

test('WebSocket hint source receives a real RFC6455 text frame', async () => {
  const sockets = new Set<Duplex>();
  const server = createServer();
  server.on('upgrade', (request, socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    const key = request.headers['sec-websocket-key'];
    assert.equal(typeof key, 'string');
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );
    socket.write(
      textFrame({
        table: 'todos',
        recordId: 'todo-real-ws',
        checkpoint: '91',
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const sessions = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  try {
    const hint = await firstValueFrom(
      createWebSocketHints$({
        session$: sessions,
        url: () => `ws://127.0.0.1:${address.port}/opto-sync`,
        retryBaseMs: 10,
        retryMaxMs: 50,
      }).pipe(take(1)),
    );
    assert.deepEqual(hint, {
      table: 'todos',
      recordId: 'todo-real-ws',
      checkpoint: '91',
      reason: 'remote-change',
      source: 'websocket',
      sessionPartition: transportSessionKey(identity),
    });
  } finally {
    sessions.complete();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
