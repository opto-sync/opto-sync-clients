/**
 * postinstall hook: make `npm install` work from a clean checkout.
 *
 * THE PROBLEM
 * -----------
 * `@opto-sync/syncer` (the N-API binding) is a `file:` dependency, so npm
 * installs it as a SYMLINK — and npm does not install a linked package's own
 * dependencies. clients/ts's lockfile has no `node-addon-api` entry at all.
 * But the binding declares an `install` script (`node-gyp rebuild`), which npm
 * runs with the cwd set to the link's target. node-gyp evaluates
 * `node -p "require('node-addon-api').include"` from
 * syncer.c/bindings/typescript, and Node's resolution from there walks
 * syncer.c/bindings/typescript/node_modules -> syncer.c/bindings/node_modules ->
 * syncer.c/node_modules -> <repo>/node_modules. clients/ts/node_modules is not
 * on that chain, so a clean `npm install` dies with MODULE_NOT_FOUND. It only
 * ever appeared to work for people who had already run `npm install` by hand
 * inside the binding directory.
 *
 * WHY THE OBVIOUS FIXES DO NOT WORK (all verified, not assumed)
 * ------------------------------------------------------------
 *  - Adding `node-addon-api` to THIS package's dependencies: it lands in
 *    clients/ts/node_modules, which is not on the binding's resolution chain.
 *  - A `preinstall` hook: npm runs the ROOT package's lifecycle scripts AFTER
 *    reifying the tree, so the dependency's install script has already failed
 *    by then. `preinstall` is not early, despite the name.
 *  - `install-links=true` (copy the dependency instead of symlinking): npm then
 *    installs node-addon-api correctly, but the binding's binding.gyp compiles
 *    ../../core/src/syncer.c — paths that only exist in the source tree. Copied
 *    into node_modules it fails with "syncer.h file not found". The native
 *    binding is only buildable in place.
 *
 * THE FIX
 * -------
 * Two halves, and both are needed:
 *
 *  1. package.json lists the binding under `optionalDependencies`, so npm
 *     tolerates the install-script failure instead of aborting the whole
 *     install. That is also the honest classification now: the browser/wasm
 *     engine needs no native build, so a machine without a working toolchain
 *     should still be able to install this package.
 *
 *  2. This script, run as `postinstall` (i.e. after reification, when npm is
 *     done and out of the way), bootstraps the binding the way npm cannot:
 *     installs its dependencies and builds it IN PLACE — where binding.gyp's
 *     relative paths to ../../core resolve — and restores the
 *     node_modules/@opto-sync/syncer symlink that npm pruned when the optional
 *     dependency failed.
 *
 * It is self-healing: once the binding is bootstrapped, later `npm install`
 * runs succeed through npm's own path and this script is a no-op.
 *
 * Never fatal. Someone installing a published tarball has no sibling syncer.c
 * checkout, and a browser-only consumer does not need the native addon — both
 * cases exit 0 with a note.
 */
import { existsSync, mkdirSync, lstatSync, rmSync, symlinkSync, readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bindingDir = resolve(packageRoot, '..', '..', '..', 'syncer.c', 'bindings', 'typescript');
const linkDir = join(packageRoot, 'node_modules', '@opto-sync');
const linkPath = join(linkDir, 'syncer');

const log = (msg) => console.log(`bootstrap-native-binding: ${msg}`);

if (!existsSync(join(bindingDir, 'package.json'))) {
  log(`no local native binding at ${bindingDir} — skipping (the wasm engine needs no build)`);
  process.exit(0);
}

/* ---------------------------------------------------------------- */
/*  1. the binding's own dependencies + native build, in place       */
/* ---------------------------------------------------------------- */

const bindingRequire = createRequire(join(bindingDir, 'noop.js'));
const hasAddonApi = (() => {
  try {
    bindingRequire.resolve('node-addon-api');
    return true;
  } catch {
    return false;
  }
})();
const builtAddon = join(bindingDir, 'build', 'Release', 'syncer.node');

/** Run npm inside the binding directory, reusing the npm that invoked us. */
function npmInBinding(args) {
  const cli = process.env.npm_execpath;
  return cli
    ? spawnSync(process.execPath, [cli, ...args], { cwd: bindingDir, stdio: 'inherit' })
    : spawnSync('npm', args, {
        cwd: bindingDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
}

if (!hasAddonApi || !existsSync(builtAddon)) {
  log(`bootstrapping the native binding in ${bindingDir}`);
  /* Scripts enabled on purpose: this is what compiles syncer.node, and it has
     to happen here because binding.gyp's ../../core paths only resolve inside
     the source tree. */
  const result = npmInBinding(['install']);
  if (result.status !== 0) {
    log(
      `WARNING: could not build the native binding (exit ${result.status}). ` +
        'The Node/native engine will be unavailable; the browser/wasm engine ' +
        'is unaffected. Install a C toolchain and re-run `npm install` to fix.',
    );
    process.exit(0);
  }
} else {
  log('native binding already built — skipping its build');
}

/* ---------------------------------------------------------------- */
/*  2. restore the symlink npm pruned                               */
/* ---------------------------------------------------------------- */

/* npm removes an optional dependency from node_modules when its install script
   fails, so on a first install the link is gone even though the binding is now
   perfectly usable. Recreate it exactly as npm would: a relative symlink (a
   junction on Windows, where unprivileged symlinks are not allowed). */
function linkIsCorrect() {
  try {
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) return existsSync(join(linkPath, 'package.json'));
    return resolve(linkDir, readlinkSync(linkPath)) === bindingDir;
  } catch {
    return false;
  }
}

if (linkIsCorrect()) {
  log('node_modules/@opto-sync/syncer already points at the local binding');
} else {
  mkdirSync(linkDir, { recursive: true });
  rmSync(linkPath, { recursive: true, force: true });
  if (process.platform === 'win32') {
    symlinkSync(bindingDir, linkPath, 'junction');
  } else {
    symlinkSync(relative(linkDir, bindingDir), linkPath, 'dir');
  }
  log('linked node_modules/@opto-sync/syncer -> the local native binding');
}

/* ---------------------------------------------------------------- */
/*  3. prove it                                                     */
/* ---------------------------------------------------------------- */

try {
  const syncer = createRequire(join(packageRoot, 'noop.js'))('@opto-sync/syncer');
  log(`native engine ready (syncer.c ${syncer.version()})`);
} catch (err) {
  log(
    `WARNING: the native engine is still not loadable (${err.message.split('\n')[0]}). ` +
      'The browser/wasm engine is unaffected.',
  );
}
