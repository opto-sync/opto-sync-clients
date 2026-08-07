/**
 * Browser guarantees that unit tests structurally cannot give.
 *
 * The queue tests run against fake-indexeddb, and the cross-tab tests run
 * against a hand-written Web Locks fake. Both are useful, and both agree with
 * whatever the fake does. The three properties below are only meaningful
 * against the real thing:
 *
 *   1. DURABILITY  — a write survives the browser process exiting and starting
 *      again, on real on-disk IndexedDB (not a per-context sandbox that is
 *      thrown away, which is why this uses a persistent context and a real
 *      close/relaunch).
 *   2. LEASE / FENCING — with two real tabs on one origin, the real
 *      `navigator.locks` election must keep exactly ONE of them draining the
 *      shared queue, and must hand the lease over when the leader tab closes.
 *      Asserted against what the SERVER received, not against page-side spies:
 *      double-sending shows up as one mutationId delivered twice.
 *   3. CONSISTENCY MODES — `background` and `await-server` must be
 *      observably different. `await-server` must not report success while the
 *      server is still holding the acknowledgement.
 *
 * Every test also fails on any console error or uncaught page error.
 */
import test, { after } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serveBundle } from './helpers/bundle.mjs';
import { createSyncFixture, FIXTURE_TRANSPORT_SOURCE } from './helpers/sync-fixture.mjs';

const executablePath = process.env.OPTO_SYNC_CHROMIUM_PATH?.trim();
const browserLaunchOptions = () => ({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>opto-sync lease harness</title></head>
<body>
<script src="/opto-sync.browser.js"></script>
<script>${FIXTURE_TRANSPORT_SOURCE}</script>
</body></html>`;

/** @returns {Promise<typeof import('playwright').chromium | null>} */
async function loadChromium() {
  try {
    const { chromium } = await import('playwright');
    // Prove a browser can actually start before declaring the suite runnable.
    const probe = await chromium.launch(browserLaunchOptions());
    await probe.close();
    return chromium;
  } catch (err) {
    console.log(`      chromium unavailable: ${String(err).split('\n')[0]}`);
    return null;
  }
}

const chromium = await loadChromium();

/*
 * A browser suite that quietly skips looks exactly like a browser suite that
 * passes. CI sets OPTO_SYNC_REQUIRE_BROWSER=1, which turns "no Chromium" from
 * a skip into a hard failure, so these guarantees cannot silently stop being
 * checked. Locally, without the variable, the suite still degrades to a skip.
 */
if (!chromium && process.env.OPTO_SYNC_REQUIRE_BROWSER === '1') {
  throw new Error(
    'OPTO_SYNC_REQUIRE_BROWSER=1 but Chromium could not be launched; ' +
      'run `npx playwright install --with-deps chromium`',
  );
}
const SKIP = chromium ? false : 'headless Chromium could not be launched';

/** Fail the test on any console error or uncaught exception in a page. */
function watchForErrors(page, sink) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') sink.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => sink.push(`pageerror: ${String(err)}`));
}

/** Poll `probe` until it returns truthy, or fail with `label`. */
async function waitFor(probe, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}; last value: ${JSON.stringify(last)}`);
}

/* ------------------------------------------------------------------ */
/* 1. Durability across a real browser close and reopen                */
/* ------------------------------------------------------------------ */

test(
  'a queued write survives the browser process closing and reopening',
  { skip: SKIP, timeout: 180_000 },
  async (t) => {
    const server = await serveBundle(HTML);
    const userDataDir = await mkdtemp(join(tmpdir(), 'opto-sync-persist-'));
    t.after(async () => {
      await server.close();
      await rm(userDataDir, { recursive: true, force: true });
    });

    const DB = 'opto-lease-durability';

    /* --- first run of the browser: queue two writes, then quit --- */
    const first = await chromium.launchPersistentContext(
      userDataDir,
      browserLaunchOptions(),
    );
    const errorsA = [];
    const pageA = await first.newPage();
    watchForErrors(pageA, errorsA);
    await pageA.goto(`${server.origin}/`, { waitUntil: 'load' });

    const written = await pageA.evaluate(async (databaseName) => {
      const { createOptoSyncClient } = window.OptoSync;
      const client = await createOptoSyncClient({ databaseName });
      await client.queueMutation('todos', 'survives-restart', {
        title: 'written before the browser quit',
        updatedAt: '1000',
      });
      await client.queueMutation('todos', 'second', { title: 'also queued', updatedAt: '1001' });
      const pending = await client.pendingMutations();
      // Close the connection so the write is flushed rather than merely
      // buffered in this process.
      client.db.close();
      return {
        count: pending.length,
        ids: pending.map((m) => m.recordId).sort(),
        origin: location.origin,
      };
    }, DB);

    assert.deepStrictEqual(errorsA, [], 'first run logged page errors');
    assert.strictEqual(written.count, 2);
    assert.deepStrictEqual(written.ids, ['second', 'survives-restart']);
    assert.ok(written.origin.startsWith('http://127.0.0.1:'), 'must be a real HTTP origin');

    // A real browser exit, not just a page navigation.
    await first.close();

    /* --- second run: same profile directory, brand-new process --- */
    const second = await chromium.launchPersistentContext(
      userDataDir,
      browserLaunchOptions(),
    );
    const errorsB = [];
    const pageB = await second.newPage();
    watchForErrors(pageB, errorsB);
    t.after(async () => {
      await second.close();
    });
    await pageB.goto(`${server.origin}/`, { waitUntil: 'load' });

    const recovered = await pageB.evaluate(async (databaseName) => {
      const { OptoSyncClient } = window.OptoSync;
      // Read through the bare IndexedDB API as well, so the assertion cannot be
      // satisfied by anything Dexie is holding in memory.
      const databases = (await indexedDB.databases()).map((d) => d.name);
      const client = new OptoSyncClient({ databaseName });
      const pending = await client.pendingMutations();
      const payload = JSON.parse(
        pending.find((m) => m.recordId === 'survives-restart')?.jsonPayload ?? 'null',
      );
      // The mutation counter must survive too, or the next write would reuse a
      // mutationId the server has already seen and be silently deduped away.
      const request = await client.protocolPushRequest();
      const nextId = await client.queueMutation('todos', 'after-restart', { title: 'new' });
      const afterRestart = await client.protocolPushRequest();
      return {
        databases,
        pendingIds: pending.map((m) => m.recordId).sort(),
        payload,
        mutationIds: request.mutations.map((m) => m.mutationId),
        mutationIdsAfter: afterRestart.mutations.map((m) => m.mutationId),
        nextId,
      };
    }, DB);

    assert.deepStrictEqual(errorsB, [], 'second run logged page errors');
    assert.ok(
      recovered.databases.includes(DB),
      `the relaunched browser does not know the database: ${recovered.databases.join(', ')}`,
    );
    assert.deepStrictEqual(
      recovered.pendingIds,
      ['second', 'survives-restart'],
      'queued writes must survive a real browser restart',
    );
    assert.deepStrictEqual(
      recovered.payload,
      { title: 'written before the browser quit', updatedAt: '1000' },
      'the payload must come back byte-identical',
    );
    assert.deepStrictEqual(
      recovered.mutationIds,
      ['1', '2'],
      'mutation identity must survive the restart',
    );
    assert.deepStrictEqual(
      recovered.mutationIdsAfter,
      ['1', '2', '3'],
      'the mutation counter must continue after the restart, never restart at 1',
    );
  },
);

/* ------------------------------------------------------------------ */
/* 2. Lease / fencing: two real tabs, exactly one sender               */
/* ------------------------------------------------------------------ */

test(
  'two real tabs elect one sender: the queue is never double-sent',
  { skip: SKIP, timeout: 180_000 },
  async (t) => {
    const fixture = createSyncFixture();
    const server = await serveBundle(HTML, fixture.route);
    const browser = await chromium.launch(browserLaunchOptions());
    // One context = one origin = one IndexedDB, one BroadcastChannel bus and
    // one Web Locks namespace, exactly like two tabs of a real app.
    const context = await browser.newContext();
    t.after(async () => {
      await browser.close();
      await server.close();
    });

    const errors = [];
    const DB = 'opto-lease-fencing';

    /** Boot one "tab": client + real sync loop + cross-tab coordinator. */
    const boot = async (page, tabName) => {
      watchForErrors(page, errors);
      await page.goto(`${server.origin}/`, { waitUntil: 'load' });
      await page.evaluate(
        async ({ databaseName, name }) => {
          const { createOptoSyncClient, ProtocolSyncLoop, startCrossTabCoordinator } =
            window.OptoSync;
          window.tabName = name;
          window.client = await createOptoSyncClient({ databaseName });
          window.loop = new ProtocolSyncLoop(
            window.client,
            window.makeFixtureTransport(),
            window.noopCallbacks(),
            { observeBrowserLifecycle: false },
          );
          // The real Web Locks API and the real BroadcastChannel — no fakes.
          window.coordinator = startCrossTabCoordinator({ loop: window.loop });
        },
        { databaseName: DB, name: tabName },
      );
    };

    const tabA = await context.newPage();
    await boot(tabA, 'A');
    const tabB = await context.newPage();
    await boot(tabB, 'B');

    const leadership = async () => ({
      a: await tabA.evaluate(() => window.coordinator.isLeader),
      b: await tabB.evaluate(() => window.coordinator.isLeader),
    });

    const elected = await waitFor(
      async () => {
        const state = await leadership();
        return state.a || state.b ? state : null;
      },
      'a leader to be elected',
    );
    assert.strictEqual(
      Number(elected.a) + Number(elected.b),
      1,
      `exactly one tab must hold the lease, got ${JSON.stringify(elected)}`,
    );

    /* Both tabs write into the ONE shared IndexedDB queue. */
    const queueFrom = (page, prefix, count) =>
      page.evaluate(
        async ({ prefix: p, count: n }) => {
          for (let i = 0; i < n; i += 1) {
            await window.client.queueMutation('todos', `${p}-${i}`, { title: `${p}-${i}` });
          }
          window.coordinator.hint();
        },
        { prefix, count },
      );

    await queueFrom(tabA, 'from-a', 3);
    await queueFrom(tabB, 'from-b', 3);

    /* Drain is complete when the shared queue is empty in the browser. */
    await waitFor(
      async () => (await tabA.evaluate(() => window.client.pendingMutations())).length === 0,
      'the shared queue to drain',
    );

    const log = await (await fetch(`${server.origin}/sync/log`)).json();
    assert.strictEqual(
      log.distinctMutations,
      6,
      `the server must receive all six mutations, got ${log.distinctMutations}`,
    );
    assert.deepStrictEqual(
      log.duplicateDeliveries,
      [],
      'a mutation reached the server more than once: the lease did not fence the second tab',
    );
    const clientIds = new Set(log.pushes.map((p) => p.clientId));
    assert.strictEqual(
      clientIds.size,
      1,
      'both tabs share one queue, so every push must carry the same clientId',
    );

    /* --- the lease must transfer when the leader tab closes --- */
    const leaderPage = elected.a ? tabA : tabB;
    const followerPage = elected.a ? tabB : tabA;
    await leaderPage.close();

    await waitFor(
      () => followerPage.evaluate(() => window.coordinator.isLeader),
      'the surviving tab to be promoted after the leader closed',
    );

    // …and the promoted tab must actually drain, not just claim the title.
    await followerPage.evaluate(async () => {
      await window.client.queueMutation('todos', 'after-handover', { title: 'after handover' });
      window.coordinator.hint();
    });
    await waitFor(
      async () => (await followerPage.evaluate(() => window.client.pendingMutations())).length === 0,
      'the promoted tab to drain the queue',
    );

    const finalLog = await (await fetch(`${server.origin}/sync/log`)).json();
    assert.strictEqual(finalLog.distinctMutations, 7, 'the post-handover write must reach the server');
    assert.deepStrictEqual(
      finalLog.duplicateDeliveries,
      [],
      'the lease handover must not replay mutations the previous leader already sent',
    );
    assert.deepStrictEqual(errors, [], 'the tabs logged errors');
  },
);

/* ------------------------------------------------------------------ */
/* 3. Consistency modes are observably different                       */
/* ------------------------------------------------------------------ */

test(
  "'await-server' does not report success before the server confirms",
  { skip: SKIP, timeout: 180_000 },
  async (t) => {
    const fixture = createSyncFixture();
    const server = await serveBundle(HTML, fixture.route);
    const browser = await chromium.launch(browserLaunchOptions());
    t.after(async () => {
      await browser.close();
      await server.close();
    });

    const errors = [];
    const page = await browser.newPage();
    watchForErrors(page, errors);
    await page.goto(`${server.origin}/`, { waitUntil: 'load' });

    await page.evaluate(async () => {
      const { createOptoSyncClient, ProtocolSyncLoop } = window.OptoSync;
      window.makeSession = async (databaseName) => {
        const client = await createOptoSyncClient({ databaseName });
        const loop = new ProtocolSyncLoop(
          client,
          window.makeFixtureTransport(),
          window.noopCallbacks(),
          { observeBrowserLifecycle: false },
        );
        return { client, loop };
      };
    });

    /* --- 'background': resolves while the write is still only local --- */
    fixture.closeGate();

    const background = await page.evaluate(async () => {
      const { client, loop } = await window.makeSession('opto-mode-background');
      const { SYNC_STATUS, rx } = window.OptoSync;
      const started = performance.now();
      const receipt = await rx.write(
        client,
        'docs',
        'bg-1',
        { title: 'fire and forget' },
        { optimism: 'background', loop },
      );
      const elapsed = performance.now() - started;
      const row = await client.db.localMutations.get(receipt.queuedMutationId);
      return {
        elapsed,
        optimism: receipt.optimism,
        hasCycle: receipt.cycle !== undefined,
        stillPending: row.syncStatus === SYNC_STATUS.PENDING,
      };
    });

    assert.strictEqual(background.optimism, 'background');
    assert.strictEqual(
      background.stillPending,
      true,
      "'background' must resolve with the mutation still queued locally",
    );
    assert.strictEqual(
      background.hasCycle,
      false,
      "'background' must not report a server cycle",
    );
    // The server is holding every acknowledgement, so a mode that resolved
    // this fast provably did not wait for one.
    assert.ok(
      background.elapsed < 2_000,
      `'background' must not block on the server, took ${background.elapsed}ms`,
    );
    assert.strictEqual(
      fixture.pushes.length,
      0,
      "'background' must not push on its own; nothing should have reached the server",
    );

    /* --- 'await-server': must NOT resolve while the gate is closed --- */
    await page.evaluate(async () => {
      const { client, loop } = await window.makeSession('opto-mode-await');
      window.awaitClient = client;
      window.awaitState = { settled: false, receipt: null, error: null };
      window.awaitPromise = window.OptoSync.rx
        .write(client, 'docs', 'await-1', { title: 'must be saved' }, {
          optimism: 'await-server',
          loop,
        })
        .then(
          (receipt) => {
            window.awaitState = { settled: true, receipt, error: null };
          },
          (error) => {
            window.awaitState = { settled: true, receipt: null, error: String(error) };
          },
        );
    });

    // The request must actually reach the server (so this is a real
    // confirmation wait, not a client-side stall)…
    await waitFor(() => fixture.pushes.length > 0, 'the push to reach the server');

    // …and while the server withholds the acknowledgement, the write must NOT
    // be reported as committed.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const whileGated = await page.evaluate(async () => {
      const { SYNC_STATUS } = window.OptoSync;
      const pending = await window.awaitClient.pendingMutations();
      return { settled: window.awaitState.settled, pendingCount: pending.length, SYNC_STATUS };
    });
    assert.strictEqual(
      whileGated.settled,
      false,
      "'await-server' resolved before the server acknowledged the mutation",
    );
    assert.strictEqual(
      whileGated.pendingCount,
      1,
      'the mutation must remain queued until it is acknowledged',
    );
    assert.ok(fixture.pushes.length > 0, 'the server must already have the batch in hand');

    /* --- release the acknowledgement: only now may it resolve --- */
    fixture.openGate();

    const settled = await waitFor(
      async () => {
        const state = await page.evaluate(() => window.awaitState);
        return state.settled ? state : null;
      },
      "'await-server' to resolve once the server confirmed",
    );
    assert.strictEqual(settled.error, null, `await-server rejected: ${settled.error}`);
    assert.strictEqual(settled.receipt.optimism, 'await-server');
    assert.ok(
      settled.receipt.cycle,
      "'await-server' must report the sync cycle that carried the confirmation",
    );

    const afterConfirm = await page.evaluate(async () => {
      const pending = await window.awaitClient.pendingMutations();
      return { pendingCount: pending.length };
    });
    assert.strictEqual(
      afterConfirm.pendingCount,
      0,
      'the acknowledged mutation must have left the queue',
    );
    assert.deepStrictEqual(errors, [], 'the page logged errors');
  },
);

/* ------------------------------------------------------------------ */
/* 4. Regression: a disposed coordinator must not strand the lease     */
/* ------------------------------------------------------------------ */

test(
  'disposing coordinators never strands the leader lease or throws',
  { skip: SKIP, timeout: 180_000 },
  async (t) => {
    const server = await serveBundle(HTML);
    const browser = await chromium.launch(browserLaunchOptions());
    t.after(async () => {
      await browser.close();
      await server.close();
    });

    const errors = [];
    const page = await browser.newPage();
    watchForErrors(page, errors);
    await page.goto(`${server.origin}/`, { waitUntil: 'load' });

    const result = await page.evaluate(async () => {
      const { startCrossTabCoordinator } = window.OptoSync;
      const noopLoop = { start() {}, stop() {}, hint() {} };
      const lockName = `strand-probe-${Math.random().toString(36).slice(2)}`;

      // A component that mounts and unmounts immediately (React StrictMode,
      // a fast route change) disposes the coordinator while the browser is
      // still deciding whether to grant the lock. If a disposed coordinator
      // keeps the granted lock, NOTHING on this origin can ever lead again.
      let lateHintThrew = null;
      for (let i = 0; i < 30; i += 1) {
        const coordinator = startCrossTabCoordinator({ loop: noopLoop, lockName });
        coordinator.dispose();
        try {
          // Post-dispose calls come from in-flight saves and must be no-ops,
          // not InvalidStateError from a closed BroadcastChannel.
          coordinator.hint();
          coordinator.publishState({ status: 'idle', consecutiveFailures: 0 });
          coordinator.dispose();
        } catch (error) {
          lateHintThrew = String(error);
        }
      }

      // The lease must still be grantable.
      const survivor = startCrossTabCoordinator({ loop: noopLoop, lockName });
      const deadline = Date.now() + 10_000;
      while (!survivor.isLeader && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const becameLeader = survivor.isLeader;

      // Ask the browser itself who holds the lock, so this is the real lock
      // state and not just what the coordinator believes.
      const held = await navigator.locks.query();
      const strandedHolders = held.held.filter((lock) => lock.name === lockName).length;
      const queued = held.pending.filter((lock) => lock.name === lockName).length;
      survivor.dispose();

      return { becameLeader, lateHintThrew, strandedHolders, queued };
    });

    assert.strictEqual(
      result.lateHintThrew,
      null,
      `hint()/publishState() after dispose() threw: ${result.lateHintThrew}`,
    );
    assert.strictEqual(
      result.becameLeader,
      true,
      'a fresh coordinator could not acquire the lease: a disposed one is still holding it',
    );
    assert.strictEqual(
      result.strandedHolders,
      1,
      `exactly the live coordinator should hold the lock, browser reports ${result.strandedHolders}`,
    );
    assert.strictEqual(result.queued, 0, 'disposed coordinators must not stay queued for the lock');
    assert.deepStrictEqual(errors, [], 'the page logged errors');
  },
);

test('report whether a real browser was exercised', () => {
  // Explicit, so a skipped browser suite is visible rather than looking green.
  console.log(
    chromium
      ? '      real browser exercised: Chromium (persistent context + multi-tab)'
      : '      real browser NOT exercised (Chromium unavailable)',
  );
  assert.ok(true);
});

after(() => {
  // Nothing global to tear down: every test owns its browser.
});
