import assert from 'node:assert/strict';
import test from 'node:test';
import { createScopedCollection } from '../src/scoped-collection.ts';
import { bindScopedCollectionToTanstackQuery } from '../src/tanstack-query.ts';

test('TanStack Query cache bridge receives localView, retains data across RESET, and unsubscribes', async () => {
  const pending = new Map([['doc-1', { title: 'local pending' }]]);
  const collection = createScopedCollection<{ title: string }>({
    scope: { version: 1, table: 'docs', recordIds: ['doc-1'] },
    sessionPartition: 'tenant:user:session-a',
    projectLocalView: (id, authoritative) => pending.get(id) ?? authoritative,
  });
  const entries: unknown[] = [];
  const queryKey = ['scoped', 'opaque-scope-id'];
  const client = {
    setQueryData(key: readonly unknown[], value: unknown) {
      assert.deepEqual(key, queryKey);
      entries.push(value);
    },
  };
  const unbind = bindScopedCollectionToTanstackQuery(collection, client, queryKey);
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    checkpoint: '3',
    records: [{ recordId: 'doc-1', revision: '1', record: { title: 'server' } }],
  });
  assert.deepEqual(entries.at(-1), [{ recordId: 'doc-1', value: { title: 'local pending' } }]);
  await collection.requireSnapshot();
  assert.equal(entries.length, 1, 'reset must not empty the UI cache');
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'b'.repeat(64),
    checkpoint: '5',
    records: [{ recordId: 'doc-1', revision: '2', record: { title: 'server 2' } }],
  });
  assert.equal(entries.length, 2);
  pending.delete('doc-1');
  collection.notifyLocalChange();
  assert.deepEqual(entries.at(-1), [{ recordId: 'doc-1', value: { title: 'server 2' } }]);
  unbind();
  collection.notifyLocalChange();
  assert.equal(entries.length, 3);
});

test('TanStack Query bridge requires a nonempty scope-isolated query key', () => {
  const collection = createScopedCollection<unknown>({
    scope: { version: 1, table: 'docs', recordIds: ['doc-1'] },
    sessionPartition: 'user:tenant:session',
  });
  assert.throws(() => bindScopedCollectionToTanstackQuery(collection,
    { setQueryData: () => undefined }, []), /nonempty/);
});
