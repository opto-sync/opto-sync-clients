import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BehaviorSubject,
  VirtualTimeScheduler,
} from 'rxjs';

import {
  createSupabaseHints$,
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

class FakeSupabaseChannel {
  callback?: (payload: unknown) => void;
  status?: (status: string, error?: unknown) => void;
  unsubscribeCalls = 0;

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
    this.unsubscribeCalls += 1;
  }
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMillis = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMillis;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition timed out');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test('Supabase retries use a fresh token and fence superseded callbacks', async () => {
  const sessions = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  const scheduler = new VirtualTimeScheduler();
  const channels: FakeSupabaseChannel[] = [];
  const hints: SyncHint[] = [];
  const order: string[] = [];
  const appliedTokens: string[] = [];
  let tokenSequence = 0;

  const subscription = createSupabaseHints$({
    session$: sessions,
    auth: {
      accessToken: () => {
        order.push('token');
        tokenSequence += 1;
        return `jwt-${tokenSequence}`;
      },
      realtime: {
        setAuth: (token) => {
          order.push('setAuth');
          appliedTokens.push(String(token));
        },
      },
    },
    channel: () => {
      order.push('channel');
      const channel = new FakeSupabaseChannel();
      channels.push(channel);
      return channel;
    },
    filter: { event: '*', schema: 'opto_sync', table: 'todos' },
    decode: () => ({ table: 'todos', recordId: 'todo-1' }),
    retryBaseMs: 10,
    retryMaxMs: 20,
    retryAttempts: 2,
    retryScheduler: scheduler,
  }).subscribe((hint) => hints.push(hint));

  await waitUntil(() => channels.length === 1);
  assert.deepEqual(order, ['token', 'setAuth', 'channel']);
  const staleCallback = channels[0].callback;

  channels[0].status?.('CLOSED', new Error('credential-in-reason'));
  assert.equal(channels[0].unsubscribeCalls, 1);
  assert.equal(scheduler.actions.length, 1);
  scheduler.flush();
  await waitUntil(() => channels.length === 2);

  staleCallback?.({ new: { id: 'stale' } });
  assert.equal(hints.length, 0, 'retired channels cannot wake a new session');

  channels[1].callback?.({ new: { id: 'todo-1' } });
  await waitUntil(() => hints.length === 1);
  assert.deepEqual(appliedTokens, ['jwt-1', 'jwt-2']);
  assert.deepEqual(hints[0], {
    table: 'todos',
    recordId: 'todo-1',
    reason: 'remote-change',
    source: 'supabase',
    sessionPartition: transportSessionKey(identity),
  });

  subscription.unsubscribe();
  sessions.complete();
  assert.equal(channels[1].unsubscribeCalls, 1);
});

test('Supabase auth failures are finite and do not expose credentials', async () => {
  const sessions = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  const scheduler = new VirtualTimeScheduler();
  const errors: Error[] = [];
  let tokenCalls = 0;
  let channelCalls = 0;

  createSupabaseHints$({
    session$: sessions,
    auth: {
      accessToken: () => {
        tokenCalls += 1;
        return 'secret-jwt-value';
      },
      realtime: {
        setAuth: () => {
          throw new Error('secret-jwt-value from provider');
        },
      },
    },
    channel: () => {
      channelCalls += 1;
      return new FakeSupabaseChannel();
    },
    filter: { event: '*', schema: 'opto_sync', table: 'todos' },
    retryBaseMs: 5,
    retryMaxMs: 5,
    retryAttempts: 1,
    retryScheduler: scheduler,
  }).subscribe({ error: (error) => errors.push(error as Error) });

  await waitUntil(() => scheduler.actions.length === 1);
  scheduler.flush();
  await waitUntil(() => errors.length === 1);

  assert.equal(tokenCalls, 2);
  assert.equal(channelCalls, 0);
  assert.equal(errors[0].message, 'Supabase Realtime authentication update failed');
  assert.doesNotMatch(errors[0].message, /secret-jwt-value/);
  assert.equal(scheduler.actions.length, 0);
  sessions.complete();
});
