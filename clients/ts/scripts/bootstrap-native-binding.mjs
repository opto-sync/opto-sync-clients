/**
 * preinstall hook: make `npm install` work from a clean checkout.
 *
 * THE PROBLEM
 * -----------
 * `@opto-sync/syncer` is a `file:` dependency, so npm installs it as a SYMLINK
 * and does not install the linked package's own dependencies — clients/ts's
 * lockfile has no `node-addon-api` entry at all. But the binding has an
 * `install` script (`node-gyp rebuild`), and npm runs that script with the cwd
 * set to the symlink's target. node-gyp then evaluates
 * `node -p "require('node-addon-api').include"` from
 * syncer.c/bindings/typescript, where Node's resolution walks
 * syncer.c/bindings/typescript/node_modules -> syncer.c/bindings/node_modules ->
 * syncer.c/node_modules -> <repo>/node_modules. clients/ts/node_modules is not
 * on that path, so adding node-addon-api to THIS package's dependencies does
 * not help: the whole install dies with MODULE_NOT_FOUND.
 *
 * It only appeared to work for anyone who had previously run `npm install` by
 * hand inside the binding directory.
 *
 * THE FIX
 * -------
 * Populate the linked package's own node_modules before npm gets to its
 * install script. `preinstall` runs before the dependency tree is reified, so
 * by the time node-gyp starts, `require('node-addon-api')` resolves.
 *
 * `--ignore-scripts` is important: this bootstrap only needs the binding's
 * dependencies on disk, and running its node-gyp build here as well would
 * double the work (npm runs it moments later anyway).
 *
 * Never fatal. A consumer installing a published tarball has no sibling
 * syncer.c checkout, and a browser-only consumer does not need the native
 * addon at all — in both cases this exits 0 and lets npm proceed.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bindingDir = join(packageRoot, '..', '..', '..', 'syncer.c', 'bindings', 'typescript');

function log(msg) {
  console.log(`bootstrap-native-binding: ${msg}`);
}

if (!existsSync(join(bindingDir, 'package.json'))) {
  log(`no local native binding at ${bindingDir} — nothing to bootstrap`);
  process.exit(0);
}

/* Already resolvable from the binding's own directory? Then npm's upcoming
   node-gyp run will find it and there is nothing to do. */
try {
  createRequire(join(bindingDir, 'noop.js')).resolve('node-addon-api');
  log('node-addon-api already resolvable from the native binding — skipping');
  process.exit(0);
} catch {
  /* fall through and install */
}

log(`installing the native binding's dependencies in ${bindingDir}`);
const npmCli = process.env.npm_execpath;
const result = npmCli
  ? spawnSync(process.execPath, [npmCli, 'install', '--omit=dev', '--ignore-scripts'], {
      cwd: bindingDir,
      stdio: 'inherit',
    })
  : spawnSync('npm', ['install', '--omit=dev', '--ignore-scripts'], {
      cwd: bindingDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

if (result.status !== 0) {
  // Warn rather than fail: the browser (wasm) path does not need the native
  // addon, so a broken native bootstrap should not block installing the
  // package outright. npm's own error, if any, will be the clear one.
  log(
    `WARNING: could not install the native binding's dependencies ` +
      `(exit ${result.status}). The Node/native engine may fail to build; ` +
      `the browser/wasm engine is unaffected.`,
  );
}
