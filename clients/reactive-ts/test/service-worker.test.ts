import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPTO_SYNC_BACKGROUND_TAG,
  OPTO_SYNC_FAILURE_CODE,
  OPTO_SYNC_LEGACY_BACKGROUND_TAG,
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

test('a legacy Background Sync registration still wakes the upgraded worker', async () => {
  const scope = new FakeScope();
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    timeoutMs: 2_000,
    async syncOnce() {
      cycles += 1;
    },
  });

  const sync = extendable({ tag: OPTO_SYNC_LEGACY_BACKGROUND_TAG });
  scope.dispatch('sync', sync);
  await sync.done();
  assert.equal(cycles, 1);
});

test('explicit additional tags replace the implicit migration alias', async () => {
  const scope = new FakeScope();
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    timeoutMs: 2_000,
    additionalTags: ['tenant-sync'],
    async syncOnce() {
      cycles += 1;
    },
  });

  const legacy = extendable({ tag: OPTO_SYNC_LEGACY_BACKGROUND_TAG });
  scope.dispatch('sync', legacy);
  await legacy.done();
  assert.equal(cycles, 0);

  const tenant = extendable({ tag: 'tenant-sync' });
  scope.dispatch('sync', tenant);
  await tenant.done();
  assert.equal(cycles, 1);
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

  const afterRegistrationFailure: unknown[] = [];
  assert.equal(
    await registerOptoSyncBackgroundWake({
      sync: {
        register: async () => {
          throw new Error('browser quota denied');
        },
      },
      active: {
        postMessage: (value) => afterRegistrationFailure.push(value),
      },
    }),
    'message',
  );
  assert.deepEqual(afterRegistrationFailure, [
    { type: OPTO_SYNC_WAKE_MESSAGE },
  ]);
});

test('message failure responses never echo transport credentials', async () => {
  const scope = new FakeScope();
  const responses: unknown[] = [];
  installOptoSyncServiceWorker({
    scope,
    timeoutMs: 2_000,
    async syncOnce() {
      throw new Error('Bearer secret-token at postgres://tenant.example');
    },
  });
  const message = extendable({
    data: { type: OPTO_SYNC_WAKE_MESSAGE, requestId: 'redaction-check' },
    source: { postMessage: (value: unknown) => responses.push(value) },
  });
  scope.dispatch('message', message);
  await message.done();

  assert.deepEqual(responses, [
    {
      type: OPTO_SYNC_RESULT_MESSAGE,
      requestId: 'redaction-check',
      ok: false,
      error: OPTO_SYNC_FAILURE_CODE,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(responses), /secret-token|postgres/);
});

test('observer and detached-client failures cannot escape the event lifetime', async () => {
  const scope = new FakeScope();
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    timeoutMs: 2_000,
    onError() {
      throw new Error('broken logger');
    },
    async syncOnce() {
      cycles += 1;
      throw new Error('Bearer should-stay-private');
    },
  });
  const message = extendable({
    data: { type: OPTO_SYNC_WAKE_MESSAGE, requestId: 'detached-client' },
    source: {
      postMessage() {
        throw new Error('client was closed');
      },
    },
  });
  scope.dispatch('message', message);
  const settled = await message.done();

  assert.equal(cycles, 1);
  assert.deepEqual(settled.map(({ status }) => status), ['fulfilled']);
});

test('close aborts an active drain and permanently refuses new work', async () => {
  const scope = new FakeScope();
  const controller = installOptoSyncServiceWorker<void>({
    scope,
    timeoutMs: 2_000,
    syncOnce(signal) {
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
  });

  const active = controller.runNow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.close();
  await assert.rejects(
    active,
    (error: unknown) =>
      error instanceof DOMException &&
      error.name === 'AbortError' &&
      error.message === 'service-worker sync controller closed',
  );
  await assert.rejects(controller.runNow(), /controller is closed/);
  assert.equal(scope.listeners.get('sync')?.size, 0);
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
