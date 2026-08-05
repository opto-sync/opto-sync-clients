import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const reactiveRoot = resolve(here, '..');
const tsClientRoot = resolve(reactiveRoot, '../ts');
const { build } = await import(
  pathToFileURL(resolve(tsClientRoot, 'node_modules/esbuild/lib/main.js')).href
);
const { chromium } = await import(
  pathToFileURL(resolve(tsClientRoot, 'node_modules/playwright/index.mjs')).href
);

const output = await mkdtemp(join(tmpdir(), 'opto-sync-service-worker-'));
const workerFile = join(output, 'sw.js');
await build({
  entryPoints: [resolve(here, 'fixtures/service-worker-entry.ts')],
  outfile: workerFile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'none',
});
const worker = await readFile(workerFile);
const pageHtml = Buffer.from(`<!doctype html>
<meta charset="utf-8">
<title>opto-sync service worker e2e</title>
<script>
  window.registerWorker = async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return true;
  };
  window.workerReady = async () => {
    await navigator.serviceWorker.ready;
    return true;
  };
  window.wakeWorker = async (requestId) => {
    const registration = await navigator.serviceWorker.ready;
    const target = registration.active || registration.waiting || registration.installing;
    if (!target) throw new Error('no active worker');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('worker response timeout')), 5000);
      const listener = (event) => {
        if (event.data?.type !== 'opto-sync:sync-result' || event.data.requestId !== requestId) return;
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('message', listener);
        resolve(event.data);
      };
      navigator.serviceWorker.addEventListener('message', listener);
      target.postMessage({ type: 'opto-sync:sync', requestId });
    });
  };
  window.readCycles = async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('opto-sync-service-worker-e2e', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('meta', 'readonly');
        const request = transaction.objectStore('meta').get('cycles');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(Number(request.result?.value ?? 0));
      });
    } finally {
      database.close();
    }
  };
  window.waitForCycleNotice = (expected) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('cycle notice timeout')), 5000);
    const listener = (event) => {
      if (event.data?.type !== 'opto-sync:e2e-cycle' || event.data.cycles !== expected) return;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('message', listener);
      resolve(event.data);
    };
    navigator.serviceWorker.addEventListener('message', listener);
  });
  window.deleteTestDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('opto-sync-service-worker-e2e');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('test database deletion blocked'));
    request.onsuccess = () => resolve(true);
  });
</script>`);

const server = createServer((request, response) => {
  if (request.url === '/sw.js') {
    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'service-worker-allowed': '/',
      'cache-control': 'no-store',
    });
    response.end(worker);
    return;
  }
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(pageHtml);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;

let browser;
try {
  const executablePath = process.env.OPTO_SYNC_CHROMIUM_PATH?.trim();
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([
    first.goto(origin, { waitUntil: 'load' }),
    second.goto(origin, { waitUntil: 'load' }),
  ]);
  assert.equal(await first.evaluate(() => window.registerWorker()), true);
  await Promise.all([
    first.reload({ waitUntil: 'load' }),
    second.reload({ waitUntil: 'load' }),
  ]);
  assert.deepEqual(
    await Promise.all([
      first.evaluate(() => window.workerReady()),
      second.evaluate(() => window.workerReady()),
    ]),
    [true, true],
  );

  const [firstResult, secondResult] = await Promise.all([
    first.evaluate(() => window.wakeWorker('tab-a')),
    second.evaluate(() => window.wakeWorker('tab-b')),
  ]);
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.equal(await first.evaluate(() => window.readCycles()), 1);

  const later = await first.evaluate(() => window.wakeWorker('later'));
  assert.equal(later.ok, true);
  assert.equal(await second.evaluate(() => window.readCycles()), 2);

  // Dispatch a real Background Sync event through Chromium's DevTools
  // protocol. This covers the browser-owned event lifetime and proves an
  // already-persisted legacy tag still drains after the canonical tag changed.
  const cdp = await context.newCDPSession(first);
  const registrationIdPromise = new Promise((resolveRegistration, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('service-worker registration id timeout')),
      5_000,
    );
    const onRegistrations = ({ registrations }) => {
      const registration = registrations.find(
        (candidate) =>
          candidate.scopeURL === `${origin}/` && !candidate.isDeleted,
      );
      if (!registration) return;
      clearTimeout(timeout);
      cdp.off('ServiceWorker.workerRegistrationUpdated', onRegistrations);
      resolveRegistration(registration.registrationId);
    };
    cdp.on('ServiceWorker.workerRegistrationUpdated', onRegistrations);
  });
  await cdp.send('ServiceWorker.enable');
  const registrationId = await registrationIdPromise;
  const legacyCycleNotice = first.evaluate(() => window.waitForCycleNotice(3));
  await cdp.send('ServiceWorker.dispatchSyncEvent', {
    origin,
    registrationId,
    tag: 'opto-sync:background',
    lastChance: false,
  });
  await legacyCycleNotice;
  await first.waitForFunction(
    async (expected) => (await window.readCycles()) === expected,
    3,
  );

  // A ServiceWorker object can stay registered while Chrome tears down its
  // execution context. Force that lifecycle boundary through CDP, then prove
  // the next message boots a fresh worker and resumes from durable IndexedDB
  // state rather than an in-memory counter.
  const workerStoppedPromise = new Promise((resolveStopped, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('service worker did not reach stopped state')),
      5_000,
    );
    const onVersions = ({ versions }) => {
      const stopped = versions.some(
        (version) =>
          version.registrationId === registrationId &&
          version.runningStatus === 'stopped',
      );
      if (!stopped) return;
      clearTimeout(timeout);
      cdp.off('ServiceWorker.workerVersionUpdated', onVersions);
      resolveStopped();
    };
    cdp.on('ServiceWorker.workerVersionUpdated', onVersions);
  });
  await cdp.send('ServiceWorker.stopAllWorkers');
  await workerStoppedPromise;
  const afterRestart = await first.evaluate(() =>
    window.wakeWorker('after-worker-restart'),
  );
  assert.equal(afterRestart.ok, true);
  assert.notEqual(
    afterRestart.value.workerInstance,
    later.value.workerInstance,
    'Chrome must have evaluated a fresh service-worker global after stop',
  );
  assert.equal(afterRestart.value.cycles, 4);
  assert.equal(await second.evaluate(() => window.readCycles()), 4);
  await cdp.detach();

  const environment = await first.evaluate(() => ({
    indexedDbTag: Object.prototype.toString.call(indexedDB),
    controlled: Boolean(navigator.serviceWorker.controller),
    hasWindow: typeof window === 'object',
  }));
  assert.deepEqual(environment, {
    indexedDbTag: '[object IDBFactory]',
    controlled: true,
    hasWindow: true,
  });

  await second.close();
  await first.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.unregister();
    await window.deleteTestDatabase();
  });
  await context.close();
  console.log(
    'service worker: two tabs coalesced, legacy sync dispatched, forced restart resumed IndexedDB',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(output, { recursive: true, force: true });
}
