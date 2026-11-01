import assert from 'node:assert/strict';
import test from 'node:test';
import { Subject } from 'rxjs';
import type { ReactiveRecordSnapshot } from '../src/reactive-record.ts';
import type { SyncSessionIdentity } from '../src/contracts.ts';
import { bindOptoToTanStackQuery, optoScopedQueryKey } from '../src/tanstack-query.ts';

type Doc = { id: string; title: string };
const session: SyncSessionIdentity = {
  provider: 'supabase', provider_tenant: 'tenant-a', shared_user_id: 'user-1',
  provider_subject: 'subject-1', session_id: 'rotating-session',
};
function event(identity: SyncSessionIdentity, value: Doc | null): ReactiveRecordSnapshot<Doc> {
  return { session: identity, value } as ReactiveRecordSnapshot<Doc>;
}

test('optimistic localView wins refetch and is updated on external acknowledgement', () => {
  const source = new Subject<ReactiveRecordSnapshot<Doc>>();
  const values = new Map<string, Doc | null>();
  const queryClient = { setQueryData<T>(key: readonly unknown[], value: T) {
    values.set(JSON.stringify(key), value as Doc | null);
  } };
  const binding = bindOptoToTanStackQuery({ queryClient, records$: source,
    identity: session, queryKey: ['docs', 'doc-1'] });
  const key = JSON.stringify(binding.queryKey);
  source.next(event(session, { id: 'doc-1', title: 'local-draft' }));
  source.next(event(session, { id: 'doc-1', title: 'local-draft' }));
  assert.equal(values.get(key)?.title, 'local-draft');
  source.next(event(session, { id: 'doc-1', title: 'server-acknowledged' }));
  assert.equal(values.get(key)?.title, 'server-acknowledged');
  binding.unsubscribe();
  source.next(event(session, { id: 'doc-1', title: 'must-not-write' }));
  assert.equal(values.get(key)?.title, 'server-acknowledged');
});

test('cache keys partition tenants and users, never session secrets', () => {
  const a = optoScopedQueryKey(session, ['docs']);
  const b = optoScopedQueryKey({ ...session, provider_tenant: 'tenant-b' }, ['docs']);
  assert.notDeepEqual(a, b);
  assert.ok(!JSON.stringify(a).includes('rotating-session'));
  assert.ok(Object.isFrozen(a));
});

test('cross-tenant event never contaminates an existing QueryClient entry', () => {
  const source = new Subject<ReactiveRecordSnapshot<Doc>>();
  const values: Array<Doc | null> = [];
  const errors: unknown[] = [];
  const binding = bindOptoToTanStackQuery({ records$: source, identity: session,
    queryKey: ['docs'], onError: e => errors.push(e),
    queryClient: { setQueryData<T>(_key: readonly unknown[], value: T) {
      values.push(value as Doc | null);
    } } });
  source.next(event({ ...session, provider_tenant: 'tenant-b' },
    { id: 'doc-1', title: 'not-authorized' }));
  assert.equal(values.length, 0);
  assert.equal(errors.length, 1);
  source.next(event(session, null));
  assert.deepEqual(values, [null]);
  binding.unsubscribe();
});
