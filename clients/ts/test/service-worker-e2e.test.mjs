import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { bundleBrowserClient } from './helpers/bundle.mjs';

const DB_NAME = 'opto-service-worker-e2e';
const HTML = `<!doctype html>
<meta charset="utf-8">
<title>opto-sync service worker harness</title>
<script src="/opto-sync.browser.js"></script>`;

const WORKER = `
importScripts('/opto-sync.browser.js');

OptoSync.installOptoSyncServiceWorker({
  skipWaiting: true,
  claimClients: true,
  syncOnPush: true,
  runSync: async reason => {
    await OptoSync.initOptoSync();
    const client = new OptoSync.OptoSyncClient({
      databaseName: '${DB_NAME}',
      stampUpdatedAt: false,
    });
    try {
      const pending = await client.pendingMutations();
      const response = await fetch('/worker-capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason,
          records: pending.map(row => ({
            id: row.id,
            recordId: row.recordId,
            payload: JSON.parse(row.jsonPayload),
          })),
        }),
      });
      if (!response.ok) throw new Error('capture failed');
      for (const row of pending) {
        await client.markMutation(row.id, OptoSync.SYNC_STATUS.SYNCED);
      }
    } finally {
      client.db.close();
    }
  },
});
`;

async function launchChromium() {
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch({ headless: true });
  } catch (error) {
    console.log(`      chromium unavailable: ${error.message.split('\n')[0]}`);
    return null;
  }
}

const browser = await launchChromium();

after(async () => {
  if (browser) await browser.close();
});

test(
  'real service worker reopens the page IndexedDB queue and flushes it',
  {
    skip: browser ? false : 'headless Chromium could not be launched',
    timeout: 120_000,
  },
  async (t) => {
    const { code } = await bundleBrowserClient();
    const captures = [];
    const captureWaiters = [];
    const server = createServer((request, response) => {
      if (request.url === '/' || request.url === '/index.html') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(HTML);
        return;
      }
      if (request.url === '/opto-sync.browser.js') {
        response.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
        });
        response.end(code);
        return;
      }
      if (request.url === '/opto-sync-sw.js') {
        response.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'service-worker-allowed': '/',
        });
        response.end(WORKER);
        return;
      }
      if (request.url === '/worker-capture' && request.method === 'POST') {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          captures.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          captureWaiters.splice(0).forEach((resolve) => resolve());
          response.writeHead(204).end();
        });
        return;
      }
      response.writeHead(404).end('not found');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    t.after(async () => {
      await page.evaluate(async (databaseName) => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
        await new Promise((resolve) => {
          const deletion = indexedDB.deleteDatabase(databaseName);
          deletion.onsuccess = deletion.onerror = deletion.onblocked = () => resolve();
        });
      }, DB_NAME);
      await context.close();
      await new Promise((resolve) => server.close(resolve));
    });

    await page.goto(origin, { waitUntil: 'load' });
    const queued = await page.evaluate(async ({ databaseName }) => {
      await OptoSync.initOptoSync();
      const worker = await OptoSync.registerOptoSyncServiceWorker({
        scriptUrl: '/opto-sync-sw.js',
        type: 'classic',
        scope: '/',
      });
      const client = new OptoSync.OptoSyncClient({
        databaseName,
        stampUpdatedAt: false,
      });
      const id = await client.queueMutation('docs', 'from-page', {
        id: 'from-page',
        title: 'durable before the worker wakes',
        updatedAt: 1,
      });
      client.db.close();

      const channel = new MessageChannel();
      const reply = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('service worker message timed out')),
          30_000,
        );
        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          resolve(event.data);
        };
      });
      worker.registration.active.postMessage(
        { type: OptoSync.OPTO_SYNC_MESSAGE },
        [channel.port2],
      );
      return { id, reply: await reply };
    }, { databaseName: DB_NAME });

    if (captures.length === 0) {
      await new Promise((resolve) => captureWaiters.push(resolve));
    }
    assert.deepEqual(queued.reply, { ok: true });
    assert.equal(captures.length, 1);
    assert.deepEqual(captures[0], {
      reason: 'message',
      records: [
        {
          id: queued.id,
          recordId: 'from-page',
          payload: {
            id: 'from-page',
            title: 'durable before the worker wakes',
            updatedAt: 1,
          },
        },
      ],
    });

    const state = await page.evaluate(async (databaseName) => {
      const client = new OptoSync.OptoSyncClient({
        databaseName,
        stampUpdatedAt: false,
      });
      const pending = await client.pendingMutations();
      const all = await client.db.localMutations.toArray();
      client.db.close();
      return {
        pending: pending.length,
        statuses: all.map((row) => row.syncStatus),
      };
    }, DB_NAME);
    assert.deepEqual(state, { pending: 0, statuses: [1] });
    assert.deepEqual(errors, []);
  },
);

test(
  'real tabs share IndexedDB, elect one network leader, and forward hints',
  {
    skip: browser ? false : 'headless Chromium could not be launched',
    timeout: 120_000,
  },
  async (t) => {
    const { code } = await bundleBrowserClient();
    const server = createServer((request, response) => {
      if (request.url === '/' || request.url === '/index.html') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(HTML);
        return;
      }
      if (request.url === '/opto-sync.browser.js') {
        response.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
        });
        response.end(code);
        return;
      }
      response.writeHead(404).end('not found');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();
    const databaseName = 'opto-multi-tab-e2e';
    const namespace = 'opto-multi-tab-e2e-session';
    t.after(async () => {
      for (const page of [first, second]) {
        if (!page.isClosed()) {
          await page.evaluate(async () => {
            await window.coordinator?.stop();
            window.client?.db.close();
          });
        }
      }
      await first.evaluate(async (name) => {
        await new Promise((resolve) => {
          const deletion = indexedDB.deleteDatabase(name);
          deletion.onsuccess = deletion.onerror = deletion.onblocked = () => resolve();
        });
      }, databaseName);
      await context.close();
      await new Promise((resolve) => server.close(resolve));
    });
    await Promise.all([
      first.goto(origin, { waitUntil: 'load' }),
      second.goto(origin, { waitUntil: 'load' }),
    ]);

    const setup = async (page) =>
      page.evaluate(async ({ databaseName, namespace }) => {
        await OptoSync.initOptoSync();
        window.client = new OptoSync.OptoSyncClient({
          databaseName,
          stampUpdatedAt: false,
        });
        window.loop = {
          starts: 0,
          stops: 0,
          hints: 0,
          start() {
            this.starts++;
          },
          stop() {
            this.stops++;
          },
          hint() {
            this.hints++;
          },
        };
        window.coordinator = new OptoSync.CrossContextSyncCoordinator({
          namespace,
          loop: window.loop,
        });
        window.client.setBackgroundSyncTrigger(() => window.coordinator.hint());
        window.coordinator.start();
      }, { databaseName, namespace });
    await Promise.all([setup(first), setup(second)]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const states = await Promise.all([
      first.evaluate(() => window.coordinator.state),
      second.evaluate(() => window.coordinator.state),
    ]);
    assert.equal(states.filter((state) => state.leader).length, 1);
    const leader = states[0].leader ? first : second;
    const follower = states[0].leader ? second : first;
    const leaderHintsBefore = await leader.evaluate(() => window.loop.hints);

    await follower.evaluate(async () => {
      await window.client.queueMutation('docs', 'shared-row', {
        id: 'shared-row',
        title: 'written in the follower',
        updatedAt: 1,
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      await leader.evaluate(() => window.loop.hints),
      leaderHintsBefore + 1,
      'follower queue commit must wake the elected leader',
    );
    assert.deepEqual(
      await leader.evaluate(async () =>
        (await window.client.pendingMutations()).map((row) => row.recordId),
      ),
      ['shared-row'],
      'both tabs must read the same real IndexedDB queue',
    );

    await leader.evaluate(() => window.coordinator.stop());
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      await follower.evaluate(() => window.coordinator.state.leader),
      true,
      'leadership must move when the original tab stops',
    );
  },
);
