import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPTO_SYNC_BACKGROUND_TAG,
  OPTO_SYNC_RESULT_MESSAGE,
  OPTO_SYNC_WAKE_MESSAGE,
  installOptoSyncServiceWorker,
  registerOptoSyncBackgroundWake,
} from '../src/service-worker.ts';

class FakeScope {
  listeners = new Map<string, Set<(event: any) => void>>();

  addEventListener(type: string, listener: (event: any) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function extendable(extra: Record<string, unknown> = {}) {
  const promises: Promise<unknown>[] = [];
  return {
    ...extra,
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise);
    },
    done: () => Promise.allSettled(promises),
  };
}

test('concurrent message and Background Sync events share one durable cycle', async () => {
  const scope = new FakeScope();
  const responses: unknown[] = [];
  let cycles = 0;
  const controller = installOptoSyncServiceWorker({
    scope,
    timeoutMs: 2_000,
    async syncOnce() {
      cycles += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { acknowledgedMutations: 2 };
    },
  });

  const message = extendable({
    data: { type: OPTO_SYNC_WAKE_MESSAGE, requestId: 'request-1' },
    source: { postMessage: (value: unknown) => responses.push(value) },
  });
  const sync = extendable({ tag: OPTO_SYNC_BACKGROUND_TAG });
  scope.dispatch('message', message);
  scope.dispatch('sync', sync);
  await Promise.all([message.done(), sync.done()]);

  assert.equal(cycles, 1);
  assert.deepEqual(responses, [
    {
      type: OPTO_SYNC_RESULT_MESSAGE,
      requestId: 'request-1',
      ok: true,
      value: { acknowledgedMutations: 2 },
    },
  ]);

  await controller.runNow();
  assert.equal(cycles, 2, 'a later event starts a fresh bounded cycle');
  controller.close();
  assert.equal(scope.listeners.get('message')?.size, 0);
});

test('registration uses native Background Sync and falls back to a worker message', async () => {
  const tags: string[] = [];
  assert.equal(
    await registerOptoSyncBackgroundWake({
      sync: { register: async (tag) => void tags.push(tag) },
    }),
    'background-sync',
  );
  assert.deepEqual(tags, [OPTO_SYNC_BACKGROUND_TAG]);

  const messages: unknown[] = [];
  assert.equal(
    await registerOptoSyncBackgroundWake({
      active: { postMessage: (value) => messages.push(value) },
    }),
    'message',
  );
  assert.deepEqual(messages, [{ type: OPTO_SYNC_WAKE_MESSAGE }]);
});

test('timeout keeps a non-cooperative cycle single-flight until it settles', async () => {
  const scope = new FakeScope();
  let cycles = 0;
  let settleFirst!: () => void;
  const controller = installOptoSyncServiceWorker<void>({
    scope,
    timeoutMs: 1_000,
    syncOnce() {
      cycles += 1;
      if (cycles === 1) {
        return new Promise<void>((resolve) => {
          settleFirst = resolve;
        });
      }
      return Promise.resolve();
    },
  });

  const first = controller.runNow();
  await assert.rejects(
    first,
    (error: unknown) =>
      error instanceof DOMException &&
      error.name === 'AbortError' &&
      error.message === 'opto-sync background timeout',
  );

  const second = controller.runNow();
  assert.strictEqual(
    second,
    first,
    'a timeout must not clear ownership while the callback still executes',
  );
  await assert.rejects(second, /opto-sync background timeout/);
  assert.equal(cycles, 1, 'the non-cooperative callback was not overlapped');

  settleFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await controller.runNow();
  assert.equal(cycles, 2, 'a new cycle starts only after the first settles');
  controller.close();
});
