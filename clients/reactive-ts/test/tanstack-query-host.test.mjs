import assert from 'node:assert/strict';
import test from 'node:test';
import { Subject } from 'rxjs';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { bindOptoToTanStackQuery } from '../src/tanstack-query.ts';

const identity = {
  provider: 'supabase', provider_tenant: 'tenant-a',
  shared_user_id: 'user-1', provider_subject: 'principal',
  session_id: 'rotates-and-must-not-appear-in-key',
};
const other = { ...identity, provider_tenant: 'tenant-b' };
const doc = (title) => ({ id: 'doc-1', title });

test('real TanStack QueryClient observes Opto localView while refusing tenant leakage', () => {
  const records$ = new Subject();
  const client = new QueryClient();
  const problems = [];
  const binding = bindOptoToTanStackQuery({
    queryClient: client, records$, identity, queryKey: ['docs', 'doc-1'],
    onError: error => problems.push(error),
  });
  const updates = [];
  const observer = new QueryObserver(client, {
    queryKey: binding.queryKey, enabled: false, initialData: null,
  });
  const stop = observer.subscribe(result => { updates.push(result.data); });
  records$.next({ session: identity, value: doc('optimistic-local') });
  assert.deepEqual(client.getQueryData(binding.queryKey), doc('optimistic-local'));
  records$.next({ session: other, value: doc('cross-tenant-leak') });
  assert.deepEqual(client.getQueryData(binding.queryKey), doc('optimistic-local'));
  assert.equal(problems.length, 1);
  records$.next({ session: identity, value: doc('committed-server') });
  assert.deepEqual(client.getQueryData(binding.queryKey), doc('committed-server'));
  assert.ok(updates.some(value => value?.title === 'committed-server'));
  assert.ok(!JSON.stringify(binding.queryKey).includes(identity.session_id));
  binding.unsubscribe();
  records$.next({ session: identity, value: doc('after-unsubscribe') });
  assert.deepEqual(client.getQueryData(binding.queryKey), doc('committed-server'));
  stop();
  client.clear();
});
