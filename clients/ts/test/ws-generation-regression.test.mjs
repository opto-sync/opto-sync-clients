import assert from 'node:assert/strict';
import test from 'node:test';

import { WebSocketTransport } from '../dist/transport/ws.js';

class DialSocket {
  readyState = 0;
  listeners = new Map();
  sent = [];

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  send(data) {
    this.sent.push(JSON.parse(String(data)));
  }

  reply(frame) {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code, reason, wasClean: code === 1000 });
  }
}

const signal = () => new AbortController().signal;

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition timed out');
}

test('concurrent protocol requests share exactly one dial generation', async () => {
  const sockets = [];
  const transport = new WebSocketTransport({
    url: 'wss://example.test/sync/ws',
    webSocketFactory: () => {
      const socket = new DialSocket();
      sockets.push(socket);
      return socket;
    },
    requestTimeoutMs: 1_000,
  });

  const first = transport.pull('0', 10, signal());
  const second = transport.pull('0', 10, signal());
  await waitUntil(() => sockets.length === 1);
  sockets[0].open();
  await waitUntil(() => sockets[0].sent.length === 2);

  assert.equal(sockets.length, 1);
  assert.notEqual(sockets[0].sent[0].requestId, sockets[0].sent[1].requestId);
  for (const request of sockets[0].sent) {
    sockets[0].reply({
      v: 1,
      type: 'pull-result',
      requestId: request.requestId,
      protocolVersion: 1,
      checkpoint: '1',
      hasMore: false,
      changes: [],
    });
  }

  assert.equal((await first).checkpoint, '1');
  assert.equal((await second).checkpoint, '1');
  transport.dispose();
});
