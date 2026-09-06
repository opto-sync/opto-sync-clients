import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(new URL('../../ts/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
async function bundle(contents) {
  const result = await build({ stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser' });
  return result.outputFiles[0].text;
}
const workerCode = await bundle(`
  import {installComputeWorker} from './src/compute-worker.ts';
  installComputeWorker(self, input => {
    if (input.fail) throw new Error('private payload');
    const data = JSON.parse(input.json);
    return {count: data.length, realm: self.constructor.name};
  });
`);
const appCode = await bundle(`
  import {ComputeWorkerPool} from './src/compute-worker.ts';
  import {StateStore} from './src/state-store.ts';
  window.exercise = async () => {
    const pool = new ComputeWorkerPool(() => new Worker('/worker.js', {type:'module'}), {size:2});
    const store = new StateStore(0, (_, action) => action);
    try {
      const outputs = await Promise.all([pool.run({json:'[1,2,3]'}), pool.run({json:'[4]'})]);
      const stale = store.projectLocalView('users', () => pool.run({json:'[5,6]'}), result => result.count);
      store.reset(0);
      const accepted = await stale;
      let failure;
      try { await pool.run({fail:true}); } catch (error) { failure = error.message; }
      return {outputs, accepted, count:store.state, failure};
    } finally { pool.dispose(); store.dispose(); }
  };
`);
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(req.url === '/worker.js' ? workerCode : req.url === '/app.js' ? appCode :
    '<!doctype html><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.OPTO_SYNC_CHROMIUM_PATH ? {executablePath: process.env.OPTO_SYNC_CHROMIUM_PATH} : {}) });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof window.exercise === 'function');
  const result = await page.evaluate(() => window.exercise());
  assert.deepEqual(result, { outputs: [{count:3, realm:'DedicatedWorkerGlobalScope'},
    {count:1, realm:'DedicatedWorkerGlobalScope'}], accepted:false, count:0, failure:'TASK_FAILED' });
  console.log('Chromium: real module workers, message routing, session fence and errors passed');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
