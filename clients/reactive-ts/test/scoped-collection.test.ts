import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalRecordIdScope,
  createScopedCollection,
  scopedCollectionKey,
} from '../src/scoped-collection.ts';

const scope = { version: 1 as const, table: 'docs', recordIds: ['b', 'a'] };
const partition = 'tenant:user:session-1';

function fixture() {
  return createScopedCollection<{ title: string }>({
    scope,
    sessionPartition: partition,
  });
}

test('scope keys are canonical, session-bound and reject duplicates', () => {
  assert.deepEqual(canonicalRecordIdScope(scope).recordIds, ['a', 'b']);
  assert.equal(scopedCollectionKey(scope, partition),
    scopedCollectionKey({ version: 1, table: 'docs', recordIds: ['a', 'b'] }, partition));
  assert.notEqual(scopedCollectionKey(scope, partition),
    scopedCollectionKey(scope, 'tenant:user:session-2'));
  assert.throws(() => canonicalRecordIdScope({ version: 1, table: 'docs', recordIds: ['a', 'a'] }));
  assert.throws(() => canonicalRecordIdScope({ version: 1, table: 'docs', recordIds: [] }));
  assert.throws(() => canonicalRecordIdScope({ version: 1, table: 'bad table', recordIds: ['a'] }));
});

test('snapshot, filtered pull, deletes, and invisible checkpoint jumps', async () => {
  const collection = fixture();
  const views: unknown[] = [];
  collection.subscribe((view) => views.push([...view.rows].map(([k, v]) => [k, v.title])));
  await assert.rejects(collection.applyPullPage({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    fromCheckpoint: '0', checkpoint: '1', hasMore: false, changes: [],
  }), /snapshot required/);
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64), checkpoint: '9',
    records: [{ recordId: 'a', revision: '2', record: { title: 'old' } }],
  });
  await collection.applyPullPage({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    fromCheckpoint: '9', checkpoint: '100', hasMore: false,
    changes: [
      { checkpoint: '21', recordId: 'b', revision: '1', operation: 'upsert', record: { title: 'new' } },
      { checkpoint: '79', recordId: 'a', revision: '3', operation: 'delete' },
    ],
  });
  assert.equal(collection.getView().checkpoint, '100');
  assert.deepEqual([...collection.getView().rows], [['b', { title: 'new' }]]);
  assert.deepEqual(views, [
    [['a', 'old']],
    [['b', 'new']],
  ]);
});

test('reject stale, duplicate, out-of-order, out-of-shape changes atomically', async () => {
  const collection = fixture();
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64), checkpoint: '3',
    records: [{ recordId: 'a', revision: '1', record: { title: 'original' } }],
  });
  const base = { protocolVersion: 1 as const, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    fromCheckpoint: '3', checkpoint: '8', hasMore: false };
  await assert.rejects(collection.applyPullPage({
    ...base, changes: [
      { checkpoint: '5', recordId: 'a', revision: '2', operation: 'upsert' as const, record: { title: 'modified' } },
      { checkpoint: '4', recordId: 'b', revision: '1', operation: 'delete' as const },
    ],
  }), /out-of-order/);
  await assert.rejects(collection.applyPullPage({
    ...base, changes: [
      { checkpoint: '5', recordId: 'outside', revision: '2', operation: 'delete' as const },
    ],
  }), /outside scope/);
  await assert.rejects(collection.applyPullPage({
    ...base, fromCheckpoint: '2', changes: [],
  }), /mismatch/);
  await assert.rejects(collection.installSnapshot({
    protocolVersion: 1, scopeKey: 'other-user', scopeToken: 'a'.repeat(64), checkpoint: '9', records: [],
  }), /mismatch/);
  await assert.rejects(collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64), checkpoint: '2', records: [],
  }), /stale/);
  await assert.rejects(collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64), checkpoint: '4',
    records: [
      { recordId: 'a', revision: '1', record: { title: 'one' } },
      { recordId: 'a', revision: '1', record: { title: 'two' } },
    ],
  }), /duplicate/);
  assert.equal(collection.getView().checkpoint, '3');
  assert.equal(collection.getView().rows.get('a')?.title, 'original');
});

test('persistence failure does not acknowledge a checkpoint and retry is possible', async () => {
  let failures = 1;
  let persisted = '';
  const collection = createScopedCollection<{ title: string }>({
    scope, sessionPartition: partition,
    persist: async (_rows, checkpoint) => {
      if (failures-- > 0) throw new Error('disk full');
      persisted = checkpoint;
    },
  });
  const snapshot = { protocolVersion: 1 as const, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    checkpoint: '8', records: [{ recordId: 'a', revision: '1', record: { title: 'safe' } }] };
  await assert.rejects(collection.installSnapshot(snapshot), /disk full/);
  assert.equal(collection.getView().ready, false);
  assert.equal(collection.getView().checkpoint, null);
  await collection.installSnapshot(snapshot);
  assert.equal(persisted, '8');
  assert.equal(collection.getView().rows.get('a')?.title, 'safe');
});

test('host-owned optimistic overlay survives authoritative changes and reset', async () => {
  const pending = new Map<string, { title: string }>();
  const collection = createScopedCollection<{ title: string }>({
    scope, sessionPartition: partition,
    projectLocalView: (id, authoritative) => pending.get(id) ?? authoritative,
  });
  pending.set('a', { title: 'local-unconfirmed' });
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64), checkpoint: '10',
    records: [{ recordId: 'a', revision: '1', record: { title: 'server-old' } }],
  });
  await collection.applyPullPage({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    fromCheckpoint: '10', checkpoint: '11', hasMore: false,
    changes: [{ checkpoint: '11', recordId: 'a', revision: '2',
      operation: 'upsert', record: { title: 'server-new' } }],
  });
  assert.equal(collection.getView().rows.get('a')?.title, 'local-unconfirmed');
  await collection.requireSnapshot();
  assert.equal(collection.getView().ready, false);
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64), checkpoint: '15',
    records: [{ recordId: 'a', revision: '3', record: { title: 'server-latest' } }],
  });
  assert.equal(collection.getView().rows.get('a')?.title, 'local-unconfirmed');
  pending.delete('a');
  collection.notifyLocalChange();
  assert.equal(collection.getView().rows.get('a')?.title, 'server-latest');
});

test('listeners unsubscribe and close prevents additional commits', async () => {
  const collection = fixture();
  let events = 0;
  const unsubscribe = collection.subscribe(() => { events++; });
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64), checkpoint: '1', records: [],
  });
  unsubscribe();
  collection.notifyLocalChange();
  assert.equal(events, 1);
  collection.close();
  assert.throws(() => collection.applyPullPage({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    fromCheckpoint: '1', checkpoint: '2', hasMore: false, changes: [],
  }), /closed/);
});


test('duplicate or regressing record revision cannot rewind an accepted update', async () => {
  const collection = fixture();
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    checkpoint: '20',
    records: [{ recordId: 'a', revision: '10', record: { title: 'latest' } }],
  });
  for (const revision of ['9', '10']) {
    await assert.rejects(collection.applyPullPage({
      protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
      fromCheckpoint: '20', checkpoint: '21', hasMore: false,
      changes: [{ checkpoint: '21', recordId: 'a', revision,
        operation: 'upsert', record: { title: 'older' } }],
    }), /stale or duplicate/);
    assert.equal(collection.getView().checkpoint, '20');
    assert.equal(collection.getView().rows.get('a')?.title, 'latest');
  }
});

test('hasMore cannot advance with zero scoped events and a malformed page', async () => {
  const collection = fixture();
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    checkpoint: '3', records: [],
  });
  await assert.rejects(collection.applyPullPage({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    fromCheckpoint: '3', checkpoint: '10', hasMore: true, changes: [],
  }), /invalid scoped pull page/);
  assert.equal(collection.getView().checkpoint, '3');
});

test('scope token rotation requires reset before accepting another snapshot', async () => {
  const collection = fixture();
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'a'.repeat(64),
    checkpoint: '8', records: [],
  });
  await assert.rejects(collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'b'.repeat(64),
    checkpoint: '9', records: [],
  }), /authorization scope changed/);
  await collection.requireSnapshot();
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: 'b'.repeat(64),
    checkpoint: '9', records: [],
  });
  assert.equal(collection.getScopeToken(), 'b'.repeat(64));
});
