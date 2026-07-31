import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DesktopSyncRunner,
  InMemoryDesktopLeaseStore,
  resolveDesktopSyncCapability,
} from '../src/desktop.ts';

async function waitFor(testValue: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!testValue()) {
    if (Date.now() > deadline) throw new Error('condition did not become true');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('coalesces wake bursts but preserves one trailing desktop cycle', async () => {
  const store = new InMemoryDesktopLeaseStore();
  const releases: Array<() => void> = [];
  const contexts: Array<{ reasons: readonly string[]; fence: string }> = [];
  let token = 0;
  const runner = new DesktopSyncRunner<number>({
    leaseStore: store,
    leaseKey: 'account:one',
    ownerId: 'desktop-process-a',
    timeoutMs: 2_000,
    leaseTtlMs: 4_000,
    tokenFactory: () => `token-${++token}`,
    async syncOnce(context) {
      contexts.push({ reasons: context.reasons, fence: context.fence });
      await new Promise<void>((resolve) => releases.push(resolve));
      return contexts.length;
    },
  });

  const first = runner.wake('process-start');
  await waitFor(() => releases.length === 1);
  const second = runner.wake('local-mutation');
  const third = runner.wake('remote-change');
  assert.strictEqual(first, second);
  assert.strictEqual(first, third);

  releases.shift()?.();
  await waitFor(() => releases.length === 1 && contexts.length === 2);
  releases.shift()?.();

  const result = await first;
  assert.equal(result.outcomes.length, 2);
  assert.deepEqual(contexts, [
    { reasons: ['process-start'], fence: '1' },
    { reasons: ['local-mutation', 'remote-change'], fence: '2' },
  ]);
  assert.deepEqual(
    result.outcomes.map((outcome) => outcome.status),
    ['completed', 'completed'],
  );
});

test('durable lease excludes a second process and fences its later retry', async () => {
  const store = new InMemoryDesktopLeaseStore();
  let releaseFirst!: () => void;
  const first = new DesktopSyncRunner<string>({
    leaseStore: store,
    leaseKey: 'account:shared',
    ownerId: 'process-a',
    timeoutMs: 2_000,
    leaseTtlMs: 4_000,
    tokenFactory: () => 'token-a',
    async syncOnce() {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return 'first';
    },
  });
  let secondCalls = 0;
  let secondToken = 0;
  const second = new DesktopSyncRunner<string>({
    leaseStore: store,
    leaseKey: 'account:shared',
    ownerId: 'process-b',
    timeoutMs: 2_000,
    leaseTtlMs: 4_000,
    tokenFactory: () => `token-b-${++secondToken}`,
    async syncOnce() {
      secondCalls += 1;
      return 'second';
    },
  });

  const active = first.runNow();
  await waitFor(() => typeof releaseFirst === 'function');
  const blocked = await second.runNow();
  assert.equal(blocked.outcomes[0]?.status, 'busy');
  assert.equal(secondCalls, 0);

  releaseFirst();
  const firstResult = await active;
  assert.equal(firstResult.outcomes[0]?.fence, '1');
  const retry = await second.wake('connectivity');
  assert.equal(retry.outcomes[0]?.status, 'completed');
  assert.equal(retry.outcomes[0]?.fence, '2');
  assert.equal(secondCalls, 1);
});

test('capabilities do not misrepresent WASM as a persistent OS daemon', () => {
  assert.deepEqual(
    resolveDesktopSyncCapability({
      runtime: 'wasm-webview',
      serviceWorkerAvailable: true,
      tcpAvailable: true,
    }),
    {
      runtime: 'wasm-webview',
      executionClass: 'service-worker-events',
      http: true,
      websocketLifetime: 'foreground',
      tcp: 'unsupported',
      survivesWindowClosure: true,
      survivesHostTermination: false,
      exactIntervalsGuaranteed: false,
    },
  );

  assert.deepEqual(
    resolveDesktopSyncCapability({
      runtime: 'electron',
      persistentNativeRunnerAvailable: true,
      tcpAvailable: true,
    }),
    {
      runtime: 'electron',
      executionClass: 'persistent-native-runner',
      http: true,
      websocketLifetime: 'host-process',
      tcp: 'native',
      survivesWindowClosure: true,
      survivesHostTermination: true,
      exactIntervalsGuaranteed: false,
    },
  );

  assert.throws(
    () =>
      resolveDesktopSyncCapability({
        runtime: 'wasm-webview',
        persistentNativeRunnerAvailable: true,
      }),
    /native host bridge/,
  );
});

test('close aborts the active cycle and refuses new wakes', async () => {
  const store = new InMemoryDesktopLeaseStore();
  const runner = new DesktopSyncRunner<void>({
    leaseStore: store,
    leaseKey: 'account:close',
    ownerId: 'desktop-process',
    timeoutMs: 2_000,
    leaseTtlMs: 4_000,
    tokenFactory: () => 'close-token',
    syncOnce: (context) =>
      new Promise((_resolve, reject) => {
        context.signal.addEventListener(
          'abort',
          () => reject(context.signal.reason),
          { once: true },
        );
      }),
  });

  const active = runner.runNow();
  await new Promise((resolve) => setTimeout(resolve, 10));
  runner.close();
  const result = await active;
  assert.equal(result.outcomes[0]?.status, 'failed');
  assert.equal(result.outcomes[0]?.failurePhase, 'cycle');
  await assert.rejects(runner.runNow(), /closed/);
});
