import assert from 'node:assert/strict';
import test from 'node:test';

import { WebSocketTransport } from '../dist/transport/ws.js';
import { SyncTransportError } from '../dist/sync-loop.js';

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }
  static instances = [];
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener() {}
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  reply(frame) {
    this.emit('message', { data: JSON.stringify(frame) });
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

function transport(overrides = {}) {
  FakeSocket.instances = [];
  return new WebSocketTransport({
    url: 'wss://example.test/sync/ws',
    webSocketFactory: (url) => new FakeSocket(url),
    requestTimeoutMs: 1_000,
    ...overrides,
  });
}

const signal = () => new AbortController().signal;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function firstSocket() {
  // dial() awaits the auth token before constructing the socket.
  for (let i = 0; i < 10 && FakeSocket.instances.length === 0; i += 1) {
    await tick();
  }
  return FakeSocket.instances[0];
}

test('push and pull correlate concurrent requests by requestId', async () => {
  const ws = transport();
  const pushPromise = ws.push({ protocolVersion: 1, clientId: 'c', mutations: [] }, signal());
  const pullPromise = ws.pull('0', 100, signal());
  // Both requests share the socket created by the first call.
  const socket = FakeSocket.instances[0];
  socket.open();
  await Promise.resolve();

  assert.equal(socket.sent.length, 2);
  const [pushFrame, pullFrame] = socket.sent;
  assert.equal(pushFrame.type, 'push');
  assert.equal(pushFrame.v, 1);
  assert.equal(pullFrame.type, 'pull');
  assert.equal(pullFrame.checkpoint, '0');
  assert.notEqual(pushFrame.requestId, pullFrame.requestId);

  // Answer out of order — correlation must hold.
  socket.reply({
    v: 1,
    type: 'pull-result',
    requestId: pullFrame.requestId,
    protocolVersion: 1,
    checkpoint: '5',
    hasMore: false,
    changes: [],
  });
  socket.reply({
    v: 1,
    type: 'push-result',
    requestId: pushFrame.requestId,
    protocolVersion: 1,
    lastMutationId: '3',
    results: [],
  });

  const pull = await pullPromise;
  const push = await pushPromise;
  assert.equal(pull.checkpoint, '5');
  assert.equal(push.lastMutationId, '3');
});

test('error frames reject with SyncTransportError carrying code and retryability', async () => {
  const ws = transport();
  const pending = ws.pull('0', 10, signal());
  const socket = FakeSocket.instances[0];
  socket.open();
  await Promise.resolve();
  socket.reply({
    v: 1,
    type: 'error',
    requestId: socket.sent[0].requestId,
    code: 'AUTH_EXPIRED',
    message: 'token expired',
    retryable: false,
  });
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof SyncTransportError);
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('unsolicited changed frames invoke onChanged with the watermark', async () => {
  const hints = [];
  const ws = transport({ onChanged: (watermark) => hints.push(watermark) });
  const pending = ws.pull('0', 10, signal());
  const socket = FakeSocket.instances[0];
  socket.open();
  await Promise.resolve();
  socket.reply({ v: 1, type: 'changed', watermark: 42 });
  socket.reply({
    v: 1,
    type: 'pull-result',
    requestId: socket.sent[0].requestId,
    protocolVersion: 1,
    checkpoint: '1',
    hasMore: false,
    changes: [],
  });
  await pending;
  assert.deepEqual(hints, [42]);
});

test('socket close rejects in-flight requests as retryable', async () => {
  const ws = transport();
  const pending = ws.pull('0', 10, signal());
  const socket = FakeSocket.instances[0];
  socket.open();
  await Promise.resolve();
  socket.close();
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof SyncTransportError);
    assert.equal(error.retryable, true);
    return true;
  });
});

test('aborting the signal rejects with AbortError (loop stop semantics)', async () => {
  const ws = transport();
  const controller = new AbortController();
  const pending = ws.pull('0', 10, controller.signal);
  FakeSocket.instances[0].open();
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});

test('dial failure falls back to the provided HTTP transport', async () => {
  const calls = [];
  const fallback = {
    push: async (request) => {
      calls.push('push');
      return { protocolVersion: 1, lastMutationId: '0', results: [], echo: request.clientId };
    },
    pull: async (checkpoint) => {
      calls.push(`pull:${checkpoint}`);
      return { protocolVersion: 1, checkpoint, hasMore: false, changes: [] };
    },
    snapshot: async () => {
      calls.push('snapshot');
      return { protocolVersion: 1, checkpoint: '0', records: [] };
    },
  };
  const ws = transport({
    webSocketFactory: () => {
      throw new Error('no network path');
    },
    fallback,
  });
  const pull = await ws.pull('7', 10, signal());
  assert.equal(pull.checkpoint, '7');
  const snapshot = await ws.snapshot(signal());
  assert.equal(snapshot.protocolVersion, 1);
  assert.deepEqual(calls, ['pull:7', 'snapshot']);
});

test('without a fallback a dial failure is a retryable transport error with backoff', async () => {
  const ws = transport({
    webSocketFactory: () => {
      throw new Error('refused');
    },
  });
  await assert.rejects(ws.pull('0', 10, signal()), (error) => {
    assert.ok(error instanceof SyncTransportError);
    assert.equal(error.retryable, true);
    assert.ok(error.retryAfterMs >= 0);
    return true;
  });
});

test('auth token is appended to the dial URL', async () => {
  const ws = transport({
    auth: { getToken: async () => 'session-token-123' },
  });
  const pending = ws.pull('0', 10, signal());
  await Promise.resolve();
  await Promise.resolve();
  const socket = FakeSocket.instances[0];
  assert.match(socket.url, /\?token=session-token-123$/);
  socket.open();
  await Promise.resolve();
  socket.reply({
    v: 1,
    type: 'pull-result',
    requestId: socket.sent[0].requestId,
    protocolVersion: 1,
    checkpoint: '0',
    hasMore: false,
    changes: [],
  });
  await pending;
});

test('request timeout produces a retryable WS_TIMEOUT error', async () => {
  const ws = transport({ requestTimeoutMs: 10 });
  const pending = ws.pull('0', 10, signal());
  FakeSocket.instances[0].open();
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'WS_TIMEOUT');
    assert.equal(error.retryable, true);
    return true;
  });
});
