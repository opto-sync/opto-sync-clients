import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SYNC_OPTIMISM,
  writeWithOptimism,
} from '../src/index.ts';

const session = {
  status: 'authenticated' as const,
  identity: {
    shared_user_id: 'user-1',
    provider: 'shared-auth',
    provider_tenant: 'app',
    provider_subject: 'subject-1',
    session_id: 'session-1',
  },
};

function harness() {
  const calls: string[] = [];
  return {
    calls,
    local: {
      async commitLocalAndQueue(value: { title: string }) {
        calls.push(`local:${value.title}`);
        return 41;
      },
      async commitAuthoritative(value: { title: string }) {
        calls.push(`authoritative:${value.title}`);
      },
    },
    remote: {
      async write(value: { title: string }) {
        calls.push(`remote:${value.title}`);
        return { ...value, title: `${value.title}-server` };
      },
    },
    sync: {
      hint() {
        calls.push('hint');
      },
      async syncNow() {
        calls.push('sync');
        return { acknowledgedMutations: 1 };
      },
    },
    wakeBackground: async () => {
      calls.push('wake');
    },
  };
}

test('remote-confirmed waits for server before touching local state', async () => {
  const state = harness();
  const result = await writeWithOptimism({
    strategy: SYNC_OPTIMISM.remoteConfirmed,
    session,
    value: { title: 'draft' },
    ...state,
  });
  assert.deepEqual(state.calls, ['remote:draft', 'authoritative:draft-server']);
  assert.equal(result.status, 'confirmed');
});

test('local-durable returns after queue commit and only hints the network', async () => {
  const state = harness();
  const result = await writeWithOptimism({
    strategy: SYNC_OPTIMISM.localDurable,
    session,
    value: { title: 'offline' },
    ...state,
  });
  assert.deepEqual(state.calls, ['local:offline', 'hint', 'wake']);
  assert.equal(result.status, 'queued');
  assert.equal(result.localResult, 41);
});

test('local-then-remote exposes optimistic state but awaits one protocol cycle', async () => {
  const state = harness();
  const result = await writeWithOptimism({
    strategy: SYNC_OPTIMISM.localThenRemote,
    session,
    value: { title: 'save-and-wait' },
    ...state,
  });
  assert.deepEqual(state.calls, [
    'local:save-and-wait',
    'hint',
    'wake',
    'sync',
  ]);
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(result.syncResult, { acknowledgedMutations: 1 });
});
