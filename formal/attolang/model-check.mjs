import assert from "node:assert/strict";

// Bounded protocol projection. Each send has a strictly increasing identity.
const maxId = 2;
const initial = Object.freeze({ sent: 0, committed: 0, acknowledged: 0, inFlight: 0 });
function invariant(s) {
  assert(s.sent >= 0 && s.sent <= maxId, "send bound");
  assert(s.acknowledged <= s.committed && s.committed <= s.sent, "ack <= committed <= sent");
  assert(s.inFlight === 0 || (s.inFlight > s.acknowledged && s.inFlight <= s.sent), "immutable in-flight identity");
  assert(s.acknowledged >= 0 && s.committed >= 0, "monotonic counters");
}
function transitions(s) {
  const out = [];
  if (s.inFlight === 0 && s.sent < maxId)
    out.push(["send", { ...s, sent: s.sent + 1, inFlight: s.sent + 1 }]);
  if (s.inFlight > 0) {
    if (s.committed < s.inFlight)
      out.push(["commit", { ...s, committed: s.inFlight }]);
    out.push(["loseResponse", { ...s }]);
    out.push(["staleResponse", { ...s }]);
    out.push(["duplicateReplay", { ...s }]);
    if (s.committed >= s.inFlight)
      out.push(["validAck", { ...s, acknowledged: s.inFlight, inFlight: 0 }]);
  }
  return out;
}
const queue = [initial], visited = new Set([JSON.stringify(initial)]), coverage = new Set();
let edges = 0;
for (let i = 0; i < queue.length; ++i) {
  const s = queue[i]; invariant(s);
  for (const [action, next] of transitions(s)) {
    coverage.add(action);
    invariant(next);
    assert(next.acknowledged >= s.acknowledged && next.committed >= s.committed,
      "no backwards progress");
    if (action === "duplicateReplay") assert.equal(next.committed, s.committed, "replay must be idempotent");
    edges++;
    const key = JSON.stringify(next);
    if (!visited.has(key)) { visited.add(key); queue.push(next); }
  }
}
for (const action of ["send", "commit", "loseResponse", "staleResponse", "duplicateReplay", "validAck"])
  assert(coverage.has(action), "unreachable action: " + action);
const waiting = queue.find(s => s.inFlight > 0 && s.committed < s.inFlight);
assert(waiting);
assert.throws(() => invariant({ ...waiting, acknowledged: waiting.sent }),
  /ack <= committed <= sent/, "ack before commit must fail");
const pending = queue.find(s => s.inFlight > 0);
assert(pending);
assert.throws(() => invariant({ ...pending, inFlight: pending.sent + 1 }),
  /immutable in-flight identity/, "future-response mutation must fail");
console.log("PASS bounded-ack-correlation", "states=" + visited.size, "edges=" + edges,
  "mutations=2", "guest=NOT_EXECUTED");
