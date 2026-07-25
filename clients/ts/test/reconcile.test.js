'use strict';

// End-to-end tests of the pure reconcile path against the REAL native
// syncer.c addon (no Dexie / IndexedDB involved).
const test = require('node:test');
const assert = require('node:assert');

const {
  reconcileIncoming,
  ArrayStrategy,
  engineVersion,
  DEFAULT_RECONCILE_OPTIONS,
} = require('../dist/reconcile.js');

test('native engine is the v0.2.0 core', () => {
  assert.strictEqual(engineVersion(), '0.2.0');
});

test('defaults: resolveByTimestamp on, updatedAt/syncedAt LWW, createdAt FWW', () => {
  assert.deepStrictEqual(
    { ...DEFAULT_RECONCILE_OPTIONS },
    { resolveByTimestamp: true, lwwKeys: 'updatedAt,syncedAt', fwwKeys: 'createdAt' },
  );
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

test('createdAt FWW: incoming claiming a later creation is rejected', () => {
  const local = { id: 1, createdAt: 100, author: 'original' };
  const incoming = { id: 1, createdAt: 300, author: 'impostor' };
  const merged = reconcileIncoming(local, incoming);
  assert.strictEqual(merged.author, 'original');
  assert.strictEqual(merged.createdAt, 100);
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
    resolveByTimestamp: false,
  });
  assert.deepStrictEqual(replace.tags, ['c'], 'REPLACE is the default strategy');
});
