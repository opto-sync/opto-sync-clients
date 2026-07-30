import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { firstValueFrom } from 'rxjs';
import { filter, take, toArray } from 'rxjs';

import {
  OptoSyncClient,
  SYNC_STATUS,
  rx,
} from '../dist/index.js';

const { watchLocalView, write, writeDelete, hasUnsyncedWork$, createRxSyncLoop } = rx;
import { BehaviorSubject } from 'rxjs';

let databaseSequence = 0;
function makeClient() {
  databaseSequence += 1;
  return new OptoSyncClient({ databaseName: `rx-test-${databaseSequence}` });
}

function fakeLoop(client, behavior = {}) {
  return {
    hints: 0,
    cycles: 0,
    hint() {
      this.hints += 1;
    },
    async syncNow() {
      this.cycles += 1;
      if (behavior.fail) throw new Error('sync failed');
      if (behavior.acknowledge !== false) {
        // Pretend the server accepted everything queued so far.
        const pending = await client.pendingMutations();
        for (const row of pending) {
          await client.markMutation(row.id, SYNC_STATUS.SYNCED);
        }
      }
      return { pushedMutations: 0, acknowledgedMutations: 0, pulledChanges: 0, installedSnapshots: 0, checkpoint: '0', hasMorePending: false };
    },
  };
}

test('watchLocalView emits the optimistic view immediately after a queue write', async () => {
  const client = makeClient();
  const authoritative$ = new BehaviorSubject({ id: 'r1', title: 'server', updatedAt: '100' });

  const view$ = watchLocalView({
    client,
    tableName: 'docs',
    recordId: 'r1',
    authoritative$,
  });

  const emissions = [];
  const subscription = view$.subscribe((view) => emissions.push(view));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(emissions.length, 1);
  assert.equal(emissions[0].title, 'server');

  await client.queueMutation('docs', 'r1', { title: 'local edit', updatedAt: '200' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const last = emissions[emissions.length - 1];
  assert.equal(last.title, 'local edit');
  subscription.unsubscribe();
});

test('watchLocalView deduplicates canonically-identical states', async () => {
  const client = makeClient();
  const authoritative$ = new BehaviorSubject({ id: 'r2', n: 1 });
  const view$ = watchLocalView({
    client,
    tableName: 'docs',
    recordId: 'r2',
    authoritative$,
  });
  const emissions = [];
  const subscription = view$.subscribe((view) => emissions.push(view));
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Server echoes a byte-identical state (fresh object): must not re-emit.
  authoritative$.next({ id: 'r2', n: 1 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(emissions.length, 1);

  authoritative$.next({ id: 'r2', n: 2 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(emissions.length, 2);
  subscription.unsubscribe();
});

test("write optimism 'background' resolves once durably queued and never syncs", async () => {
  const client = makeClient();
  const loop = fakeLoop(client);
  const receipt = await write(client, 'docs', 'r3', { v: 1 }, { optimism: 'background', loop });
  assert.equal(receipt.optimism, 'background');
  const row = await client.db.localMutations.get(receipt.queuedMutationId);
  assert.equal(row.syncStatus, SYNC_STATUS.PENDING);
  assert.equal(loop.cycles, 0);
  assert.equal(loop.hints, 0);
});

test("write optimism 'local-first' queues then kicks a cycle without awaiting it", async () => {
  const client = makeClient();
  const loop = fakeLoop(client);
  const receipt = await write(client, 'docs', 'r4', { v: 1 }, { loop });
  assert.equal(receipt.optimism, 'local-first');
  assert.equal(loop.hints, 1);
  assert.equal(loop.cycles, 0);
});

test("write optimism 'await-server' resolves only after acknowledgement", async () => {
  const client = makeClient();
  const loop = fakeLoop(client);
  const receipt = await write(client, 'docs', 'r5', { v: 1 }, { optimism: 'await-server', loop });
  assert.ok(loop.cycles >= 1);
  const row = await client.db.localMutations.get(receipt.queuedMutationId);
  assert.equal(row.syncStatus, SYNC_STATUS.SYNCED);
});

test("write optimism 'await-server' rejects when the server never acknowledges", async () => {
  const client = makeClient();
  const loop = fakeLoop(client, { acknowledge: false });
  await assert.rejects(
    write(client, 'docs', 'r6', { v: 1 }, { optimism: 'await-server', loop }),
    /did not acknowledge/,
  );
  // The local write is still durably queued — optimism never loses data.
  const pending = await client.pendingMutations('docs');
  assert.equal(pending.length, 1);
});

test("write optimism 'await-server' without a loop is a usage error", async () => {
  const client = makeClient();
  await assert.rejects(
    write(client, 'docs', 'r7', { v: 1 }, { optimism: 'await-server' }),
    RangeError,
  );
});

test('writeDelete follows the same optimism contract', async () => {
  const client = makeClient();
  const loop = fakeLoop(client);
  const receipt = await writeDelete(client, 'docs', 'r8', { optimism: 'await-server', loop });
  const row = await client.db.localMutations.get(receipt.queuedMutationId);
  assert.equal(row.operation, 'delete');
  assert.equal(row.syncStatus, SYNC_STATUS.SYNCED);
});

test('hasUnsyncedWork$ tracks the pending queue', async () => {
  const client = makeClient();
  const states = [];
  const subscription = hasUnsyncedWork$(client).subscribe((v) => states.push(v));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await client.queueMutation('docs', 'r9', { v: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(states, [false, true]);
  subscription.unsubscribe();
});

test('createRxSyncLoop streams state transitions with replay for late subscribers', async () => {
  const client = makeClient();
  const transport = {
    push: async () => ({ protocolVersion: 1, lastMutationId: '0', results: [] }),
    pull: async (checkpoint) => ({ protocolVersion: 1, checkpoint, hasMore: false, changes: [] }),
    snapshot: async () => ({ protocolVersion: 1, checkpoint: '0', records: [] }),
  };
  const { ProtocolSyncLoop } = await import('../dist/index.js');
  const { loop, state$ } = createRxSyncLoop(
    (onStateChange) =>
      new ProtocolSyncLoop(
        client,
        transport,
        {
          applyChanges: async () => undefined,
          replaceAuthoritative: async () => undefined,
        },
        { onStateChange, observeBrowserLifecycle: false },
      ),
  );
  // An un-started loop settles to 'stopped' after a one-shot cycle.
  const statuses = firstValueFrom(
    state$.pipe(
      filter((state) => state.status === 'stopped'),
      take(1),
    ),
  );
  await loop.syncNow();
  assert.equal((await statuses).status, 'stopped');
  // Late subscriber sees the latest state via replay.
  const replayed = await firstValueFrom(state$.pipe(take(1)));
  assert.equal(replayed.status, 'stopped');
});
