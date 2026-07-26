import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const workspaceRoot = resolve(packageRoot, '../../..');
const buildDir = mkdtempSync(join(tmpdir(), 'opto-dart-web-e2e-'));

const packageConfig = JSON.parse(
  readFileSync(resolve(packageRoot, '.dart_tool/package_config.json'), 'utf8'),
);
const configUrl = pathToFileURL(
  resolve(packageRoot, '.dart_tool/package_config.json'),
);
const drift = packageConfig.packages.find((entry) => entry.name === 'drift');
assert.ok(drift, 'drift is missing from Dart package_config.json');
const driftRoot = fileURLToPath(new URL(drift.rootUri, configUrl));

cpSync(
  resolve(driftRoot, 'extension/devtools/build/sqlite3.wasm'),
  resolve(buildDir, 'sqlite3.wasm'),
);
cpSync(resolve(driftRoot, 'drift_worker.js'), resolve(buildDir, 'drift_worker.js'));
const syncerWasmRoot = resolve(workspaceRoot, 'syncer.c/bindings/wasm');
mkdirSync(resolve(buildDir, 'syncer'), { recursive: true });
cpSync(resolve(syncerWasmRoot, 'index.mjs'), resolve(buildDir, 'syncer/index.mjs'));
cpSync(resolve(syncerWasmRoot, 'lib'), resolve(buildDir, 'syncer/lib'), {
  recursive: true,
});
cpSync(
  resolve(syncerWasmRoot, 'dist/syncer-core.single.mjs'),
  resolve(buildDir, 'syncer/dist/syncer-core.single.mjs'),
);
writeFileSync(
  resolve(buildDir, 'index.html'),
  '<!doctype html><meta charset="utf-8"><body>starting</body>' +
    '<script defer src="/app.js"></script>',
);

execFileSync(
  'dart',
  [
    'compile',
    'js',
    'test/web/browser_e2e.dart',
    '-O1',
    '-o',
    resolve(buildDir, 'app.js'),
  ],
  { cwd: packageRoot, stdio: 'inherit' },
);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
};
const server = createServer((request, response) => {
  const path = request.url === '/' ? '/index.html' : request.url;
  const file = resolve(buildDir, `.${path}`);
  if (!file.startsWith(`${buildDir}/`)) {
    response.writeHead(400).end();
    return;
  }
  try {
    const body = readFileSync(file);
    response.writeHead(200, {
      'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  const { chromium } = await import('../../ts/node_modules/playwright/index.mjs');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(
    () => {
      try {
        return JSON.parse(document.body.textContent ?? '').ok !== undefined;
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 120_000 },
  );
  const result = await page.evaluate(() =>
    JSON.parse(document.body.textContent ?? '{}'),
  );
  assert.deepEqual(errors, [], `browser console errors:\n${errors.join('\n')}`);
  assert.equal(result.ok, true, `${result.error ?? 'browser test failed'}\n${result.stack ?? ''}`);
  assert.equal(result.engineVersion, '0.2.1');
  assert.equal(result.storageApi, 'indexedDb');
  assert.match(result.storage, /IndexedDb$/);
  assert.deepEqual(result.recoveredMutationIds, ['1']);
  assert.deepEqual(result.recoveredPayload, {
    title: 'saved in IndexedDB',
    updatedAt: 2000,
  });
  assert.deepEqual(result.committed, {
    title: 'saved in IndexedDB',
    updatedAt: 2000,
  });
  assert.deepEqual(result.pulled, { fromServer: true });
  assert.equal(result.checkpoint, '7');
  assert.equal(result.rollbackObserved, true);

  const browserEnvironment = await page.evaluate(async () => ({
    indexedDbTag: Object.prototype.toString.call(indexedDB),
    databaseNames: (await indexedDB.databases()).map((entry) => entry.name),
    hasNodeProcess: typeof process !== 'undefined',
    hasWasm: typeof WebAssembly === 'object',
  }));
  assert.equal(browserEnvironment.indexedDbTag, '[object IDBFactory]');
  assert.ok(browserEnvironment.databaseNames.length > 0);
  assert.equal(browserEnvironment.hasNodeProcess, false);
  assert.equal(browserEnvironment.hasWasm, true);
  console.log(
    `Dart web: real Chromium + syncer.c WASM + ${result.storage}; ` +
      `restart, atomic rollback, and checkpoint persistence passed`,
  );
  await context.close();
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(buildDir, { recursive: true, force: true });
}
