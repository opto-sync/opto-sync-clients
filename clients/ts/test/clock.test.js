'use strict';

// The HLC exists so the merge engine's last-write-wins is actually correct.
// These tests cover the three wall-clock failures it is meant to prevent, and
// then prove the engine orders its output the way we claim.
const test = require('node:test');
const assert = require('node:assert');

const {
  HybridLogicalClock,
  parseHlc,
  compareHlc,
  randomNodeId,
} = require('../dist/clock.js');
const { reconcileIncoming } = require('../dist/reconcile.js');

function fixedClock(startMs) {
  let t = startMs;
  return { now: () => t, set: (v) => { t = v; }, advance: (d) => { t += d; } };
}

test('timestamps are monotonic within a single millisecond', async () => {
  const wall = fixedClock(1_721_822_400_000);
  const hlc = new HybridLogicalClock({ nodeId: 'aaaa', now: wall.now });
  const a = await hlc.next();
  const b = await hlc.next();
  const c = await hlc.next();
  assert.ok(compareHlc(a, b) < 0 && compareHlc(b, c) < 0, `${a} < ${b} < ${c}`);
  assert.strictEqual(parseHlc(a).counter, 0);
  assert.strictEqual(parseHlc(b).counter, 1);
});

test('a wall clock that jumps BACKWARDS still yields increasing timestamps', async () => {
  // The real-world failure: NTP correction or suspend/resume. Without the HLC
  // the device's later edits would lose to its own earlier ones and vanish.
  const wall = fixedClock(1_721_822_400_000);
  const hlc = new HybridLogicalClock({ nodeId: 'aaaa', now: wall.now });
  const before = await hlc.next();
  wall.set(1_721_822_100_000); // five minutes into the past
  const after = await hlc.next();
  assert.ok(compareHlc(after, before) > 0, `${after} must outrank ${before}`);
});

test('observe() advances past a remote timestamp so the next local write wins', async () => {
  const wall = fixedClock(1_000_000_000_000);
  const local = new HybridLogicalClock({ nodeId: 'aaaa', now: wall.now });
  const remoteFuture = '1721822400000-00ff-bbbb';
  await local.observe(remoteFuture);
  const next = await local.next();
  assert.ok(compareHlc(next, remoteFuture) > 0, `${next} must outrank observed ${remoteFuture}`);
});

test('observe() ignores non-HLC timestamps rather than corrupting the clock', async () => {
  const wall = fixedClock(1_721_822_400_000);
  const hlc = new HybridLogicalClock({ nodeId: 'aaaa', now: wall.now });
  await hlc.observe('2026-07-25T00:00:00Z'); // legacy ISO writer
  await hlc.observe('1721822400000');        // legacy epoch writer
  const parts = hlc.peek();
  assert.strictEqual(parts.millis, 0, 'clock must not adopt an incomparable scale');
});

test('two nodes never produce equal timestamps, so the order is total', async () => {
  const wall = fixedClock(1_721_822_400_000);
  const a = new HybridLogicalClock({ nodeId: 'aaaa', now: wall.now });
  const b = new HybridLogicalClock({ nodeId: 'bbbb', now: wall.now });
  const ta = await a.next();
  const tb = await b.next();
  assert.notStrictEqual(ta, tb);
  assert.notStrictEqual(compareHlc(ta, tb), 0, 'a tie would make the merge order-dependent');
});

test('lexicographic order equals chronological order across a second boundary', async () => {
  const wall = fixedClock(1_721_822_399_999);
  const hlc = new HybridLogicalClock({ nodeId: 'aaaa', now: wall.now });
  const first = await hlc.next();
  wall.advance(2);
  const second = await hlc.next();
  // Plain string comparison must agree — this is what the C core does for
  // non-digit strings, so fixed-width padding is load-bearing.
  assert.ok(first < second, `${first} < ${second}`);
});

test('persistence keeps the clock monotonic across a simulated reload', async () => {
  let stored = null;
  const persistence = { load: () => stored, save: (t) => { stored = t; } };
  const wall = fixedClock(1_721_822_400_000);

  const first = new HybridLogicalClock({ nodeId: 'aaaa', now: wall.now, persistence });
  await first.restore();
  const last = await first.next();

  // Reload with the wall clock moved backwards — the worst case.
  wall.set(1_721_800_000_000);
  const reloaded = new HybridLogicalClock({ nodeId: 'aaaa', now: wall.now, persistence });
  await reloaded.restore();
  const afterReload = await reloaded.next();

  assert.ok(compareHlc(afterReload, last) > 0, `${afterReload} must outrank pre-reload ${last}`);
});

test('a node id containing the delimiter is rejected', () => {
  assert.throws(() => new HybridLogicalClock({ nodeId: 'has-dash' }), /must not contain/);
  assert.throws(() => new HybridLogicalClock({ nodeId: '' }), /stable nodeId/);
});

test('randomNodeId is delimiter-free and long enough to avoid collisions', () => {
  const ids = new Set(Array.from({ length: 500 }, () => randomNodeId()));
  assert.strictEqual(ids.size, 500, 'node ids must not collide');
  for (const id of ids) assert.ok(!id.includes('-'), id);
});

test('THE POINT: the C merge engine orders HLC timestamps correctly', async () => {
  // A device with a fast wall clock must NOT win once both sides use HLCs that
  // have observed each other. This is the end-to-end reason the module exists.
  const slowWall = fixedClock(1_721_822_400_000);
  const fastWall = fixedClock(1_721_822_700_000); // 5 minutes ahead

  const slow = new HybridLogicalClock({ nodeId: 'slow', now: slowWall.now });
  const fast = new HybridLogicalClock({ nodeId: 'fast', now: fastWall.now });

  // The fast device writes first in real time.
  const fastEdit = { id: 'r1', title: 'from fast device', updatedAt: await fast.next() };
  // The slow device observes it, then makes a genuinely later edit.
  await slow.observe(fastEdit.updatedAt);
  const slowEdit = { id: 'r1', title: 'from slow device', updatedAt: await slow.next() };

  // Applied in either order, the causally-later edit survives.
  assert.strictEqual(reconcileIncoming(fastEdit, slowEdit).title, 'from slow device');
  assert.strictEqual(reconcileIncoming(slowEdit, fastEdit).title, 'from slow device');
});
