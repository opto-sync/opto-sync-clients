import assert from "node:assert/strict";

// Finite refinement candidate for the Opto-Sync response-identity boundary.
// This is deliberately independent of the reviewed .atto source, and never
// substitutes for compiler-backed guest execution or the full Quint protocol.
const maxId = 2;
const responseDomain = [-1, 0, 1, 2, 3];
const initial = Object.freeze({
  sent: 0, committed: 0, acknowledged: 0, inFlight: 0, appliedEffects: 0
});

function invariant(s) {
  assert(Number.isInteger(s.sent) && s.sent >= 0 && s.sent <= maxId, "send bound");
  assert(Number.isInteger(s.committed) && Number.isInteger(s.acknowledged), "integer watermarks");
  assert(s.acknowledged >= 0 && s.acknowledged <= s.committed && s.committed <= s.sent,
    "ack <= committed <= sent");
  assert(s.appliedEffects === s.committed, "each committed identity applies exactly once");
  assert(s.inFlight === 0 ||
    (s.inFlight === s.sent && s.inFlight > s.acknowledged),
    "immutable in-flight identity");
}

// A response must correlate to the *exact* outstanding request and to a
// durable server commit. An older response is not interchangeable with the
// higher watermark of a newer in-flight request.
function responseIsValid(s, responseId) {
  return s.inFlight > 0 && responseId === s.inFlight &&
    s.committed >= responseId;
}

// Independent transition oracle: a compiler or adapter that admits a stale,
// future or uncommitted ACK fails here even when aggregate watermarks look sane.
function checkResponseStep(before, after, responseId) {
  const shouldAck = before.inFlight > 0 &&
    before.inFlight === responseId && before.committed >= before.inFlight;
  if (shouldAck) {
    assert.equal(after.acknowledged, before.inFlight,
      "exact committed response must acknowledge the in-flight identity");
    assert.equal(after.inFlight, 0,
      "accepted response must retire its exact in-flight identity");
  } else {
    assert.equal(after.acknowledged, before.acknowledged,
      "invalid response must not advance acknowledgement");
    assert.equal(after.inFlight, before.inFlight,
      "invalid response must not clear in-flight request");
  }
  assert.equal(after.committed, before.committed, "response cannot change server commit");
  assert.equal(after.appliedEffects, before.appliedEffects,
    "response cannot apply a server mutation");
}

function transitions(s) {
  const out = [];
  if (s.inFlight === 0 && s.sent < maxId) {
    out.push(["send", { ...s, sent: s.sent + 1, inFlight: s.sent + 1 }]);
  }
  if (s.inFlight > 0) {
    if (s.committed < s.inFlight) {
      out.push(["commit", {
        ...s, committed: s.inFlight, appliedEffects: s.appliedEffects + 1
      }]);
    }
    // Network loss and replay are represented as explicit no-op edges; they
    // never create a second server effect or advance the client watermark.
    out.push(["lostResponse", { ...s }]);
    out.push(["duplicateReplay", { ...s }]);
    for (const responseId of responseDomain) {
      const accepted = responseIsValid(s, responseId);
      const next = accepted
        ? { ...s, acknowledged: responseId, inFlight: 0 }
        : { ...s };
      out.push(["response:" + responseId, next, responseId]);
    }
  }
  return out;
}

const queue = [initial];
const visited = new Set([JSON.stringify(initial)]);
const coverage = new Set();
let edges = 0;
let validResponses = 0;
let rejectedResponses = 0;
for (let i = 0; i < queue.length; ++i) {
  const state = queue[i];
  invariant(state);
  for (const [action, next, responseId] of transitions(state)) {
    invariant(next);
    coverage.add(action);
    edges++;
    assert(next.sent >= state.sent && next.committed >= state.committed &&
      next.acknowledged >= state.acknowledged,
      "watermarks must never decrease");
    if (action === "duplicateReplay") {
      assert.equal(next.appliedEffects, state.appliedEffects,
        "duplicate replay must not reapply the server effect");
    }
    if (responseId !== undefined) {
      checkResponseStep(state, next, responseId);
      if (next.acknowledged !== state.acknowledged) validResponses++;
      else rejectedResponses++;
    }
    const key = JSON.stringify(next);
    if (!visited.has(key)) {
      visited.add(key);
      queue.push(next);
    }
  }
}

for (const action of [
  "send", "commit", "lostResponse", "duplicateReplay",
  ...responseDomain.map(x => "response:" + x)
]) assert(coverage.has(action), "vacuous/unreachable action " + action);
assert(validResponses > 0 && rejectedResponses > 0,
  "must witness both valid and invalid response decisions");
const uncommitted = queue.find(s => s.inFlight > 0 && s.committed < s.inFlight);
assert(uncommitted, "missing uncommitted in-flight witness");
const waitingTwo = queue.find(s => s.inFlight === 2 && s.committed === 2);
assert(waitingTwo, "missing newer request with older committed response witness");

// Mutation 1: an ACK accepted before its corresponding server commit.
// Conservation alone must be unable to excuse a premature acknowledgement.
assert.throws(() => checkResponseStep(uncommitted,
  { ...uncommitted, acknowledged: uncommitted.inFlight, inFlight: 0 },
  uncommitted.inFlight), /invalid response must not advance acknowledgement/,
"precommit acknowledgement mutation must fail");

// Mutation 2: an older response after a newer request has already committed.
// A weakened '<=' match violates the immutable in-flight response identity.
assert.throws(() => checkResponseStep(waitingTwo,
  { ...waitingTwo, acknowledged: 1, inFlight: 0 }, 1),
  /invalid response must not clear in-flight request/,
  "stale but plausible acknowledgement mutation must fail");

// Mutation 3: a duplicate replay that applies the committed effect again.
const committedState = queue.find(s => s.committed > 0);
assert(committedState, "missing committed witness");
assert.throws(() => invariant({
  ...committedState, appliedEffects: committedState.appliedEffects + 1
}), /each committed identity applies exactly once/,
  "duplicate application mutation must fail");

console.log("PASS bounded-ack-correlation", "states=" + visited.size,
  "edges=" + edges, "accepted=" + validResponses,
  "rejected=" + rejectedResponses, "mutations=3", "guest=NOT_EXECUTED");
