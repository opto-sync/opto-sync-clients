import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import 'fake-indexeddb/auto';

import {
  CONSISTENCY_POLICY,
  FrozenMutationIntentError,
  OptoSyncClient,
  UnknownConsistencyPolicyError,
  assertQueuedIntentFrozen,
  canonicalizeConsistencyPolicy,
  outcomeForNetwork,
  reconcileReadModel,
  rx,
} from '../dist/index.js';

const vectors = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../formal/consistency_vectors.v1.json',
    ),
    'utf8',
  ),
);

test('canonical policy ids are stable and aliases collapse onto them', () => {
  assert.deepEqual(vectors.policies, Object.values(CONSISTENCY_POLICY));
  for (const [alias, expected] of Object.entries(vectors.aliases)) {
    assert.equal(canonicalizeConsistencyPolicy(alias), expected);
  }
  for (const unknown of vectors.unknownPolicies) {
    assert.throws(
      () => canonicalizeConsistencyPolicy(unknown),
      UnknownConsistencyPolicyError,
    );
  }
});

test('queued mutation intent cannot change policy identity or content', () => {
  for (const fixture of vectors.freeze) {
    if (fixture.allowed) {
      assertQueuedIntentFrozen(fixture.existing, fixture.proposed);
    } else {
      assert.throws(
        () => assertQueuedIntentFrozen(fixture.existing, fixture.proposed),
        FrozenMutationIntentError,
      );
    }
  }
});

test('read reconciliation is deterministic across the shared vector corpus', () => {
  for (const fixture of vectors.readModels) {
    const actual = reconcileReadModel(fixture.input);
    assert.deepEqual(actual, fixture.expect.records, fixture.id);
  }
});

test('each consistency mode returns the documented typed outcome', () => {
  for (const fixture of vectors.modeOutcomes) {
    const actual = outcomeForNetwork(
      fixture.policy,
      fixture.network,
      fixture.coveredMutationIds ?? [],
    );
    assert.equal(actual.status, fixture.expectStatus, fixture.id);
    assert.equal(actual.consistencyPolicy, fixture.policy);
  }
});

test('queueMutation serializes the canonical policy into durable intent', async () => {
  const client = new OptoSyncClient({
    databaseName: 'consistency-queue-1',
  });
  const id = await client.queueMutation(
    'docs',
    'r1',
    { title: 'queued' },
    { consistencyPolicy: 'queued-local-first' },
  );
  const row = await client.db.localMutations.get(id);
  assert.equal(row.consistencyPolicy, CONSISTENCY_POLICY.queuedLocalFirst);
  const stored = await client.db.meta.get(`intent.policy.${row.mutationId}`);
  assert.equal(stored.value, CONSISTENCY_POLICY.queuedLocalFirst);
  const intent = client.queuedIntentFromRow(row, await client.clientId());
  await assert.rejects(
    () =>
      client.assertQueuedIntentUnchanged(id, {
        ...intent,
        consistencyPolicy: CONSISTENCY_POLICY.remoteAcknowledged,
      }),
    FrozenMutationIntentError,
  );
});

test('writeWithConsistency covers remote-acknowledged, write-through, and queued modes', async () => {
  const client = new OptoSyncClient({ databaseName: 'consistency-write-1' });
  const loop = {
    hints: 0,
    hint() {
      this.hints += 1;
    },
    async syncNow() {
      const pending = await client.pendingMutations();
      for (const row of pending) {
        await client.markMutation(row.id, 1);
      }
      return {
        pushedMutations: pending.length,
        acknowledgedMutations: pending.length,
        pulledChanges: 0,
        installedSnapshots: 0,
        checkpoint: '0',
        hasMorePending: false,
      };
    },
  };

  const queued = await rx.writeWithConsistency(
    client,
    'docs',
    'queued',
    { v: 1 },
    { consistency: CONSISTENCY_POLICY.queuedLocalFirst, loop },
  );
  assert.equal(queued.status, 'pending');
  assert.equal(loop.hints, 0);

  const writeThrough = await rx.writeWithConsistency(
    client,
    'docs',
    'through',
    { v: 2 },
    { consistency: CONSISTENCY_POLICY.writeThroughLocalFirst, loop },
  );
  assert.equal(writeThrough.status, 'confirmed');
  assert.equal(loop.hints, 1);

  const strict = await rx.writeWithConsistency(
    client,
    'docs',
    'strict',
    { v: 3 },
    { consistency: CONSISTENCY_POLICY.remoteAcknowledged, loop },
  );
  assert.equal(strict.status, 'confirmed');
});
