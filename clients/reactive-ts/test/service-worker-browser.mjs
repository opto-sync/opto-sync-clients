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
    return navigator.serviceWorker.ready;
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
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([
    first.goto(origin, { waitUntil: 'load' }),
    second.goto(origin, { waitUntil: 'load' }),
  ]);
  await first.evaluate(() => window.registerWorker());
  await Promise.all([
    first.reload({ waitUntil: 'load' }),
    second.reload({ waitUntil: 'load' }),
  ]);
  await Promise.all([
    first.evaluate(() => navigator.serviceWorker.ready),
    second.evaluate(() => navigator.serviceWorker.ready),
  ]);

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

  await first.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.unregister();
    indexedDB.deleteDatabase('opto-sync-service-worker-e2e');
  });
  await context.close();
  console.log('service worker: two tabs, one bounded IndexedDB cycle, then one later cycle');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(output, { recursive: true, force: true });
}
