/**
 * The claim this whole package makes is "optimistic writes to IndexedDB in the
 * browser". This test is the only thing that actually checks that claim: it
 * runs the bundled client inside headless Chromium, against the browser's own
 * IndexedDB implementation and the browser's own WebAssembly engine. No
 * fake-indexeddb, no jsdom, no shims.
 *
 * If Chromium cannot be launched (no download available in the environment),
 * the test SKIPS rather than silently passing, and the jsdom + fake-indexeddb
 * coverage in browser-fallback.test.mjs stands in for it.
 */
import test, { after } from 'node:test';
import assert from 'node:assert';

import { bundleBrowserClient, serveBundle } from './helpers/bundle.mjs';
import { RECONCILE_SCENARIOS } from './helpers/corpus.mjs';

/* Native results computed in Node, to compare the browser's against. */
import * as nativeClient from '../dist/reconcile.js';

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>opto-sync browser harness</title></head>
<body><script src="/opto-sync.browser.js"></script></body></html>`;

/** @returns {Promise<import('playwright').Browser|null>} */
async function launchChromium() {
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch({ headless: true });
  } catch (err) {
    console.log(`      chromium unavailable: ${err.message.split('\n')[0]}`);
    return null;
  }
}

const browser = await launchChromium();

/* Without this the browser process keeps the event loop alive and the test
   file never exits. */
after(async () => {
  if (browser) await browser.close();
});

test(
  'the bundled client runs in real Chromium against real IndexedDB',
  { skip: browser ? false : 'headless Chromium could not be launched', timeout: 120_000 },
  async (t) => {
    const server = await serveBundle(HTML);
    const page = await (await browser.newContext()).newPage();

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    t.after(async () => {
      await page.context().close();
      await server.close();
    });

    await page.goto(`${server.origin}/`, { waitUntil: 'load' });

    /* Environment sanity: this must be a genuine browser with a real origin,
       real IndexedDB and no Node in sight — otherwise the rest proves nothing. */
    const env = await page.evaluate(() => ({
      origin: location.origin,
      hasIndexedDB: typeof indexedDB !== 'undefined',
      indexedDBCtor: Object.prototype.toString.call(indexedDB),
      hasWasm: typeof WebAssembly === 'object',
      hasRequire: typeof require !== 'undefined',
      hasProcess: typeof process !== 'undefined',
      exports: Object.keys(window.OptoSync ?? {}).sort(),
    }));
    assert.ok(env.origin.startsWith('http://127.0.0.1:'), 'must be a real HTTP origin');
    assert.ok(env.hasIndexedDB, 'no IndexedDB in the page');
    assert.strictEqual(env.indexedDBCtor, '[object IDBFactory]', 'not the native IDBFactory');
    assert.ok(env.hasWasm);
    assert.strictEqual(env.hasRequire, false, 'the bundle must not need require()');
    assert.strictEqual(env.hasProcess, false, 'the bundle must not need process');
    for (const name of ['OptoSyncClient', 'initOptoSync', 'reconcileIncoming', 'createOptoSyncClient']) {
      assert.ok(env.exports.includes(name), `window.OptoSync.${name} missing`);
    }

    /* ---------------- the actual client, in the browser ---------------- */
    const result = await page.evaluate(async (scenarios) => {
      const {
        initOptoSync,
        isOptoSyncReady,
        createOptoSyncClient,
        OptoSyncClient,
        SYNC_STATUS,
        reconcileIncoming,
        engineVersion,
        mergeEngineKind,
        DEFAULT_RECONCILE_OPTIONS,
      } = window.OptoSync;

      const readyBeforeInit = isOptoSyncReady();
      let threwBeforeInit = null;
      try {
        reconcileIncoming({ a: 1 }, { a: 2 });
      } catch (err) {
        threwBeforeInit = err.message;
      }

      await initOptoSync();
      // Idempotence, in the browser.
      await Promise.all([initOptoSync(), initOptoSync()]);

      /* ---- optimistic writes land in genuine IndexedDB ---- */
      const client = await createOptoSyncClient({ databaseName: 'opto-browser-e2e' });
      const id1 = await client.queueMutation('todos', 'todo-1', {
        title: 'buy milk',
        updatedAt: 111,
      });
      await client.queueMutation('todos', 'todo-2', { title: 'walk dog', updatedAt: 112 });
      const pendingAfterQueue = (await client.pendingMutations()).map((m) => m.recordId).sort();

      await client.markMutation(id1, SYNC_STATUS.SYNCED);
      const pendingAfterMark = (await client.pendingMutations()).map((m) => m.recordId);

      /* Prove the data is in the browser's IndexedDB and not in some in-memory
         Dexie fallback: close the connection, enumerate the databases the
         BROWSER knows about, then reopen with a brand-new client (a reload). */
      client.db.close();
      const dbNames = (await indexedDB.databases()).map((d) => d.name);

      const reopened = new OptoSyncClient({ databaseName: 'opto-browser-e2e' });
      const pendingAfterReload = (await reopened.pendingMutations()).map((m) => m.recordId);
      const reloadedPayload = JSON.parse(
        (await reopened.pendingMutations())[0]?.jsonPayload ?? 'null',
      );

      /* ---- read the raw record back through the bare IndexedDB API ---- */
      const rawRecords = await new Promise((resolve, reject) => {
        const req = indexedDB.open('opto-browser-e2e');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('localMutations', 'readonly');
          const all = tx.objectStore('localMutations').getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result);
          };
          all.onerror = () => reject(all.error);
        };
      });

      /* ---- reconcile scenarios, executed by wasm in the browser ---- */
      const reconciled = scenarios.map(([name, local, incoming, options]) => [
        name,
        JSON.stringify(reconcileIncoming(local, incoming, options)),
      ]);

      /* ---- a full optimistic round trip: local edit, stale server echo ---- */
      const localDoc = { id: 'doc-1', title: 'edited offline', updatedAt: 5000, rows: [{ id: 'a', v: 1 }] };
      await reopened.queueMutation('docs', 'doc-1', localDoc);
      const staleServerEcho = { id: 'doc-1', title: 'server had an old copy', updatedAt: 10, rows: [] };
      const roundTrip = reopened.reconcileIncoming('docs', 'doc-1', staleServerEcho, localDoc);

      reopened.db.close();
      await new Promise((resolve) => {
        const del = indexedDB.deleteDatabase('opto-browser-e2e');
        del.onsuccess = del.onerror = del.onblocked = () => resolve();
      });

      return {
        readyBeforeInit,
        threwBeforeInit,
        readyAfterInit: isOptoSyncReady(),
        engineKind: mergeEngineKind(),
        engineVersion: engineVersion(),
        defaults: { ...DEFAULT_RECONCILE_OPTIONS },
        pendingAfterQueue,
        pendingAfterMark,
        dbNames,
        pendingAfterReload,
        reloadedPayload,
        rawRecordCount: rawRecords.length,
        rawRecord: rawRecords.find((r) => r.recordId === 'todo-2') ?? null,
        reconciled,
        roundTrip,
      };
    }, RECONCILE_SCENARIOS);

    assert.deepStrictEqual(consoleErrors, [], 'the page logged errors');

    /* --- the engine --- */
    assert.strictEqual(result.readyBeforeInit, false, 'no engine before initOptoSync()');
    assert.match(
      result.threwBeforeInit ?? '',
      /no merge engine installed/,
      'reconciling before init must fail loudly, not silently',
    );
    assert.strictEqual(result.readyAfterInit, true);
    assert.strictEqual(result.engineKind, 'wasm', 'the browser must be running the wasm engine');
    assert.strictEqual(result.engineVersion, '0.2.0');

    /* --- the cross-tier default policy contract --- */
    assert.deepStrictEqual(result.defaults, {
      arrayStrategy: 4,
      arrayMatchKeys: 'id',
      resolveByTimestamp: true,
      lwwKeys: 'updatedAt,syncedAt',
      fwwKeys: 'createdAt',
    });

    /* --- real IndexedDB --- */
    assert.deepStrictEqual(result.pendingAfterQueue, ['todo-1', 'todo-2']);
    assert.deepStrictEqual(result.pendingAfterMark, ['todo-2'], 'synced write must leave the queue');
    assert.ok(
      result.dbNames.includes('opto-browser-e2e'),
      `the browser did not report the database as its own: ${result.dbNames.join(', ')}`,
    );
    assert.deepStrictEqual(
      result.pendingAfterReload,
      ['todo-2'],
      'the queue must survive closing and reopening the database',
    );
    assert.deepStrictEqual(result.reloadedPayload, { title: 'walk dog', updatedAt: 112 });
    assert.strictEqual(result.rawRecordCount, 2, 'both records readable via the bare IDB API');
    assert.strictEqual(result.rawRecord.tableName, 'todos');
    assert.strictEqual(result.rawRecord.syncStatus, 0);

    /* --- wasm-in-Chromium results are identical to native-in-Node --- */
    const divergences = [];
    for (const [name, local, incoming, options] of RECONCILE_SCENARIOS) {
      const expected = JSON.stringify(nativeClient.reconcileIncoming(local, incoming, options));
      const fromBrowser = result.reconciled.find(([n]) => n === name)?.[1];
      if (fromBrowser !== expected) {
        divergences.push(`  ${name}\n    node/native: ${expected}\n    chromium:    ${fromBrowser}`);
      }
    }
    assert.strictEqual(
      divergences.length,
      0,
      `browser wasm diverged from the native engine:\n${divergences.join('\n')}`,
    );

    /* --- the optimistic guarantee itself --- */
    assert.strictEqual(
      result.roundTrip.title,
      'edited offline',
      'a stale server echo must not clobber the local optimistic write',
    );
    assert.strictEqual(result.roundTrip.updatedAt, 5000);
    assert.deepStrictEqual(
      result.roundTrip.rows,
      [{ id: 'a', v: 1 }],
      'the local-only array element must survive an empty server array',
    );
  },
);

test(
  'the same bundle works inside a real web worker (no DOM available)',
  { skip: browser ? false : 'headless Chromium could not be launched' },
  async (t) => {
    // Merging large documents on the main thread is what causes jank, so the
    // worker path is the one a real app will use. It exercises a genuinely
    // different emscripten environment branch (WorkerGlobalScope, no window).
    const server = await serveBundle(HTML);
    const page = await (await browser.newContext()).newPage();
    t.after(async () => {
      await page.context().close();
      await server.close();
    });
    await page.goto(`${server.origin}/`, { waitUntil: 'load' });

    const workerResult = await page.evaluate(async (origin) => {
      const src = `
        importScripts('${origin}/opto-sync.browser.js');
        self.onmessage = async () => {
          try {
            await OptoSync.initOptoSync();
            const merged = OptoSync.reconcileIncoming(
              { id: 'r1', title: 'local', updatedAt: 2000 },
              { id: 'r1', title: 'stale', updatedAt: 1000 },
            );
            self.postMessage({
              ok: true,
              hasWindow: typeof window !== 'undefined',
              version: OptoSync.engineVersion(),
              kind: OptoSync.mergeEngineKind(),
              title: merged.title,
            });
          } catch (err) {
            self.postMessage({ ok: false, error: String(err) });
          }
        };`;
      const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const done = new Promise((resolve) => {
        worker.onmessage = (e) => resolve(e.data);
        worker.onerror = (e) => resolve({ ok: false, error: e.message });
      });
      worker.postMessage('go');
      const out = await done;
      worker.terminate();
      return out;
    }, server.origin);

    assert.strictEqual(workerResult.ok, true, `worker failed: ${workerResult.error}`);
    assert.strictEqual(workerResult.hasWindow, false, 'this must be a worker, not the page');
    assert.strictEqual(workerResult.kind, 'wasm');
    assert.strictEqual(workerResult.version, '0.2.0');
    assert.strictEqual(workerResult.title, 'local', 'stale write lost inside the worker too');
  },
);

test('report whether a real browser was exercised', () => {
  // Recorded as an explicit assertion so a skipped browser run is visible in
  // the output instead of being mistaken for coverage.
  if (browser) {
    console.log(`      real browser exercised: Chromium ${browser.version()}`);
  } else {
    console.log('      real browser NOT exercised (Chromium unavailable)');
  }
  assert.ok(true);
});

test.after?.(async () => {
  if (browser) await browser.close();
});

process.on('beforeExit', () => {
  if (browser) browser.close().catch(() => {});
});
