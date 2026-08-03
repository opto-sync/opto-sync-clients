import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));

test(
  'the public service-worker SDK survives real Chrome sync and restart lifecycles',
  { timeout: 120_000 },
  async (t) => {
    const executablePath = process.env.OPTO_SYNC_CHROMIUM_PATH?.trim();
    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
      });
    } catch (error) {
      if (process.env.OPTO_SYNC_REQUIRE_BROWSER === '1') throw error;
      t.skip('headless Chromium could not be launched');
      return;
    }
    t.after(() => browser.close());

    const output = await mkdtemp(join(tmpdir(), 'opto-sync-core-worker-'));
    t.after(() => rm(output, { recursive: true, force: true }));
    const workerFile = join(output, 'sw.js');
    await build({
      entryPoints: [
        resolve(here, '../test-fixtures/core-service-worker-entry.ts'),
      ],
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
<title>opto-sync core service worker e2e</title>
<script>
  window.registerWorker = async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return true;
  };
  window.workerReady = async () => Boolean(await navigator.serviceWorker.ready);
  window.wakeWorker = async () => {
    const registration = await navigator.serviceWorker.ready;
    const target = registration.active || registration.waiting || registration.installing;
    if (!target) throw new Error('no active worker');
    const channel = new MessageChannel();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('worker response timeout')), 5000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(event.data);
      };
      target.postMessage({ type: 'opto-sync:sync' }, [channel.port2]);
    });
  };
  window.readCycles = async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('opto-sync-core-service-worker-e2e', 1);
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
      if (event.data?.type !== 'opto-sync:core-e2e-cycle' || event.data.cycles !== expected) return;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('message', listener);
      resolve(event.data);
    };
    navigator.serviceWorker.addEventListener('message', listener);
  });
  window.armDrainStartedNotice = () => {
    window.drainStartedNotice = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('drain-start notice timeout')), 5000);
      const listener = (event) => {
        if (event.data?.type !== 'opto-sync:core-e2e-drain-started') return;
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('message', listener);
        resolve(event.data);
      };
      navigator.serviceWorker.addEventListener('message', listener);
    });
    return true;
  };
  window.waitForDrainStartedNotice = () => {
    if (!window.drainStartedNotice) throw new Error('drain-start notice was not armed');
    return window.drainStartedNotice;
  };
  window.deleteTestDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('opto-sync-core-service-worker-e2e');
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
    await new Promise((resolveListen) =>
      server.listen(0, '127.0.0.1', resolveListen),
    );
    t.after(
      () => new Promise((resolveClose) => server.close(resolveClose)),
    );
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;

    const context = await browser.newContext();
    t.after(() => context.close());
    const errors = [];
    const watch = (page) => {
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => errors.push(`page: ${String(error)}`));
    };
    const first = await context.newPage();
    const second = await context.newPage();
    const observer = await context.newPage();
    watch(first);
    watch(second);
    watch(observer);
    await Promise.all([
      first.goto(origin, { waitUntil: 'load' }),
      second.goto(origin, { waitUntil: 'load' }),
      observer.goto(origin, { waitUntil: 'load' }),
    ]);
    assert.equal(await first.evaluate(() => window.registerWorker()), true);
    await Promise.all([
      first.reload({ waitUntil: 'load' }),
      second.reload({ waitUntil: 'load' }),
      observer.reload({ waitUntil: 'load' }),
    ]);
    assert.deepEqual(
      await Promise.all([
        first.evaluate(() => window.workerReady()),
        second.evaluate(() => window.workerReady()),
        observer.evaluate(() => window.workerReady()),
      ]),
      [true, true, true],
    );

    const [fromFirst, fromSecond] = await Promise.all([
      first.evaluate(() => window.wakeWorker()),
      second.evaluate(() => window.wakeWorker()),
    ]);
    assert.equal(fromFirst.ok, true);
    assert.equal(fromSecond.ok, true);
    assert.equal(fromFirst.result.pushedMutations, 1);
    assert.equal(fromSecond.result.pushedMutations, 1);
    assert.equal(await first.evaluate(() => window.readCycles()), 1);

    const later = await first.evaluate(() => window.wakeWorker());
    assert.equal(later.ok, true);
    assert.equal(later.result.pushedMutations, 2);

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
    // Race a browser-owned, already-persisted legacy Background Sync event
    // against an explicit MessageChannel wake. The real service-worker event
    // loop must share the adapter-owned single-flight promise across both
    // entry paths, not merely across two messages in the unit fake.
    assert.equal(
      await observer.evaluate(() => window.armDrainStartedNotice()),
      true,
    );
    const legacyNotice = second.evaluate(() => window.waitForCycleNotice(3));
    const messageDuringSync = first.evaluate(() => window.wakeWorker());
    await observer.evaluate(() => window.waitForDrainStartedNotice());
    await cdp.send('ServiceWorker.dispatchSyncEvent', {
      origin,
      registrationId,
      tag: 'opto-sync:background',
      lastChance: false,
    });
    const mixedResult = await messageDuringSync;
    await legacyNotice;
    assert.equal(mixedResult.ok, true);
    assert.equal(mixedResult.result.pushedMutations, 3);
    assert.equal(await second.evaluate(() => window.readCycles()), 3);

    const stoppedPromise = new Promise((resolveStopped, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('service worker did not reach stopped state')),
        5_000,
      );
      const onVersions = ({ versions }) => {
        if (
          !versions.some(
            (version) =>
              version.registrationId === registrationId &&
              version.runningStatus === 'stopped',
          )
        ) {
          return;
        }
        clearTimeout(timeout);
        cdp.off('ServiceWorker.workerVersionUpdated', onVersions);
        resolveStopped();
      };
      cdp.on('ServiceWorker.workerVersionUpdated', onVersions);
    });
    await cdp.send('ServiceWorker.stopAllWorkers');
    await stoppedPromise;

    const afterRestart = await first.evaluate(() => window.wakeWorker());
    assert.equal(afterRestart.ok, true);
    assert.equal(afterRestart.result.pushedMutations, 4);
    assert.notEqual(
      afterRestart.result.workerInstance,
      later.result.workerInstance,
      'Chrome must evaluate a fresh SDK worker after termination',
    );
    assert.equal(await second.evaluate(() => window.readCycles()), 4);
    assert.deepEqual(errors, []);
    await cdp.detach();

    await Promise.all([observer.close(), second.close()]);
    await first.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.unregister();
      await window.deleteTestDatabase();
    });
  },
);
