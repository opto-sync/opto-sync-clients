import test from 'node:test';
import assert from 'node:assert/strict';

import { Subject, firstValueFrom, take, toArray } from 'rxjs';

import {
  OptimismLevel,
  canonicalJson,
  createReactiveRecord$,
  createRemoteRefresh$,
  executeReactiveWrite,
} from '../dist/reactive.js';
import { FetchProtocolTransport } from '../dist/http-transport.js';
import {
  OPTO_SYNC_MESSAGE,
  installOptoSyncServiceWorker,
} from '../dist/service-worker.js';
import {
  createSupabaseSessionProvider,
  sessionAuthorizationHeaders,
  sessionDatabaseName,
} from '../dist/session.js';
import { CrossContextSyncCoordinator } from '../dist/cross-context.js';

test('reactive record stream merges sources, overlays local intent, and de-dupes', async () => {
  const indexedDb$ = new Subject();
  const http$ = new Subject();
  let pendingTitle = 'pending local';
  const client = {
    reconcileIncoming(_table, _id, incoming, existing) {
      return Number(incoming.updatedAt) >= Number(existing.updatedAt)
        ? { ...existing, ...incoming }
        : { ...incoming, ...existing };
    },
    async localView(_table, _id, authoritative) {
      return pendingTitle
        ? { ...authoritative, title: pendingTitle }
        : authoritative;
    },
  };

  const records$ = createReactiveRecord$({
    client,
    tableName: 'docs',
    recordId: 'r1',
    sources: [indexedDb$, http$],
  });
  const result = firstValueFrom(records$.pipe(take(2), toArray()));

  indexedDb$.next({
    tableName: 'docs',
    recordId: 'r1',
    source: 'indexeddb',
    record: { id: 'r1', title: 'cached', updatedAt: 1 },
  });
  // Same semantic document, different key order: it must not repaint the UI.
  http$.next({
    tableName: 'docs',
    recordId: 'r1',
    source: 'http',
    record: { updatedAt: 1, title: 'cached', id: 'r1' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  pendingTitle = '';
  http$.next({
    tableName: 'docs',
    recordId: 'r1',
    source: 'http',
    record: { id: 'r1', title: 'server', updatedAt: 2 },
  });

  assert.deepEqual(await result, [
    { id: 'r1', title: 'pending local', updatedAt: 1 },
    { id: 'r1', title: 'server', updatedAt: 2 },
  ]);
  assert.equal(
    canonicalJson({ z: 1, nested: { b: 2, a: 1 } }),
    canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }),
  );
});

test('realtime refresh aborts stale HTTP and emits only the latest response', async () => {
  const hints$ = new Subject();
  const requests = [];
  const refreshed$ = createRemoteRefresh$(hints$, ({ signal }) => {
    return new Promise((resolve, reject) => {
      const request = { resolve, signal };
      requests.push(request);
      signal.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
    });
  });
  const value = firstValueFrom(refreshed$);
  await new Promise((resolve) => setImmediate(resolve));
  hints$.next('websocket');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve({ revision: '2' });
  assert.deepEqual(await value, { revision: '2' });
});

test('each optimism level has an explicit durability/network boundary', async () => {
  const calls = [];
  const common = {
    remoteWrite: async () => {
      calls.push('remote');
      return 'server-row';
    },
    queueLocal: async () => {
      calls.push('local');
      return 7;
    },
    installRemote: async () => calls.push('install'),
    requestBackgroundSync: () => calls.push('background'),
    syncNow: async () => calls.push('sync-now'),
  };

  assert.deepEqual(
    await executeReactiveWrite({
      ...common,
      optimism: OptimismLevel.ServerConfirmed,
    }),
    { optimism: OptimismLevel.ServerConfirmed, remote: 'server-row' },
  );
  assert.deepEqual(calls.splice(0), ['remote', 'install']);

  assert.deepEqual(
    await executeReactiveWrite({
      ...common,
      optimism: OptimismLevel.DurableLocal,
    }),
    { optimism: OptimismLevel.DurableLocal, local: 7 },
  );
  assert.deepEqual(calls.splice(0), ['local', 'background']);

  await executeReactiveWrite({
    ...common,
    optimism: OptimismLevel.DurableLocalAndWait,
  });
  assert.deepEqual(calls, ['local', 'background', 'sync-now']);
});

test('fetch transport maps protocol URLs, auth, retryability, and Retry-After', async () => {
  const calls = [];
  const transport = new FetchProtocolTransport({
    baseUrl: 'https://sync.example.test/v1/',
    headers: async () => ({ authorization: 'Bearer fresh-token' }),
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({
        protocolVersion: 1,
        checkpoint: '0',
        changes: [],
        hasMore: false,
      });
    },
  });
  const pulled = await transport.pull('9007199254740993', 50, new AbortController().signal);
  assert.equal(pulled.checkpoint, '0');
  assert.equal(
    calls[0].url,
    'https://sync.example.test/v1/pull?checkpoint=9007199254740993&limit=50',
  );
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer fresh-token');

  const unavailable = new FetchProtocolTransport({
    fetch: async () =>
      new Response('busy', {
        status: 503,
        headers: { 'retry-after': '2' },
      }),
  });
  await assert.rejects(
    unavailable.snapshot(new AbortController().signal),
    (error) =>
      error.retryable === true &&
      error.retryAfterMs === 2000 &&
      error.code === 'HTTP_503',
  );
});

class FakeWorkerScope extends EventTarget {
  skipWaitingCalls = 0;
  claimCalls = 0;
  clients = {
    claim: async () => {
      this.claimCalls += 1;
    },
  };

  async skipWaiting() {
    this.skipWaitingCalls += 1;
  }
}

class FakeLifetimeEvent extends Event {
  pending = [];

  constructor(type, details = {}) {
    super(type);
    Object.assign(this, details);
  }

  waitUntil(promise) {
    this.pending.push(promise);
  }
}

test('service-worker runtime coalesces wakes and binds event lifetime', async () => {
  const scope = new FakeWorkerScope();
  const releases = [];
  let runs = 0;
  const runtime = installOptoSyncServiceWorker({
    scope,
    skipWaiting: true,
    claimClients: true,
    syncOnPush: true,
    runSync: async () => {
      runs += 1;
      await new Promise((resolve) => releases.push(resolve));
    },
  });

  const install = new FakeLifetimeEvent('install');
  scope.dispatchEvent(install);
  await Promise.all(install.pending);
  const activate = new FakeLifetimeEvent('activate');
  scope.dispatchEvent(activate);
  await Promise.all(activate.pending);
  assert.equal(scope.skipWaitingCalls, 1);
  assert.equal(scope.claimCalls, 1);

  const first = new FakeLifetimeEvent('message', {
    data: { type: OPTO_SYNC_MESSAGE },
  });
  const second = new FakeLifetimeEvent('push');
  scope.dispatchEvent(first);
  scope.dispatchEvent(second);
  assert.equal(runs, 1, 'overlapping wakeups share the active cycle');
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 2, 'one follow-up cycle preserves the overlapping hint');
  releases.shift()();
  await Promise.all([...first.pending, ...second.pending]);

  runtime.dispose();
});

test('Supabase sessions scope IndexedDB and resolve fresh auth lazily', async () => {
  const callbacks = new Set();
  const token = (sessionId) => {
    const payload = Buffer.from(JSON.stringify({ session_id: sessionId }))
      .toString('base64url');
    return `header.${payload}.signature`;
  };
  let session = {
    access_token: token('session-a'),
    expires_at: 2_000_000_000,
    user: { id: 'user-a' },
  };
  const auth = {
    async getSession() {
      return { data: { session } };
    },
    onAuthStateChange(callback) {
      callbacks.add(callback);
      return {
        data: {
          subscription: { unsubscribe: () => callbacks.delete(callback) },
        },
      };
    },
  };
  const provider = createSupabaseSessionProvider(auth);
  const initial = await provider.current();
  assert.equal(initial.scope, 'user-a:session-a');
  const databaseName = await sessionDatabaseName('app-sync', initial);
  assert.match(databaseName, /^app-sync-[a-f0-9]{24}$/);
  assert.equal(databaseName.includes('user-a'), false);

  session = { ...session, access_token: token('session-b') };
  const headers = await sessionAuthorizationHeaders(provider)();
  assert.equal(headers.get('authorization'), `Bearer ${session.access_token}`);

  const changed = firstValueFrom(provider.changes$.pipe(take(1)));
  callbacks.forEach((callback) => callback('TOKEN_REFRESHED', session));
  assert.equal((await changed).scope, 'user-a:session-b');
});

class FakeLockManager {
  busy = false;
  queue = [];

  request(_name, options, callback) {
    return new Promise((resolve, reject) => {
      const waiter = { options, callback, resolve, reject };
      this.queue.push(waiter);
      options.signal?.addEventListener('abort', () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) {
          this.queue.splice(index, 1);
          reject(new DOMException('aborted', 'AbortError'));
        }
      });
      this.pump();
    });
  }

  pump() {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;
    const waiter = this.queue.shift();
    Promise.resolve(waiter.callback({ name: 'opto-sync' }))
      .then(waiter.resolve, waiter.reject)
      .finally(() => {
        this.busy = false;
        this.pump();
      });
  }
}

function fakeLoop() {
  return {
    starts: 0,
    stops: 0,
    hints: 0,
    start() {
      this.starts += 1;
    },
    stop() {
      this.stops += 1;
    },
    hint() {
      this.hints += 1;
    },
  };
}

test('cross-window coordinator elects one loop and forwards follower hints', async () => {
  const locks = new FakeLockManager();
  const leaderLoop = fakeLoop();
  const followerLoop = fakeLoop();
  const namespace = `test-${crypto.randomUUID()}`;
  const leader = new CrossContextSyncCoordinator({
    namespace,
    loop: leaderLoop,
    locks,
  });
  const follower = new CrossContextSyncCoordinator({
    namespace,
    loop: followerLoop,
    locks,
  });
  leader.start();
  follower.start();
  assert.equal(leader.state.leader, true);
  assert.equal(follower.state.leader, false);
  assert.equal(leaderLoop.starts, 1);
  assert.equal(followerLoop.starts, 0);

  follower.hint();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(leaderLoop.hints, 1);

  await leader.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(follower.state.leader, true);
  assert.equal(followerLoop.starts, 1);
  await follower.stop();
});
