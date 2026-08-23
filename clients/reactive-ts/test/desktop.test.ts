import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DesktopSyncRunner,
  InMemoryDesktopLeaseStore,
  resolveDesktopSyncCapability,
  type DesktopLeaseGrant,
  type DesktopLeaseRequest,
  type DesktopLeaseStore,
} from '../src/desktop.ts';
import {
  initialSyncLifecycle,
  isValidSyncLifecycle,
  SyncLifecycleMachine,
  SyncLifecycleTransitionError,
  transitionSyncLifecycle,
  type SyncLifecycleEvent,
  type SyncLifecycleSnapshot,
} from '../src/sync-lifecycle.ts';

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

test('desktop owner exposes redacted lifecycle transitions', async () => {
  const transitions: Array<{
    event: string;
    before: { phase: string };
    after: { phase: string };
  }> = [];
  const runner = new DesktopSyncRunner<void>({
    leaseStore: new InMemoryDesktopLeaseStore(),
    leaseKey: 'account:observed',
    ownerId: 'desktop-observed',
    timeoutMs: 2_000,
    leaseTtlMs: 4_000,
    tokenFactory: () => 'observed-token',
    async syncOnce() {},
    onLifecycleTransition: (transition) => transitions.push(transition),
  });

  await runner.runNow();
  runner.close();

  assert.deepEqual(
    transitions.map(({ event, before, after }) => [
      before.phase,
      event,
      after.phase,
    ]),
    [
      ['idle', 'wake', 'idle'],
      ['idle', 'begin-acquire', 'acquiring'],
      ['acquiring', 'acquire-granted', 'running'],
      ['running', 'cycle-settled', 'releasing'],
      ['releasing', 'release-settled', 'idle'],
      ['idle', 'close', 'closed'],
    ],
  );
  assert.equal(
    transitions.some((transition) =>
      JSON.stringify(transition).includes('observed-token'),
    ),
    false,
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

test('close during acquisition releases a late grant without running app code', async () => {
  let request: DesktopLeaseRequest | undefined;
  let resolveGrant!: (grant: DesktopLeaseGrant) => void;
  let releases = 0;
  const store: DesktopLeaseStore = {
    tryAcquire(value) {
      request = value;
      return new Promise<DesktopLeaseGrant>((resolve) => {
        resolveGrant = resolve;
      });
    },
    async release() {
      releases += 1;
    },
  };
  let cycleCalls = 0;
  const runner = new DesktopSyncRunner<void>({
    leaseStore: store,
    leaseKey: 'account:closing',
    ownerId: 'desktop-process-closing',
    timeoutMs: 2_000,
    leaseTtlMs: 4_000,
    tokenFactory: () => 'closing-token',
    async syncOnce() {
      cycleCalls += 1;
    },
  });

  const active = runner.runNow();
  await waitFor(() => request !== undefined);
  assert.equal(runner.lifecycle.phase, 'acquiring');
  runner.close();
  resolveGrant({ ...request!, fence: '1' });
  const result = await active;

  assert.equal(cycleCalls, 0);
  assert.equal(releases, 1);
  assert.equal(result.outcomes[0]?.status, 'cancelled');
  assert.equal(runner.lifecycle.phase, 'closed');
  assert.equal(isValidSyncLifecycle(runner.lifecycle), true);
});

test('lifecycle relation is closed across every reachable event pair', () => {
  const events: readonly SyncLifecycleEvent[] = [
    'wake',
    'join',
    'begin-acquire',
    'acquire-granted',
    'acquire-deferred',
    'cancel',
    'cycle-settled',
    'release-settled',
    'close',
    'process-abort',
  ];
  const key = (state: SyncLifecycleSnapshot): string =>
    [
      state.phase,
      state.wakePending,
      state.closeRequested,
      state.cancelRequested,
      state.permitHeld,
    ].join('|');
  const reached = new Map([[key(initialSyncLifecycle), initialSyncLifecycle]]);
  const pending: SyncLifecycleSnapshot[] = [initialSyncLifecycle];
  let examined = 0;
  let sawCloseDuringAcquire = false;
  let sawTrailingWake = false;
  let sawCancellation = false;

  while (pending.length > 0) {
    const state = pending.pop()!;
    assert.equal(isValidSyncLifecycle(state), true);
    for (const event of events) {
      examined += 1;
      const next = transitionSyncLifecycle(state, event);
      if (!next) continue;
      assert.equal(isValidSyncLifecycle(next), true);
      sawCloseDuringAcquire ||=
        state.phase === 'acquiring' &&
        event === 'close' &&
        next.closeRequested;
      sawTrailingWake ||=
        state.phase === 'running' && event === 'wake' && next.wakePending;
      sawCancellation ||=
        state.phase === 'running' && event === 'cancel' && next.cancelRequested;
      const nextKey = key(next);
      if (!reached.has(nextKey)) {
        reached.set(nextKey, next);
        pending.push(next);
      }
    }
  }

  assert.equal(examined, reached.size * events.length);
  assert.equal(reached.size, 14);
  assert.equal(
    sawCloseDuringAcquire && sawTrailingWake && sawCancellation,
    true,
  );

  const machine = new SyncLifecycleMachine();
  const before = machine.state;
  assert.throws(
    () => machine.apply('begin-acquire'),
    SyncLifecycleTransitionError,
  );
  assert.strictEqual(machine.state, before);
});

test('lifecycle observer is bounded metadata and cannot alter ownership', () => {
  const observed: unknown[] = [];
  const machine = new SyncLifecycleMachine((transition) => {
    observed.push(transition);
    if (transition.event === 'wake') {
      throw new Error('broken diagnostics sink');
    }
  });

  machine.apply('wake');
  machine.apply('begin-acquire');
  machine.apply('acquire-deferred');
  machine.apply('close');

  assert.equal(machine.state.phase, 'closed');
  assert.equal(observed.length, 4);
  assert.deepEqual(Object.keys(observed[0] as object).sort(), [
    'after',
    'before',
    'event',
  ]);
  assert.equal(Object.isFrozen(observed[0]), true);
});
