/**
 * Native (N-API) vs WebAssembly parity.
 *
 * The whole point of shipping two bindings to one C core is that a document
 * reconciles identically wherever it is reconciled. A divergence here is not a
 * test problem, it is a data-corruption bug: the browser and the server would
 * converge on different states for the same pair of payloads.
 *
 * So this asserts byte-identical merge output — not "deep equal after
 * JSON.parse", which would hide key-order differences, number formatting
 * differences (1e-7 vs 0.0000001), and int64 precision loss.
 */
import test from 'node:test';
import assert from 'node:assert';

import nativeSyncer from '@opto-sync/syncer';
import * as wasmSyncer from '@opto-sync/syncer-wasm';

import { MERGE_CORPUS, RECONCILE_SCENARIOS } from './helpers/corpus.mjs';

/* Node reconcile path (native engine, installed on import). */
import * as nativeClient from '../dist/reconcile.js';
/* Browser reconcile path (wasm engine). Same source, different engine. */
import * as browserClient from '../dist/esm/browser.js';

function assertCoreAtLeast(v, label = 'core') {
  // Lower bound, not an exact match: an exact pin fails on every patch bump
  // yet still would not catch a stale artifact reporting an OLDER version.
  const [maj, min, patch] = String(v).split('.').map(Number);
  assert.ok(
    maj > 0 || min > 2 || (min === 2 && patch >= 1),
    `${label} reports unexpected core version ${v}`,
  );
}


await wasmSyncer.initSyncer();
await browserClient.initOptoSync();

test('both engines report the same core version', () => {
  assert.strictEqual(wasmSyncer.version(), nativeSyncer.version());
  assertCoreAtLeast(wasmSyncer.version(), 'wasm engine');
});

test('both engines expose the same ArrayStrategy map as the client', () => {
  const expected = { REPLACE: 0, APPEND: 1, UNION: 2, MERGE_BY_INDEX: 3, MERGE_BY_KEY: 4 };
  assert.deepStrictEqual({ ...nativeSyncer.ArrayStrategy }, expected);
  assert.deepStrictEqual({ ...wasmSyncer.ArrayStrategy }, expected);
  // The client declares these numbers itself (they are a cross-tier wire
  // contract), so it has to be checked against both engines.
  assert.deepStrictEqual({ ...nativeClient.ArrayStrategy }, expected);
  assert.deepStrictEqual({ ...browserClient.ArrayStrategy }, expected);
});

test(`mergeJson is byte-identical across engines on all ${MERGE_CORPUS.length} corpus cases`, () => {
  const divergences = [];
  for (const [name, base, incoming, options] of MERGE_CORPUS) {
    const fromNative = nativeSyncer.mergeJson(base, incoming, options);
    const fromWasm = wasmSyncer.mergeJson(base, incoming, options);
    if (fromNative !== fromWasm) {
      divergences.push(`  ${name}\n    native: ${fromNative}\n    wasm:   ${fromWasm}`);
    }
  }
  assert.strictEqual(
    divergences.length,
    0,
    `native/wasm merge divergence:\n${divergences.join('\n')}`,
  );
});

test('mergeJson is byte-identical on repeated application (idempotence agrees)', () => {
  for (const [name, base, incoming, options] of MERGE_CORPUS) {
    const once = nativeSyncer.mergeJson(base, incoming, options);
    if (once === null) continue;
    const nativeTwice = nativeSyncer.mergeJson(once, incoming, options);
    const wasmTwice = wasmSyncer.mergeJson(once, incoming, options);
    assert.strictEqual(wasmTwice, nativeTwice, `second application diverged: ${name}`);
  }
});

test('the two engines agree on a randomized corpus (1000 documents)', () => {
  // Fixed-seed PRNG so a failure is reproducible.
  let seed = 0x1234abcd;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const scalar = () =>
    pick([1, 0, -1, 3.5, 'a', 'ключ', '日本', '', true, false, null, '42', 9007199254740993]);

  const makeValue = (depth) => {
    const kind = rnd();
    if (depth > 2 || kind < 0.4) return scalar();
    if (kind < 0.7) {
      const n = 1 + Math.floor(rnd() * 3);
      return Array.from({ length: n }, () =>
        rnd() < 0.5 ? scalar() : { id: pick(['a', 'b', 1, 2]), v: makeValue(depth + 1) },
      );
    }
    const obj = {};
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) obj[pick(['x', 'y', 'z', 'updatedAt', 'createdAt'])] = makeValue(depth + 1);
    return obj;
  };
  const makeDoc = () => {
    const doc = {};
    const n = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) doc[pick(['a', 'b', 'rows', 'meta', 'updatedAt'])] = makeValue(0);
    return JSON.stringify(doc);
  };

  for (let i = 0; i < 1000; i++) {
    const base = makeDoc();
    const incoming = makeDoc();
    const options = {
      arrayStrategy: Math.floor(rnd() * 5),
      resolveByTimestamp: rnd() < 0.5,
      maxDepth: rnd() < 0.2 ? 1 + Math.floor(rnd() * 3) : 0,
    };
    // Optional means absent. Present-with-undefined is not a JSON/wire value
    // and the hardened native binding intentionally rejects wrong types.
    if (rnd() < 0.5) options.lwwKeys = 'updatedAt,syncedAt';
    if (rnd() < 0.3) options.fwwKeys = 'createdAt';
    if (rnd() < 0.3) options.arrayMatchKeys = 'uuid,id';
    const fromNative = nativeSyncer.mergeJson(base, incoming, options);
    const fromWasm = wasmSyncer.mergeJson(base, incoming, options);
    assert.strictEqual(
      fromWasm,
      fromNative,
      `divergence at i=${i}\n  base:     ${base}\n  incoming: ${incoming}\n  options:  ${JSON.stringify(options)}`,
    );
  }
});

/* ------------------------------------------------------------------ */
/*  Client-level parity: same reconcile code, two engines              */
/* ------------------------------------------------------------------ */

test('the client default merge policy is identical on both tiers', () => {
  const expected = {
    arrayStrategy: 4, // ArrayStrategy.MERGE_BY_KEY
    arrayMatchKeys: 'id',
    resolveByTimestamp: true,
    lwwKeys: 'updatedAt,syncedAt',
    // No fwwKeys: FWW is a node-level veto, so it is opt-in on every tier.
  };
  assert.deepStrictEqual({ ...nativeClient.DEFAULT_RECONCILE_OPTIONS }, expected);
  assert.deepStrictEqual({ ...browserClient.DEFAULT_RECONCILE_OPTIONS }, expected);
});

test('the engines are actually different implementations (guard against a stub)', () => {
  // If browser.js somehow fell back to the native addon, every parity
  // assertion below would pass vacuously.
  assert.strictEqual(nativeClient.mergeEngineKind(), 'native');
  assert.strictEqual(browserClient.mergeEngineKind(), 'wasm');
});

test(`reconcileIncoming agrees on all ${RECONCILE_SCENARIOS.length} scenarios`, () => {
  for (const [name, local, incoming, options] of RECONCILE_SCENARIOS) {
    const fromNative = nativeClient.reconcileIncoming(local, incoming, options);
    const fromWasm = browserClient.reconcileIncoming(local, incoming, options);
    // Byte-identical serialization, so key ORDER is compared too — a
    // difference there would still be a divergence in what gets persisted.
    assert.strictEqual(JSON.stringify(fromWasm), JSON.stringify(fromNative), name);
  }
});

test('reconcile scenarios assert the right outcomes, not just agreement', () => {
  // Agreement is worthless if both engines are wrong, so spot-check the
  // semantics that the sync protocol actually depends on.
  for (const client of [nativeClient, browserClient]) {
    const tier = client.mergeEngineKind();

    const stale = client.reconcileIncoming(
      { id: 'r1', title: 'edited locally', updatedAt: 2000 },
      { id: 'r1', title: 'stale server copy', updatedAt: 1000 },
    );
    assert.strictEqual(stale.title, 'edited locally', `${tier}: stale write must lose`);

    const protectedRows = client.reconcileIncoming(
      {
        rows: [
          { id: 'r1', label: 'local-only' },
          { id: 'r2', updatedAt: 9000, label: 'fresh local edit' },
        ],
      },
      { rows: [{ id: 'r2', updatedAt: 1, label: 'stale server copy' }] },
    );
    assert.strictEqual(protectedRows.rows.length, 2, `${tier}: local-only row must survive`);
    assert.strictEqual(
      protectedRows.rows.find((r) => r.id === 'r2').label,
      'fresh local edit',
      `${tier}: stale element must be rejected per-element`,
    );

    // FWW is opt-in, so it must be requested explicitly. Both tiers must still
    // implement the veto identically.
    const fww = client.reconcileIncoming(
      { id: 1, createdAt: 100, author: 'original' },
      { id: 1, createdAt: 300, author: 'impostor' },
      { fwwKeys: 'createdAt' },
    );
    assert.strictEqual(fww.author, 'original', `${tier}: FWW must reject a later createdAt`);
    assert.strictEqual(fww.createdAt, 100, `${tier}: FWW keeps the earliest createdAt`);

    // ...and under the DEFAULT policy the same incoming node must land, because
    // its updatedAt is the newest write. A node-level FWW veto here would make
    // the record permanently unwritable from this replica.
    const noVeto = client.reconcileIncoming(
      { doc: { createdAt: 100, updatedAt: 100, v: 'base' } },
      { doc: { createdAt: 200, updatedAt: 999999, v: 'NEWEST WRITE' } },
    );
    assert.strictEqual(
      noVeto.doc.v,
      'NEWEST WRITE',
      `${tier}: the default policy must not veto the newest write`,
    );
  }
});

test('unparseable payloads fail the same way on both tiers', () => {
  // A payload holding a BigInt cannot be serialized, so JSON.stringify throws
  // before the engine is reached; a circular one likewise. What matters is
  // that neither tier silently succeeds.
  const circular = {};
  circular.self = circular;
  for (const client of [nativeClient, browserClient]) {
    assert.throws(() => client.reconcileIncoming(circular, { a: 1 }), TypeError);
    assert.throws(() => client.reconcileIncoming({ a: 1 }, { n: 1n }), TypeError);
  }
});

test('the wasm engine does not leak across the whole reconcile corpus', () => {
  // 100 passes over every scenario through the real client code path.
  for (let i = 0; i < 5; i++) {
    for (const [, local, incoming, options] of RECONCILE_SCENARIOS) {
      browserClient.reconcileIncoming(local, incoming, options);
    }
  }
  const baseline = wasmSyncer.heapAllocatedBytes();
  for (let i = 0; i < 100; i++) {
    for (const [, local, incoming, options] of RECONCILE_SCENARIOS) {
      browserClient.reconcileIncoming(local, incoming, options);
    }
  }
  assert.strictEqual(
    wasmSyncer.heapAllocatedBytes(),
    baseline,
    'reconciling through the client must not leak the wasm heap',
  );
});
