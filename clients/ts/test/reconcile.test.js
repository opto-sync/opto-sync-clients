'use strict';

// End-to-end tests of the pure reconcile path against the REAL native
// syncer.c addon (no Dexie / IndexedDB involved).
const test = require('node:test');
const assert = require('node:assert');

function assertCoreAtLeast(v, label = 'core') {
  // Lower bound, not an exact match: an exact pin fails on every patch bump
  // yet still would not catch a stale artifact reporting an OLDER version.
  const [maj, min, patch] = String(v).split('.').map(Number);
  assert.ok(
    maj > 0 || min > 2 || (min === 2 && patch >= 1),
    `${label} reports unexpected core version ${v}`,
  );
}


const {
  reconcileIncoming,
  ArrayStrategy,
  engineVersion,
  DEFAULT_RECONCILE_OPTIONS,
} = require('../dist/reconcile.js');

test('native engine reports a supported core version', () => {
  assertCoreAtLeast(engineVersion(), 'native engine');
});

test('defaults: mergeByKey on id, updatedAt/syncedAt LWW, NO fwwKeys', () => {
  // These defaults are a cross-tier contract: the Dart client, the Rust
  // client, and every opto-sync server use exactly this policy. Changing any
  // value here makes the same document reconcile differently per platform.
  //
  // `fwwKeys` is absent on purpose. It used to be "createdAt", which turned
  // out to be a node-level veto rather than field protection — see the
  // regression test below.
  assert.deepStrictEqual(
    { ...DEFAULT_RECONCILE_OPTIONS },
    {
      arrayStrategy: ArrayStrategy.MERGE_BY_KEY,
      arrayMatchKeys: 'id',
      resolveByTimestamp: true,
      lwwKeys: 'updatedAt,syncedAt',
    },
  );
  assert.strictEqual(
    DEFAULT_RECONCILE_OPTIONS.fwwKeys,
    undefined,
    'no key may veto a write by being NEWER under the default policy',
  );
});

test('default strategy protects local array elements the server has not seen', () => {
  // Regression guard for a real defect: with the binding's own REPLACE
  // default, this dropped the local-only element AND applied a stale one,
  // because element-level timestamp resolution only runs under MERGE_BY_KEY.
  const local = {
    rows: [
      { id: 'r1', label: 'local-only' },
      { id: 'r2', updatedAt: 9000, label: 'fresh local edit' },
    ],
  };
  const incoming = { rows: [{ id: 'r2', updatedAt: 1, label: 'stale server copy' }] };
  const merged = reconcileIncoming(local, incoming);
  const byId = Object.fromEntries(merged.rows.map((r) => [r.id, r]));
  assert.ok(byId.r1, 'local-only element must survive');
  assert.strictEqual(byId.r2.label, 'fresh local edit', 'stale element must be rejected');
  assert.strictEqual(merged.rows.length, 2);
});

test('stale incoming record is rejected by updatedAt (LWW)', () => {
  const local = { id: 'r1', title: 'edited locally', updatedAt: 2000 };
  const incoming = { id: 'r1', title: 'stale server copy', updatedAt: 1000 };
  const merged = reconcileIncoming(local, incoming);
  assert.strictEqual(merged.title, 'edited locally');
  assert.strictEqual(merged.updatedAt, 2000);
});

test('fresh incoming record is accepted by updatedAt (LWW)', () => {
  const local = { id: 'r1', title: 'old local', views: 7, updatedAt: 1000 };
  const incoming = { id: 'r1', title: 'newer from server', updatedAt: 2000 };
  const merged = reconcileIncoming(local, incoming);
  assert.strictEqual(merged.title, 'newer from server');
  assert.strictEqual(merged.updatedAt, 2000);
  assert.strictEqual(merged.views, 7, 'untouched local field survives the deep merge');
});

test('syncedAt participates in LWW alongside updatedAt', () => {
  const local = { v: 'local', syncedAt: 500 };
  const incoming = { v: 'server', syncedAt: 400 };
  const merged = reconcileIncoming(local, incoming);
  assert.strictEqual(merged.v, 'local');
});

test('explicit fwwKeys: incoming claiming a later creation is rejected', () => {
  // The engine feature is still there and still covered — it is just opt-in
  // now, so the option is passed explicitly rather than inherited.
  const local = { id: 1, createdAt: 100, author: 'original' };
  const incoming = { id: 1, createdAt: 300, author: 'impostor' };
  const merged = reconcileIncoming(local, incoming, { fwwKeys: 'createdAt' });
  assert.strictEqual(merged.author, 'original');
  assert.strictEqual(merged.createdAt, 100);
});

test('REGRESSION: the default policy never discards the NEWEST write', () => {
  // `createdAt` was in DEFAULT_RECONCILE_OPTIONS.fwwKeys, and FWW in the C core
  // is a node-level VETO, not field protection: should_reject_by_crdt_rules
  // dropped the ENTIRE incoming node when incoming.createdAt > base.createdAt,
  // no matter how new incoming.updatedAt was.
  //
  //   base     {"doc":{"createdAt":100,"updatedAt":100,"v":"base"}}
  //   incoming {"doc":{"createdAt":200,"updatedAt":999999,"v":"NEWEST WRITE"}}
  //   result   {"doc":{"createdAt":100,"updatedAt":100,"v":"base"}}   <-- dropped
  //
  // Consequence: any replica holding a later `createdAt` for a record (two
  // devices creating the same id offline is enough) could never write to that
  // record again — permanently, silently, behind a 200 OK.
  const base = { doc: { createdAt: 100, updatedAt: 100, v: 'base' } };
  const incoming = { doc: { createdAt: 200, updatedAt: 999999, v: 'NEWEST WRITE' } };

  const merged = reconcileIncoming(base, incoming);
  assert.strictEqual(
    merged.doc.v,
    'NEWEST WRITE',
    'the newest write must land under the default policy',
  );
  assert.strictEqual(merged.doc.updatedAt, 999999);
  assert.strictEqual(merged.doc.createdAt, 200);

  // And the write is not a one-off fluke of ordering: the replica can keep
  // writing to the same node afterwards.
  const again = reconcileIncoming(merged, {
    doc: { createdAt: 300, updatedAt: 1000000, v: 'AND AGAIN' },
  });
  assert.strictEqual(again.doc.v, 'AND AGAIN', 'the record must not become write-locked');

  // Pinning the old behavior as opt-in, so the veto is proven to be a policy
  // choice and not something the engine stopped doing.
  const vetoed = reconcileIncoming(base, incoming, { fwwKeys: 'createdAt' });
  assert.strictEqual(vetoed.doc.v, 'base', 'explicit fwwKeys still vetoes the whole node');
  assert.strictEqual(vetoed.doc.updatedAt, 100, 'the veto ignores the newer updatedAt');
});

test('mergeByKey on an array-valued jsonb field with per-element LWW', () => {
  const local = {
    items: [
      { id: 1, name: 'alpha', qty: 5, updatedAt: 200 },
      { id: 2, name: 'beta', updatedAt: 100 },
    ],
  };
  const incoming = {
    items: [
      { id: 2, name: 'beta-renamed', updatedAt: 150 },
      { id: 1, name: 'stale-alpha', updatedAt: 50 },
      { id: 3, name: 'gamma', updatedAt: 400 },
    ],
  };
  const merged = reconcileIncoming(local, incoming, {
    arrayStrategy: ArrayStrategy.MERGE_BY_KEY,
  });
  const byId = Object.fromEntries(merged.items.map((i) => [i.id, i]));
  assert.strictEqual(merged.items.length, 3);
  assert.strictEqual(byId[1].name, 'alpha', 'stale incoming element rejected per-element');
  assert.strictEqual(byId[1].qty, 5);
  assert.strictEqual(byId[2].name, 'beta-renamed', 'fresh incoming element accepted despite reorder');
  assert.strictEqual(byId[3].name, 'gamma', 'unmatched incoming element appended');
});

test('arrayMatchKeys: custom identity keys ("uuid,id")', () => {
  const local = { rows: [{ uuid: 'u-1', v: 1 }, { id: 7, v: 2 }] };
  const incoming = { rows: [{ uuid: 'u-1', v: 10 }, { id: 7, v: 20 }] };
  const merged = reconcileIncoming(local, incoming, {
    arrayStrategy: ArrayStrategy.MERGE_BY_KEY,
    arrayMatchKeys: 'uuid,id',
    resolveByTimestamp: false,
  });
  assert.strictEqual(merged.rows.length, 2, 'no duplicated rows');
  assert.strictEqual(merged.rows.find((r) => r.uuid === 'u-1').v, 10);
  assert.strictEqual(merged.rows.find((r) => r.id === 7).v, 20);
});

test('mergeByKey normalizes id types: numeric 42 matches string "42"', () => {
  const merged = reconcileIncoming(
    { rows: [{ id: 42, v: 'old' }] },
    { rows: [{ id: '42', v: 'new' }] },
    { arrayStrategy: ArrayStrategy.MERGE_BY_KEY, resolveByTimestamp: false },
  );
  assert.strictEqual(merged.rows.length, 1);
  assert.strictEqual(merged.rows[0].v, 'new');
});

test('other array strategies remain reachable through options', () => {
  const union = reconcileIncoming({ tags: ['a', 'b'] }, { tags: ['b', 'c'] }, {
    arrayStrategy: ArrayStrategy.UNION,
    resolveByTimestamp: false,
  });
  assert.deepStrictEqual(union.tags, ['a', 'b', 'c']);

  const replace = reconcileIncoming({ tags: ['a', 'b'] }, { tags: ['c'] }, {
    arrayStrategy: ArrayStrategy.REPLACE,
    resolveByTimestamp: false,
  });
  assert.deepStrictEqual(replace.tags, ['c'], 'REPLACE must stay opt-in-able');

  // The default unions scalar arrays (no identity key to match on), which is
  // what keeps a repeated sync idempotent.
  const defaulted = reconcileIncoming({ tags: ['a', 'b'] }, { tags: ['b', 'c'] }, {
    resolveByTimestamp: false,
  });
  assert.deepStrictEqual(defaulted.tags, ['a', 'b', 'c']);
});
