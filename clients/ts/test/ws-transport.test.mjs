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
    this.closeCode = undefined;
    this.closeReason = undefined;
    FakeSocket.instances.push(this);
  }
  static instances = [];
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      listeners.filter((candidate) => candidate !== listener),
    );
  }
  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
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
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3;
    this.emit('close', { code, reason, wasClean: code === 1000 });
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
async function firstSocket(index = 0) {
  // dial() awaits the auth token before constructing the socket.
  for (let i = 0; i < 20 && FakeSocket.instances.length <= index; i += 1) {
    await tick();
  }
  const socket = FakeSocket.instances[index];
  assert.ok(socket, `expected socket ${index}`);
  return socket;
}

test('push and pull correlate concurrent requests by requestId', async () => {
  const ws = transport();
  const pushPromise = ws.push(
    { protocolVersion: 1, clientId: 'c', mutations: [] },
    signal(),
  );
  const pullPromise = ws.pull('0', 100, signal());
  // Both requests share the socket created by the first call.
  const socket = await firstSocket();
  socket.open();
  await tick();

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
  const socket = await firstSocket();
  socket.open();
  await tick();
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

test('unsolicited changed frames invoke onChanged with a safe watermark', async () => {
  const hints = [];
  const ws = transport({ onChanged: (watermark) => hints.push(watermark) });
  const pending = ws.pull('0', 10, signal());
  const socket = await firstSocket();
  socket.open();
  await tick();
  socket.reply({ v: 1, type: 'changed', watermark: -1 });
  socket.reply({ v: 1, type: 'changed', watermark: 1.5 });
  socket.reply({
    v: 1,
    type: 'changed',
    watermark: Number.MAX_SAFE_INTEGER + 1,
  });
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
  const socket = await firstSocket();
  socket.open();
  await tick();
  socket.close();
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof SyncTransportError);
    assert.equal(error.retryable, true);
    return true;
  });
});

test('stale socket callbacks cannot settle or reject a replacement generation', async () => {
  const ws = transport();
  const first = ws.pull('0', 10, signal());
  const socket1 = await firstSocket(0);
  socket1.open();
  await tick();
  const staleMessage = socket1.listeners.get('message')[0];
  const staleClose = socket1.listeners.get('close')[0];
  socket1.close(1012, 'worker rotation');
  await assert.rejects(first, (error) => error.code === 'WS_CLOSED');

  let secondSettled = false;
  const second = ws.pull('0', 10, signal()).finally(() => {
    secondSettled = true;
  });
  const socket2 = await firstSocket(1);
  socket2.open();
  await tick();
  const secondRequest = socket2.sent[0];

  staleClose({ code: 1012, reason: 'delayed close' });
  staleMessage({
    data: JSON.stringify({
      v: 1,
      type: 'pull-result',
      requestId: secondRequest.requestId,
      protocolVersion: 1,
      checkpoint: 'stale',
      hasMore: false,
      changes: [],
    }),
  });
  await tick();
  assert.equal(secondSettled, false);

  socket2.reply({
    v: 1,
    type: 'pull-result',
    requestId: secondRequest.requestId,
    protocolVersion: 1,
    checkpoint: 'fresh',
    hasMore: false,
    changes: [],
  });
  assert.equal((await second).checkpoint, 'fresh');
});

test('aborting the signal rejects with AbortError (loop stop semantics)', async () => {
  const ws = transport();
  const controller = new AbortController();
  const pending = ws.pull('0', 10, controller.signal);
  (await firstSocket()).open();
  await tick();
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});

test('dispose cancels a dial and fences a delayed open callback', async () => {
  const ws = transport();
  const pending = ws.pull('0', 10, signal());
  const socket = await firstSocket();
  ws.dispose();

  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof SyncTransportError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /disposed/);
    return true;
  });

  socket.open();
  await tick();
  assert.equal(socket.readyState, 3);
  assert.equal(socket.sent.length, 0);
});

test('dial timeout is bounded and produces WS_DIAL_TIMEOUT', async () => {
  const ws = transport({ requestTimeoutMs: 10 });
  const pending = ws.pull('0', 10, signal());
  const socket = await firstSocket();

  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof SyncTransportError);
    assert.equal(error.code, 'WS_DIAL_TIMEOUT');
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(socket.readyState, 3);
  assert.equal(socket.closeReason, 'dial timeout');
});

test('response type mismatch closes the generation without cross-settling', async () => {
  const ws = transport();
  const pending = ws.pull('0', 10, signal());
  const socket = await firstSocket();
  socket.open();
  await tick();
  socket.reply({
    v: 1,
    type: 'push-result',
    requestId: socket.sent[0].requestId,
    protocolVersion: 1,
    lastMutationId: '0',
    results: [],
  });

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'WS_PROTOCOL_MISMATCH');
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(socket.readyState, 3);
  assert.equal(socket.closeCode, 1002);
});

test('oversized and binary inbound frames close the owning generation', async () => {
  const oversized = transport();
  const first = oversized.pull('0', 10, signal());
  const socket1 = await firstSocket();
  socket1.open();
  await tick();
  socket1.emit('message', { data: 'x'.repeat(32 * 1024 * 1024 + 1) });
  await assert.rejects(first, (error) => {
    assert.equal(error.code, 'WS_FRAME_TOO_LARGE');
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(socket1.closeCode, 1009);

  const binary = transport();
  const second = binary.pull('0', 10, signal());
  const socket2 = await firstSocket();
  socket2.open();
  await tick();
  socket2.emit('message', { data: new Uint8Array([1, 2, 3]) });
  await assert.rejects(second, (error) => {
    assert.equal(error.code, 'WS_BINARY_FRAME');
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(socket2.closeCode, 1003);
});

test('post-open socket error rejects only the owning generation', async () => {
  const ws = transport();
  const pending = ws.pull('0', 10, signal());
  const socket = await firstSocket();
  socket.open();
  await tick();
  socket.emit('error');

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'WS_SOCKET_ERROR');
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(socket.readyState, 3);
});

test('dial failure falls back to the provided HTTP transport', async () => {
  const calls = [];
  const fallback = {
    push: async (request) => {
      calls.push('push');
      return {
        protocolVersion: 1,
        lastMutationId: '0',
        results: [],
        echo: request.clientId,
      };
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

test('authentication provider failures are redacted', async () => {
  const ws = transport({
    auth: {
      getToken: async () => {
        throw new Error('secret-token-value from provider');
      },
    },
  });
  await assert.rejects(ws.pull('0', 10, signal()), (error) => {
    assert.equal(error.code, 'WS_AUTH_FAILED');
    assert.doesNotMatch(error.message, /secret-token-value/);
    return true;
  });
});

test('auth token is appended to the dial URL', async () => {
  const ws = transport({
    auth: { getToken: async () => 'session-token-123' },
  });
  const pending = ws.pull('0', 10, signal());
  const socket = await firstSocket();
  assert.match(socket.url, /\?token=session-token-123$/);
  socket.open();
  await tick();
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

test('authenticated websocket URLs reject fragments', async () => {
  const ws = transport({
    url: 'wss://example.test/sync/ws#credential-shadow',
    auth: { getToken: async () => 'session-token-123' },
  });
  await assert.rejects(ws.pull('0', 10, signal()), (error) => {
    assert.equal(error.code, 'WS_INVALID_URL');
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(FakeSocket.instances.length, 0);
});

test('request timeout produces a retryable WS_TIMEOUT error', async () => {
  const ws = transport({ requestTimeoutMs: 10 });
  const pending = ws.pull('0', 10, signal());
  (await firstSocket()).open();
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'WS_TIMEOUT');
    assert.equal(error.retryable, true);
    return true;
  });
});
