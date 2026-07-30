import assert from 'node:assert/strict';
import test from 'node:test';

import { BehaviorSubject, Subject, firstValueFrom, take } from 'rxjs';

import {
  SyncHint,
  SyncSession,
  createBroadcastHintBus,
  createSupabaseHints$,
  createSyncWakePipeline,
  createWebSocketHints$,
  transportSessionKey,
} from '../src/index.ts';

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
    data: JSON.stringify({ table: 'todos', recordId: 'todo-1', checkpoint: '7' }),
  });

  const rotated = { ...identity, session_id: 'session-b' };
  sessions.next({ status: 'authenticated', identity: rotated });
  assert.equal(sockets[0].closed, true);
  assert.equal(sockets.length, 2);
  sockets[1].emit('message', {
    data: JSON.stringify({ table: 'todos', recordId: 'todo-2', checkpoint: '8' }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  on(_type: string, _filter: Record<string, unknown>, callback: (payload: unknown) => void) {
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

test('Supabase Realtime is exposed only as a protocol wake hint', async () => {
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
      decode: () => ({ table: 'todos', recordId: 'todo-1', checkpoint: '12' }),
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

test('wake pipeline coalesces bursts and refuses overlapping protocol ownership', async () => {
  const hints = new Subject<SyncHint>();
  let cycles = 0;
  const outcomes: unknown[] = [];
  const subscription = createSyncWakePipeline({
    hints: [hints],
    coalesceMs: 5,
    syncNow: async () => {
      cycles += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return cycles;
    },
  }).subscribe((outcome) => outcomes.push(outcome));
  const hint: SyncHint = {
    reason: 'local-mutation',
    source: 'local',
    sessionPartition: transportSessionKey(identity),
  };
  hints.next(hint);
  hints.next({ ...hint, source: 'websocket' });
  hints.next({ ...hint, source: 'supabase' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  hints.next({ ...hint, source: 'broadcast' });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(cycles, 1);
  assert.equal(outcomes.length, 1);
  subscription.unsubscribe();
});

test('BroadcastChannel bus emits locally and to another tab without payloads', async () => {
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
    addEventListener(_type: 'message', listener: (event: { data: unknown }) => void) {
      this.listeners.add(listener);
    }
    removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void) {
      this.listeners.delete(listener);
    }
    close() {
      Channel.channels.get(this.name)?.delete(this);
    }
  }
  const first = createBroadcastHintBus('opto-test', (name) => new Channel(name));
  const second = createBroadcastHintBus('opto-test', (name) => new Channel(name));
  const received = firstValueFrom(second.hints$.pipe(take(1)));
  first.publish({
    reason: 'local-mutation',
    source: 'local',
    sessionPartition: transportSessionKey(identity),
    table: 'todos',
    recordId: 'todo-1',
  });
  assert.equal((await received).source, 'local');
  first.close();
  second.close();
});
