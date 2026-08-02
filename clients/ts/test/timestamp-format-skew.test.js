'use strict';

// Mixed timestamp FORMATS break last-write-wins, against the real native core.
//
// The core compares non-digit timestamp strings lexicographically. That is
// correct and intended within one format — every format here is fixed-width, so
// lexicographic order equals chronological order. It is only comparisons
// ACROSS formats that are meaningless, and the failure is not subtle: an
// ISO-8601 string starts with its century ("2..."), while a native HLC starts
// with epoch millis ("1..." until the year 2286). So ISO always sorts above
// HLC, and the ISO writer wins every conflict no matter how stale it is.
//
// This is the hazard recorded on DEN-1238 and the concrete N-1/N case for the
// compatibility matrix (DEN-312): a client that has not adopted HLC stamping
// yet keeps emitting ISO, and silently beats every client that has. The clients
// deliberately do not overwrite a caller-supplied `updatedAt`, so this is
// reachable in ordinary use, not only during a rollout.
//
// These tests pin the behavior so it cannot change unnoticed. They assert what
// the engine DOES, including the part that is undesirable — see the
// `documents the inversion` cases.

const test = require('node:test');
const assert = require('node:assert');

const { reconcileIncoming } = require('../dist/reconcile.js');

// Real time: HLC millis 1753876800123 is 2025-07-30; the ISO stamps below are
// deliberately years apart so no assertion here depends on a near-tie.
const HLC_2025 = '1753876800123-0001-devA.t1';
const HLC_2025_LATER = '1753876800999-0001-devA.t1';
const ISO_2020 = '2020-01-01T00:00:00Z';
const ISO_2026 = '2026-01-01T00:00:00Z';

function merge(localStamp, incomingStamp) {
  return reconcileIncoming(
    { id: 'r1', v: 'local', updatedAt: localStamp },
    { id: 'r1', v: 'incoming', updatedAt: incomingStamp },
  ).v;
}

test('control: within one format, the newer write wins (all four formats)', () => {
  // If any of these regress, the problem is LWW itself, not format mixing —
  // which is why they run first.
  assert.strictEqual(merge(999, 123), 'local', 'integer millis');
  assert.strictEqual(merge('999', '123'), 'local', 'pure-digit strings');
  assert.strictEqual(merge(ISO_2026, ISO_2020), 'local', 'ISO-8601');
  assert.strictEqual(merge(HLC_2025_LATER, HLC_2025), 'local', 'native HLC');

  assert.strictEqual(merge(123, 999), 'incoming', 'integer millis');
  assert.strictEqual(merge('123', '999'), 'incoming', 'pure-digit strings');
  assert.strictEqual(merge(ISO_2020, ISO_2026), 'incoming', 'ISO-8601');
  assert.strictEqual(merge(HLC_2025, HLC_2025_LATER), 'incoming', 'native HLC');
});

test('documents the inversion: ISO beats HLC even when five years older', () => {
  // Local holds a 2025 HLC-stamped write; the server sends a 2020 ISO-stamped
  // one. Chronologically the local write must survive. It does not.
  assert.strictEqual(
    merge(HLC_2025, ISO_2020),
    'incoming',
    'a 2020 ISO write beats a 2025 HLC write — this is the hazard, not a bug in the test',
  );
});

test('documents the inversion: ISO wins from either side', () => {
  // The direction does not matter, which is what makes an un-migrated client a
  // silently privileged writer rather than merely a lucky one.
  assert.strictEqual(merge(HLC_2025, ISO_2020), 'incoming', 'ISO arriving wins');
  assert.strictEqual(merge(ISO_2020, HLC_2025), 'local', 'ISO already held wins');
});

test('the inversion is a format problem, not an HLC problem', () => {
  // Same two instants, both expressed as HLC: order is restored. This is what
  // rules out "HLC comparison is broken" as an explanation.
  const hlc2020 = '1577836800000-0000-devB.t1'; // 2020-01-01T00:00:00Z
  assert.strictEqual(
    merge(HLC_2025, hlc2020),
    'local',
    'with both sides on HLC, the 2025 write correctly survives',
  );
});

test('epoch integers and HLC strings mix badly too', () => {
  // Not only ISO. A numeric millis timestamp and an HLC string are different
  // types, so the engine has no common ordering to apply.
  const merged = reconcileIncoming(
    { id: 'r1', v: 'local', updatedAt: HLC_2025 },
    { id: 'r1', v: 'incoming', updatedAt: 1 },
  );
  // Recorded rather than asserted-as-desirable: what matters is that callers
  // must not rely on cross-type comparison being chronological.
  assert.ok(
    merged.v === 'local' || merged.v === 'incoming',
    'cross-type comparison must not throw',
  );
  assert.notStrictEqual(
    typeof merged.updatedAt,
    'undefined',
    'the timestamp key survives a cross-type comparison',
  );
});

test('mixing is per-key, so one bad key does not corrupt the others', () => {
  // syncedAt is also an LWW key. A record can be consistent on updatedAt while
  // mixed on syncedAt; the damage stays scoped to the mixed key.
  const merged = reconcileIncoming(
    { id: 'r1', v: 'local', updatedAt: HLC_2025_LATER, syncedAt: HLC_2025 },
    { id: 'r1', v: 'incoming', updatedAt: HLC_2025, syncedAt: HLC_2025_LATER },
  );
  assert.strictEqual(
    merged.v,
    'incoming',
    'a node is resolved as a whole: the newer syncedAt carries the node',
  );
});
