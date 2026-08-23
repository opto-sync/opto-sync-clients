import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BehaviorSubject,
  Subject,
  VirtualTimeScheduler,
  firstValueFrom,
  take,
} from 'rxjs';

import {
  createBroadcastHintBus,
  createSupabaseHints$,
  createSyncWakePipeline,
  createWebSocketHints$,
  transportSessionKey,
} from '../src/index.ts';
import type { SyncHint, SyncSession } from '../src/index.ts';

const identity = {
  shared_user_id: 'user-1',
  provider: 'supabase',
  provider_tenant: 'project-a',
  provider_subject: 'subject-1',
  session_id: 'session-a',
};

class FakeSocket {
  listeners = new Map<string, Set<(event: any) => void>>();
  closed = false;

  addEventListener(type: string, listener: (event: any) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close() {
    this.closed = true;
  }
}

test('WebSocket hints rotate with session_id and never carry authority', async () => {
  const sessions = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  const sockets: FakeSocket[] = [];
  const hints: SyncHint[] = [];
  const subscription = createWebSocketHints$({
    session$: sessions,
    url: (current) => `ws://127.0.0.1/${current.session_id}`,
    create: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  }).subscribe((hint) => hints.push(hint));
  assert.equal(sockets.length, 1);
  sockets[0].emit('message', {
    data: JSON.stringify({
      table: 'todos',
      recordId: 'todo-1',
      checkpoint: '7',
    }),
  });

  const rotated = { ...identity, session_id: 'session-b' };
  sessions.next({ status: 'authenticated', identity: rotated });
  assert.equal(sockets[0].closed, true);
  assert.equal(sockets.length, 2);
  sockets[1].emit('message', {
    data: JSON.stringify({
      table: 'todos',
      recordId: 'todo-2',
      checkpoint: '8',
    }),
  });
  await Promise.resolve();
  assert.deepEqual(
    hints.map((hint) => ({
      source: hint.source,
      recordId: hint.recordId,
      partition: hint.sessionPartition,
    })),
    [
      {
        source: 'websocket',
        recordId: 'todo-1',
        partition: transportSessionKey(identity),
      },
      {
        source: 'websocket',
        recordId: 'todo-2',
        partition: transportSessionKey(rotated),
      },
    ],
  );
  subscription.unsubscribe();
  sessions.complete();
});

class FakeSupabaseChannel {
  callback?: (payload: unknown) => void;
  status?: (status: string, error?: unknown) => void;
  unsubscribed = false;

  on(
    _type: string,
    _filter: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ) {
    this.callback = callback;
    return this;
  }

  subscribe(callback?: (status: string, error?: unknown) => void) {
    this.status = callback;
    return this;
  }

  unsubscribe() {
    this.unsubscribed = true;
  }
}

test('Supabase Realtime is exposed only as a session-bound protocol wake hint', async () => {
  const sessions = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  const channel = new FakeSupabaseChannel();
  const promise = firstValueFrom(
    createSupabaseHints$({
      session$: sessions,
      channel: () => channel,
      filter: { event: '*', schema: 'public', table: 'todos' },
      decode: () => ({
        table: 'todos',
        recordId: 'todo-1',
        checkpoint: '12',
      }),
    }).pipe(take(1)),
  );
  channel.callback?.({ new: { id: 'todo-1' } });
  assert.deepEqual(await promise, {
    reason: 'remote-change',
    source: 'supabase',
    sessionPartition: transportSessionKey(identity),
    table: 'todos',
    recordId: 'todo-1',
    checkpoint: '12',
  });
  sessions.complete();
});

test('custom live decoders cannot override source, reason, or session ownership', async () => {
  const sessions = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  const socket = new FakeSocket();
  const received = firstValueFrom(
    createWebSocketHints$({
      session$: sessions,
      url: () => 'ws://127.0.0.1/hints',
      create: () => socket,
      decode: () => ({ table: 'todos', recordId: 'safe' }),
    }).pipe(take(1)),
  );
  socket.emit('message', { data: 'ignored by custom decoder' });
  assert.deepEqual(await received, {
    table: 'todos',
    recordId: 'safe',
    reason: 'remote-change',
    source: 'websocket',
    sessionPartition: transportSessionKey(identity),
  });
  sessions.complete();
});

test('wake pipeline uses virtual time, serializes ownership, and preserves a trailing wake', async () => {
  const hints = new Subject<SyncHint>();
  const scheduler = new VirtualTimeScheduler();
  let cycles = 0;
  let active = 0;
  let maxActive = 0;
  const outcomes: unknown[] = [];
  const releases: Array<() => void> = [];
  const subscription = createSyncWakePipeline({
    hints: [hints],
    coalesceMs: 5,
    scheduler,
    syncNow: () => new Promise<number>((resolve) => {
      cycles += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      const result = cycles;
      releases.push(() => {
        active -= 1;
        resolve(result);
      });
    }),
  }).subscribe((outcome) => outcomes.push(outcome));
  const hint: SyncHint = {
    reason: 'local-mutation',
    source: 'local',
    sessionPartition: transportSessionKey(identity),
  };
  hints.next(hint);
  hints.next({ ...hint, source: 'websocket' });
  hints.next({ ...hint, source: 'supabase' });
  scheduler.flush();
  assert.equal(cycles, 1);
  hints.next({ ...hint, source: 'broadcast' });
  scheduler.flush();
  assert.equal(cycles, 1, 'the trailing wake waits for the active owner');
  releases.shift()?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cycles, 2);
  releases.shift()?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cycles, 2, 'a wake arriving during the first cycle is not lost');
  assert.equal(outcomes.length, 2);
  assert.equal(maxActive, 1, 'protocol cycles never overlap');
  subscription.unsubscribe();
});

test('WebSocket retry is finite, scheduler-controlled, redacted, and leak-free', () => {
  const sessions = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  const scheduler = new VirtualTimeScheduler();
  const sockets: FakeSocket[] = [];
  const errors: Error[] = [];
  const subscription = createWebSocketHints$({
    session$: sessions,
    url: () => 'ws://127.0.0.1/hints',
    create: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    retryBaseMs: 10,
    retryMaxMs: 20,
    retryAttempts: 2,
    retryScheduler: scheduler,
  }).subscribe({ error: (error) => errors.push(error as Error) });

  sockets[0].emit('close', { code: 1011, reason: 'credential-in-reason' });
  scheduler.flush();
  assert.equal(sockets.length, 2);
  sockets[1].emit('close', { code: 1012, reason: 'tenant-in-reason' });
  scheduler.flush();
  assert.equal(sockets.length, 3);
  sockets[2].emit('close', { code: 1013, reason: 'payload-in-reason' });

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /code=1013/);
  assert.doesNotMatch(errors[0].message, /credential|tenant|payload/);
  assert.equal(sockets.every((socket) => socket.closed), true);
  assert.equal(
    sockets.every((socket) =>
      [...socket.listeners.values()].every((listeners) => listeners.size === 0),
    ),
    true,
  );
  assert.equal(scheduler.actions.length, 0);

  subscription.unsubscribe();
  sessions.complete();
});

test('BroadcastChannel bus sanitizes metadata for local and remote tabs', async () => {
  class Channel {
    static channels = new Map<string, Set<Channel>>();
    readonly name: string;
    listeners = new Set<(event: { data: unknown }) => void>();

    constructor(name: string) {
      this.name = name;
      const peers = Channel.channels.get(name) ?? new Set();
      peers.add(this);
      Channel.channels.set(name, peers);
    }

    postMessage(value: unknown) {
      for (const peer of Channel.channels.get(this.name) ?? []) {
        if (peer !== this) {
          for (const listener of peer.listeners) listener({ data: value });
        }
      }
    }

    addEventListener(
      _type: 'message',
      listener: (event: { data: unknown }) => void,
    ) {
      this.listeners.add(listener);
    }

    removeEventListener(
      _type: 'message',
      listener: (event: { data: unknown }) => void,
    ) {
      this.listeners.delete(listener);
    }

    close() {
      Channel.channels.get(this.name)?.delete(this);
    }
  }
  const first = createBroadcastHintBus(
    'opto-test',
    (name) => new Channel(name),
  );
  const second = createBroadcastHintBus(
    'opto-test',
    (name) => new Channel(name),
  );
  const local = firstValueFrom(first.hints$.pipe(take(1)));
  const remote = firstValueFrom(second.hints$.pipe(take(1)));
  first.publish({
    reason: 'local-mutation',
    source: 'local',
    sessionPartition: transportSessionKey(identity),
    table: 'todos',
    recordId: 'todo-1',
  });
  assert.deepEqual(await local, {
    reason: 'local-mutation',
    source: 'broadcast',
    sessionPartition: transportSessionKey(identity),
    table: 'todos',
    recordId: 'todo-1',
  });
  assert.equal((await remote).source, 'broadcast');
  first.close();
  second.close();
});
