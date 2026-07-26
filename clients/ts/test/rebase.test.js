'use strict';

// Rebase: un-confirmed local writes must survive a pull that brings newer
// server state. Run in Node against fake-indexeddb.
require('fake-indexeddb/auto');

const test = require('node:test');
const assert = require('node:assert');

const {
  OptoSyncClient,
  SYNC_STATUS,
  rebasePending,
  reconcileIncoming,
} = require('../dist/index.js');

test('rebasePending replays a pending write on top of newer server state', () => {
  // The server's updatedAt is newer, so a plain reconcile rejects the local
  // edit as stale. That is correct for a *remote* writer and wrong for this
  // client's own un-pushed intent.
  const server = { id: 'r1', title: 'server title', updatedAt: '9000' };
  const pending = { id: 'r1', title: 'my un-pushed edit', updatedAt: '1000' };

  const withoutRebase = reconcileIncoming(server, pending);
  assert.strictEqual(
    withoutRebase.title,
    'server title',
    'plain reconcile drops the stale-looking local edit — this is the bug rebase fixes',
  );

  const view = rebasePending(server, [pending]);
  assert.strictEqual(
    view.title,
    'my un-pushed edit',
    'pending write must survive the pull',
  );
});

test('rebasePending applies pending writes oldest-first', () => {
  const server = { id: 'r1', title: 'server', updatedAt: '9000' };
  const first = { id: 'r1', title: 'first edit', updatedAt: '1' };
  const second = { id: 'r1', title: 'second edit', updatedAt: '2' };

  const view = rebasePending(server, [first, second]);
  assert.strictEqual(
    view.title,
    'second edit',
    'the newest queued edit must win',
  );
});

test('rebasePending keeps server fields the pending writes do not touch', () => {
  const server = {
    id: 'r1',
    title: 'server',
    owner: 'alice',
    updatedAt: '9000',
  };
  const pending = { id: 'r1', title: 'mine', updatedAt: '1' };

  const view = rebasePending(server, [pending]);
  assert.strictEqual(
    view.owner,
    'alice',
    'untouched server fields must be preserved',
  );
  assert.strictEqual(view.title, 'mine');
});

test('rebasePending with no pending writes is just the server state', () => {
  const server = { id: 'r1', title: 'server', updatedAt: '9000' };
  assert.deepStrictEqual(rebasePending(server, []), server);
});

test('gateOverlayByTimestamp restores strict last-write-wins for the overlay', () => {
  const server = { id: 'r1', title: 'server title', updatedAt: '9000' };
  const pending = { id: 'r1', title: 'stale local', updatedAt: '1000' };

  const view = rebasePending(server, [pending], {
    gateOverlayByTimestamp: true,
  });
  assert.strictEqual(
    view.title,
    'server title',
    'opt-in gating must reject the older write',
  );
});

test('rebasePending merges keyed array elements rather than replacing the array', () => {
  // MERGE_BY_KEY is the client default; a pending edit to one element must not
  // discard sibling elements the server knows about.
  const server = {
    id: 'r1',
    items: [
      { id: 'a', qty: 1, updatedAt: '9000' },
      { id: 'b', qty: 2, updatedAt: '9000' },
    ],
    updatedAt: '9000',
  };
  const pending = {
    id: 'r1',
    items: [{ id: 'a', qty: 42, updatedAt: '1' }],
    updatedAt: '1',
  };

  const view = rebasePending(server, [pending]);
  const byId = Object.fromEntries(view.items.map((i) => [i.id, i]));
  assert.strictEqual(
    byId.a.qty,
    42,
    'the edited element must reflect the local write',
  );
  assert.ok(
    byId.b,
    'a sibling element the local write never mentioned must survive',
  );
  assert.strictEqual(byId.b.qty, 2);
});

test('localView rebases the queue for one record', async () => {
  const client = new OptoSyncClient({
    databaseName: 'rebase-view-1',
    stampUpdatedAt: false,
  });
  try {
    await client.queueMutation('todos', 't1', {
      id: 't1',
      title: 'my edit',
      updatedAt: '1',
    });
    // A different record's queue must not bleed into this view.
    await client.queueMutation('todos', 't2', {
      id: 't2',
      title: 'other record',
      updatedAt: '1',
    });

    const server = {
      id: 't1',
      title: 'server title',
      done: false,
      updatedAt: '9000',
    };
    const view = await client.localView('todos', 't1', server);

    assert.strictEqual(view.title, 'my edit');
    assert.strictEqual(view.done, false, 'server-only fields survive');
  } finally {
    await client.db.delete();
  }
});

test('localView returns server state once the mutation is confirmed', async () => {
  const client = new OptoSyncClient({
    databaseName: 'rebase-view-2',
    stampUpdatedAt: false,
  });
  try {
    await client.queueMutation('todos', 't1', {
      id: 't1',
      title: 'my edit',
      updatedAt: '1',
    });
    const server = { id: 't1', title: 'server title', updatedAt: '9000' };

    assert.strictEqual(
      (await client.localView('todos', 't1', server)).title,
      'my edit',
    );

    const confirmed = await client.confirmSyncedUpTo(1);
    assert.strictEqual(confirmed, 1, 'the queued mutation should be confirmed');

    const settled = await client.localView('todos', 't1', server);
    assert.strictEqual(
      settled.title,
      'server title',
      'once confirmed, the record must settle on server truth',
    );
  } finally {
    await client.db.delete();
  }
});

test('queued mutations carry a client id and a monotonic mutation id', async () => {
  const client = new OptoSyncClient({ databaseName: 'rebase-ids-1' });
  try {
    await client.queueMutation('todos', 'a', { title: 'one' });
    await client.queueMutation('todos', 'b', { title: 'two' });

    const pending = await client.pendingMutations();
    const clientId = await client.clientId();

    assert.deepStrictEqual(
      pending.map((m) => m.mutationId),
      ['1', '2'],
      'mutation ids must be monotonic per client so a server can dedupe replays',
    );
    for (const m of pending) {
      assert.strictEqual(m.clientId, clientId);
      assert.strictEqual(m.attempts, 0);
    }
  } finally {
    await client.db.delete();
  }
});

test('concurrent queueMutation calls never reuse a mutation id', async () => {
  // Allocating the sequence outside a transaction would let interleaved reads
  // hand out the same id twice, and a server deduping on (clientId, mutationId)
  // would drop the second write entirely.
  const client = new OptoSyncClient({ databaseName: 'rebase-ids-2' });
  try {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        client.queueMutation('todos', `r${i}`, { n: i }),
      ),
    );
    const ids = (await client.pendingMutations())
      .map((m) => m.mutationId)
      .sort((a, b) => Number(BigInt(a) - BigInt(b)));
    assert.deepStrictEqual(
      ids,
      Array.from({ length: 25 }, (_, i) => String(i + 1)),
    );
  } finally {
    await client.db.delete();
  }
});

test('concurrent client instances share one durable protocol id', async () => {
  const name = 'rebase-client-id-race-1';
  const a = new OptoSyncClient({ databaseName: name });
  const b = new OptoSyncClient({ databaseName: name });
  try {
    const [aId, bId] = await Promise.all([a.clientId(), b.clientId()]);
    assert.strictEqual(aId, bId, 'initialization must be atomic across tabs');
    assert.notStrictEqual(
      (await a.clock()).nodeId,
      (await b.clock()).nodeId,
      'HLC identities remain per-instance',
    );
  } finally {
    a.db.close();
    await b.db.delete();
  }
});

test('confirmSyncedUpTo only confirms at or below the reported id', async () => {
  const client = new OptoSyncClient({ databaseName: 'rebase-confirm-1' });
  try {
    for (const n of [1, 2, 3])
      await client.queueMutation('todos', `r${n}`, { n });

    const confirmed = await client.confirmSyncedUpTo(2);
    assert.strictEqual(confirmed, 2);

    const stillPending = await client.pendingMutations();
    assert.deepStrictEqual(
      stillPending.map((m) => m.mutationId),
      ['3'],
    );
  } finally {
    await client.db.delete();
  }
});

test('confirmSyncedUpTo ignores mutations from another client', async () => {
  const client = new OptoSyncClient({ databaseName: 'rebase-confirm-2' });
  try {
    await client.queueMutation('todos', 'r1', { n: 1 });
    const confirmed = await client.confirmSyncedUpTo(99, 'some-other-client');
    assert.strictEqual(
      confirmed,
      0,
      'another client’s watermark must not confirm our work',
    );
    assert.strictEqual((await client.pendingMutations()).length, 1);
  } finally {
    await client.db.delete();
  }
});

test('pendingMutations returns insertion order', async () => {
  const client = new OptoSyncClient({ databaseName: 'rebase-order-1' });
  try {
    for (const n of [1, 2, 3, 4, 5])
      await client.queueMutation('todos', 'same-record', { n });
    const ids = (await client.pendingMutations()).map((m) => m.id);
    assert.deepStrictEqual(
      ids,
      [...ids].sort((a, b) => a - b),
      'replay order must be deterministic',
    );
  } finally {
    await client.db.delete();
  }
});

test('recordPushFailure counts attempts without discarding the mutation', async () => {
  const client = new OptoSyncClient({ databaseName: 'rebase-retry-1' });
  try {
    const id = await client.queueMutation('todos', 'r1', { n: 1 });
    await client.recordPushFailure(id, 'ETIMEDOUT');
    await client.recordPushFailure(id, 'ETIMEDOUT');

    const [row] = await client.pendingMutations();
    assert.strictEqual(row.attempts, 2);
    assert.strictEqual(row.lastError, 'ETIMEDOUT');
    assert.strictEqual(
      row.syncStatus,
      SYNC_STATUS.PENDING,
      'a transient failure must stay pending',
    );
  } finally {
    await client.db.delete();
  }
});

test('protocolPushRequest encodes immutable ids, revisions, upserts, and deletes', async () => {
  const client = new OptoSyncClient({
    databaseName: 'protocol-request-1',
    stampUpdatedAt: false,
  });
  try {
    await client.queueMutation(
      'docs',
      'r1',
      { id: 'r1', title: 'draft' },
      { baseRevision: '7', resurrect: true },
    );
    await client.queueDelete('docs', 'r2', { baseRevision: '3' });

    const request = await client.protocolPushRequest();
    assert.strictEqual(request.protocolVersion, 1);
    assert.strictEqual(request.clientId, await client.clientId());
    assert.deepStrictEqual(request.mutations, [
      {
        mutationId: '1',
        operation: 'upsert',
        table: 'docs',
        recordId: 'r1',
        baseRevision: '7',
        payload: { id: 'r1', title: 'draft' },
        resurrect: true,
      },
      {
        mutationId: '2',
        operation: 'delete',
        table: 'docs',
        recordId: 'r2',
        baseRevision: '3',
      },
    ]);
  } finally {
    await client.db.delete();
  }
});

test('acknowledgePush drains durable rejections through the server watermark', async () => {
  const client = new OptoSyncClient({ databaseName: 'protocol-ack-1' });
  try {
    await client.queueMutation('docs', 'r1', { id: 'r1' });
    await client.queueMutation('docs', 'r2', { id: 'r2' });
    const request = await client.protocolPushRequest();
    const confirmed = await client.acknowledgePush({
      protocolVersion: 1,
      clientId: await client.clientId(),
      lastMutationId: '2',
      checkpoint: '1',
      results: [
        { mutationId: '1', status: 'applied', checkpoint: '1', revision: '1' },
        { mutationId: '2', status: 'rejected', code: 'REVISION_CONFLICT' },
      ],
    }, request);
    assert.strictEqual(confirmed, 2);
    assert.deepStrictEqual(await client.pendingMutations(), []);
  } finally {
    await client.db.delete();
  }
});

test('acknowledgePush cannot discard mutations outside the sent batch', async () => {
  const client = new OptoSyncClient({ databaseName: 'protocol-ack-boundary-1' });
  try {
    await client.queueMutation('docs', 'r1', { id: 'r1' });
    await client.queueMutation('docs', 'r2', { id: 'r2' });
    const request = await client.protocolPushRequest(1);
    await assert.rejects(
      () =>
        client.acknowledgePush(
          {
            protocolVersion: 1,
            clientId: request.clientId,
            lastMutationId: '2',
            checkpoint: '2',
            results: [
              { mutationId: '1', status: 'applied' },
              { mutationId: '2', status: 'applied' },
            ],
          },
          request,
        ),
      /does not match the sent batch/,
    );
    assert.strictEqual((await client.pendingMutations()).length, 2);
  } finally {
    await client.db.delete();
  }
});

test('acknowledgePush rejects a forged request that differs from the pending bytes', async () => {
  const client = new OptoSyncClient({ databaseName: 'protocol-ack-forged-1' });
  try {
    await client.queueMutation(
      'docs',
      'r1',
      { id: 'r1', title: 'actually queued' },
      { baseRevision: '3' },
    );
    const request = await client.protocolPushRequest();
    const forged = structuredClone(request);
    forged.mutations[0].payload.title = 'forged after send';
    await assert.rejects(
      () =>
        client.acknowledgePush(
          {
            protocolVersion: 1,
            clientId: request.clientId,
            lastMutationId: '1',
            checkpoint: '1',
            results: [
              {
                mutationId: '1',
                status: 'applied',
                checkpoint: '1',
                revision: '1',
              },
            ],
          },
          forged,
        ),
      /does not match the sent batch/,
    );
    assert.strictEqual((await client.pendingMutations()).length, 1);

    await assert.rejects(
      () => client.protocolPushRequest({ baseRevision: 'not-durable' }),
      /must be persisted by queueMutation/,
    );
  } finally {
    await client.db.delete();
  }
});

test('pull checkpoint is validated and durable', async () => {
  const name = 'protocol-checkpoint-1';
  const client = new OptoSyncClient({ databaseName: name });
  assert.strictEqual(await client.pullCheckpoint(), '0');
  await client.setPullCheckpoint('9007199254740993');
  client.db.close();

  const reopened = new OptoSyncClient({ databaseName: name });
  try {
    assert.strictEqual(await reopened.pullCheckpoint(), '9007199254740993');
    await assert.rejects(() => reopened.setPullCheckpoint('01'), /canonical/);
  } finally {
    await reopened.db.delete();
  }
});

test('snapshot install advances only after replacement and preserves pending work', async () => {
  const client = new OptoSyncClient({
    databaseName: 'protocol-snapshot-install-1',
  });
  const snapshot = {
    protocolVersion: 1,
    checkpoint: '42',
    records: [
      {
        table: 'docs',
        recordId: 'r1',
        record: { id: 'r1', title: 'authoritative' },
        revision: '7',
      },
    ],
  };
  try {
    await client.queueMutation('docs', 'local', { title: 'optimistic' });
    await assert.rejects(
      () =>
        client.installSnapshot(snapshot, async () => {
          throw new Error('replacement interrupted');
        }),
      /replacement interrupted/,
    );
    assert.strictEqual(await client.pullCheckpoint(), '0');
    assert.strictEqual((await client.pendingMutations()).length, 1);
    let malformedCalled = false;
    await assert.rejects(
      () =>
        client.installSnapshot(
          {
            ...snapshot,
            records: [{ ...snapshot.records[0], revision: '01' }],
          },
          async () => {
            malformedCalled = true;
          },
        ),
      /not a valid protocol v1 snapshot/,
    );
    assert.strictEqual(malformedCalled, false);

    let installed;
    await client.installSnapshot(snapshot, async (records) => {
      installed = structuredClone(records);
    });
    assert.deepStrictEqual(installed, snapshot.records);
    assert.strictEqual(await client.pullCheckpoint(), '42');
    assert.strictEqual((await client.pendingMutations()).length, 1);
  } finally {
    await client.db.delete();
  }
});
