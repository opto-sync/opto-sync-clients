/**
 * Bundle-shape tests: can this package actually reach a browser?
 *
 * Before this work the answer was no — src/reconcile.ts hard-imported an N-API
 * addon, so any bundler pointed at the client either failed on a .node binary
 * or produced a bundle that threw on load. These assertions are the regression
 * guard for that: the browser entry must bundle with a stock browser-platform
 * esbuild config, with no `external`, no polyfill plugin, and no loader rules,
 * and the output must not reference a single Node builtin.
 */
import test from 'node:test';
import assert from 'node:assert';

import { bundleBrowserClient } from './helpers/bundle.mjs';

const bundle = await bundleBrowserClient();

test('the browser entry bundles for platform=browser with no configuration', () => {
  assert.ok(bundle.bytes > 0);
  // Sanity: the wasm engine really is in there (inlined base64 wasm module).
  assert.ok(
    bundle.code.includes('data:application/octet-stream;base64,') ||
      bundle.code.includes('application/wasm'),
    'the bundle should contain the inlined wasm binary',
  );
});

test('the bundle references no Node builtins', () => {
  // esbuild would have failed outright on `import 'node:fs'`, but a stray
  // require()/process/Buffer reference bundles fine and only explodes in the
  // browser at runtime — exactly the failure mode this package had.
  const forbidden = [
    [/\brequire\s*\(\s*["'](?!\.)/, 'a bare require() of a package'],
    [/["']node:[a-z_]+["']/, 'a node: builtin specifier'],
    [/\bcreateRequire\b/, 'createRequire'],
    [/\b__dirname\b/, '__dirname'],
    [/\b__filename\b/, '__filename'],
    [/\bnew\s+Buffer\b|\bBuffer\.(from|alloc)\b/, 'Buffer'],
    [/\bprocess\.(binding|dlopen|version)\b/, 'a Node-only process API'],
    [/\.node["']/, 'a .node native addon path'],
  ];
  for (const [re, what] of forbidden) {
    const match = bundle.code.match(re);
    assert.strictEqual(
      match,
      null,
      `bundle must not reference ${what} (found: ${match && match[0]})`,
    );
  }
});

test('the native addon is not pulled into the browser bundle', () => {
  const inputs = Object.keys(bundle.metafile.inputs);
  const native = inputs.filter((p) => p.includes('bindings/typescript'));
  assert.deepStrictEqual(
    native,
    [],
    `the N-API binding must not be reachable from the browser entry: ${native.join(', ')}`,
  );
  // ...and the wasm binding must be.
  assert.ok(
    inputs.some((p) => p.includes('bindings/wasm')),
    `expected the wasm binding in the bundle; inputs were:\n${inputs.join('\n')}`,
  );
});

test('the bundle stays within a sane size budget', () => {
  // Dexie + the client + the whole CRDT engine, wasm inlined. The budget is
  // here so an accidental dependency (or a switch to a debug wasm build) is
  // noticed rather than shipped.
  const kb = bundle.bytes / 1024;
  assert.ok(kb < 500, `browser bundle is ${kb.toFixed(0)} KB, over the 500 KB budget`);
  console.log(`      browser bundle: ${kb.toFixed(1)} KB (unminified, wasm inlined)`);
});
