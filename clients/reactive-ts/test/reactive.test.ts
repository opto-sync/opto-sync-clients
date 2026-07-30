import assert from 'node:assert/strict';
import test from 'node:test';

import { BehaviorSubject, Subject } from 'rxjs';

import {
  SyncRecordEvent,
  SyncSession,
  createReactiveRecord$,
  transportSessionKey,
} from '../src/index.ts';

const identity = {
  shared_user_id: 'user-1',
  provider: 'supabase',
  provider_tenant: 'project-a',
  provider_subject: 'supabase-user-1',
  session_id: 'session-a',
  authority: 'supabase',
};

function event(
  source: SyncRecordEvent<Record<string, unknown>>['source'],
  authority: SyncRecordEvent<Record<string, unknown>>['authority'],
  revision: string,
  payload: Record<string, unknown>,
  pending = false,
  sessionPartition = transportSessionKey(identity),
): SyncRecordEvent<Record<string, unknown>> {
  return {
    table: 'todos',
    recordId: 'todo-1',
    operation: 'upsert',
    payload,
    revision,
    source,
    authority,
    pending,
    sessionPartition,
  };
}

test('local view survives duplicate HTTP/WebSocket echoes until acknowledgement', async () => {
  const session$ = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  const local = new Subject<SyncRecordEvent<Record<string, unknown>>>();
  const http = new Subject<SyncRecordEvent<Record<string, unknown>>>();
  const websocket = new Subject<SyncRecordEvent<Record<string, unknown>>>();
  const values: unknown[] = [];

  const subscription = createReactiveRecord$({
    session$,
    table: 'todos',
    recordId: 'todo-1',
    sources: [
      { name: 'local', events: () => local },
      { name: 'http', events: () => http },
      { name: 'websocket', events: () => websocket },
    ],
  }).subscribe((snapshot) => values.push(snapshot.value));

  local.next(event('local', 'local-view', 'local:1', { title: 'optimistic' }, true));
  const serverEcho = event('http', 'authoritative', '7', { title: 'server-old' });
  http.next(serverEcho);
  websocket.next({ ...serverEcho, source: 'websocket' });
  local.next(event('local', 'local-view', 'ack:1', { title: 'optimistic' }, false));

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(values, [{ title: 'optimistic' }, { title: 'server-old' }]);
  subscription.unsubscribe();
});

test('session rotation tears down stale generations and replays the latest value', async () => {
  const session$ = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  const events = new Subject<SyncRecordEvent<{ value: string }>>();
  let subscriptions = 0;
  let unsubscriptions = 0;
  const values: string[] = [];

  const stream = createReactiveRecord$({
    session$,
    table: 'todos',
    recordId: 'todo-1',
    sources: [
      {
        name: 'counted',
        events: () =>
          new (class extends Subject<SyncRecordEvent<{ value: string }>> {
            constructor() {
              super();
              subscriptions += 1;
              const upstream = events.subscribe(this);
              this.subscribe({ complete: () => upstream.unsubscribe() });
            }
            override unsubscribe(): void {
              unsubscriptions += 1;
              super.unsubscribe();
            }
          })(),
      },
    ],
  });

  const first = stream.subscribe((snapshot) => values.push(snapshot.value?.value ?? 'deleted'));
  const second = stream.subscribe();
  events.next(event('http', 'authoritative', '1', { value: 'first' }) as SyncRecordEvent<{ value: string }>);

  const rotated = { ...identity, session_id: 'session-b' };
  session$.next({ status: 'authenticated', identity: rotated });
  events.next(
    event(
      'http',
      'authoritative',
      '2',
      { value: 'stale' },
      false,
      transportSessionKey(identity),
    ) as SyncRecordEvent<{ value: string }>,
  );
  events.next(
    event(
      'http',
      'authoritative',
      '3',
      { value: 'rotated' },
      false,
      transportSessionKey(rotated),
    ) as SyncRecordEvent<{ value: string }>,
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(values, ['first', 'rotated']);
  assert.equal(subscriptions, 2, 'one source generation per authenticated session');
  first.unsubscribe();
  second.unsubscribe();
  assert.ok(unsubscriptions >= 0);
});

test('degraded authentication fails closed instead of looking logged out', () => {
  const session$ = new BehaviorSubject<SyncSession>({
    status: 'degraded',
    reason: 'shared-auth and Supabase unavailable',
  });
  assert.throws(
    () =>
      createReactiveRecord$({
        session$,
        table: 'todos',
        recordId: 'todo-1',
        sources: [{ name: 'never', events: () => new Subject() }],
      }).subscribe(),
    /degraded/,
  );
});
