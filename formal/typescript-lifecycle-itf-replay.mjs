/** Replay Quint lifecycle traces through the production TypeScript machine. */
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

import { SyncLifecycleMachine } from '../clients/reactive-ts/src/sync-lifecycle.ts';

const require = createRequire(import.meta.url);
const { version } = require('../clients/reactive-ts/package.json');
const ACTION_FIELD = 'mbt::actionTaken';
const REQUIRED_ACTIONS = Object.freeze([
  'init',
  'idle',
  'wake',
  'join',
  'begin_acquire',
  'acquire_granted',
  'acquire_deferred',
  'cancel',
  'cycle_settled',
  'release_settled',
  'request_close',
  'process_abort',
]);
const REQUIRED_SCENARIOS = Object.freeze([
  'close_during_acquire',
  'close_while_running',
  'wake_while_running',
  'grant_after_close',
  'defer_after_close',
  'release_after_close',
  'process_abort_with_permit',
]);
const EVENT_BY_ACTION = Object.freeze({
  wake: 'wake',
  join: 'join',
  begin_acquire: 'begin-acquire',
  acquire_granted: 'acquire-granted',
  acquire_deferred: 'acquire-deferred',
  cancel: 'cancel',
  cycle_settled: 'cycle-settled',
  release_settled: 'release-settled',
  request_close: 'close',
  process_abort: 'process-abort',
});
const PHASE_BY_TAG = Object.freeze({
  Idle: 'idle',
  Acquiring: 'acquiring',
  Running: 'running',
  Releasing: 'releasing',
  Closed: 'closed',
});

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, label) {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function field(value, name) {
  const record = object(value, `container for ${name}`);
  ensure(Object.prototype.hasOwnProperty.call(record, name), `missing field ${name}`);
  return record[name];
}

function modelProjection(rawState) {
  const state = object(field(rawState, 's'), 'ITF lifecycle state');
  const phaseTag = field(field(state, 'phase'), 'tag');
  ensure(typeof phaseTag === 'string' && PHASE_BY_TAG[phaseTag], `unknown lifecycle phase ${String(phaseTag)}`);
  for (const name of ['wake_pending', 'close_requested', 'cancel_requested', 'permit_held']) {
    ensure(typeof field(state, name) === 'boolean', `${name} must be boolean`);
  }
  return {
    phase: PHASE_BY_TAG[phaseTag],
    wakePending: state.wake_pending,
    closeRequested: state.close_requested,
    cancelRequested: state.cancel_requested,
    permitHeld: state.permit_held,
  };
}

function implementationProjection(machine) {
  const state = machine.state;
  return {
    phase: state.phase,
    wakePending: state.wakePending,
    closeRequested: state.closeRequested,
    cancelRequested: state.cancelRequested,
    permitHeld: state.permitHeld,
  };
}

function recordScenario(action, previous, scenarios) {
  if (action === 'request_close' && previous.phase === 'acquiring') scenarios.add('close_during_acquire');
  if (action === 'request_close' && previous.phase === 'running') scenarios.add('close_while_running');
  if (action === 'wake' && previous.phase === 'running') scenarios.add('wake_while_running');
  if (action === 'acquire_granted' && previous.closeRequested) scenarios.add('grant_after_close');
  if (action === 'acquire_deferred' && previous.closeRequested) scenarios.add('defer_after_close');
  if (action === 'release_settled' && previous.closeRequested) scenarios.add('release_after_close');
  if (action === 'process_abort' && previous.permitHeld) scenarios.add('process_abort_with_permit');
}

function replayTrace(path, coverage, scenarios) {
  const trace = object(JSON.parse(readFileSync(path, 'utf8')), 'ITF trace');
  const states = field(trace, 'states');
  ensure(Array.isArray(states) && states.length > 0, 'ITF trace must contain states');
  ensure(states.length <= 100_000, 'ITF trace exceeds the lifecycle replay state limit');
  const machine = new SyncLifecycleMachine();

  for (let step = 0; step < states.length; step += 1) {
    const rawState = object(states[step], `ITF state ${step}`);
    const action = field(rawState, ACTION_FIELD);
    ensure(typeof action === 'string' && action.length > 0, `ITF state ${step} has no model action`);
    ensure(REQUIRED_ACTIONS.includes(action), `ITF state ${step} has unknown action ${action}`);
    coverage.add(action);

    if (step === 0) {
      ensure(action === 'init', 'the first lifecycle state must be init');
    } else if (action !== 'idle') {
      recordScenario(action, modelProjection(states[step - 1]), scenarios);
      const event = EVENT_BY_ACTION[action];
      ensure(event, `model action ${action} has no production event`);
      machine.apply(event);
    }

    const expected = modelProjection(rawState);
    const actual = implementationProjection(machine);
    if (!isDeepStrictEqual(actual, expected)) {
      return {
        trace: path,
        step,
        action,
        message: 'production TypeScript lifecycle state does not refine Quint',
        expected,
        actual,
      };
    }
  }
  return undefined;
}

function validateRequest(value) {
  const request = object(value, 'adapter request');
  const expectedKeys = ['adapter', 'model', 'project', 'protocol', 'specification', 'traces'];
  ensure(isDeepStrictEqual(Object.keys(request).sort(), expectedKeys), 'adapter request contains missing or unknown fields');
  ensure(request.protocol === 'fmctl.adapter.v1', 'unsupported adapter protocol');
  ensure(request.adapter === 'typescript', 'request selected a non-TypeScript adapter');
  ensure(request.project === 'opto-sync-clients', 'unexpected lifecycle project');
  ensure(request.model === 'mobile-desktop-lifecycle-v1', 'unexpected lifecycle model');
  ensure(typeof request.specification === 'string' && statSync(request.specification).isFile(), 'specification is not a regular file');
  ensure(Array.isArray(request.traces) && request.traces.length > 0, 'request must contain traces');
  ensure(request.traces.every((trace) => typeof trace === 'string' && statSync(trace).isFile()), 'every trace must be a regular file');
  return request;
}

function replayPaths(paths) {
  const coverage = new Set();
  const scenarios = new Set();
  const mismatches = [];
  let passed = 0;
  for (const path of [...paths].sort()) {
    try {
      const mismatch = replayTrace(path, coverage, scenarios);
      if (mismatch) mismatches.push(mismatch);
      else passed += 1;
    } catch (error) {
      mismatches.push({
        trace: path,
        step: null,
        action: null,
        message: error instanceof Error ? error.message : String(error),
        expected: {},
        actual: {},
      });
    }
  }

  const missing = REQUIRED_ACTIONS.filter((action) => !coverage.has(action));
  if (missing.length > 0) {
    mismatches.push({
      trace: paths[0],
      step: null,
      action: null,
      message: `lifecycle trace corpus is missing actions: ${missing.join(', ')}`,
      expected: REQUIRED_ACTIONS,
      actual: [...coverage].sort(),
    });
    passed = Math.min(passed, paths.length - 1);
  }

  const missingScenarios = REQUIRED_SCENARIOS.filter((scenario) => !scenarios.has(scenario));
  if (missingScenarios.length > 0) {
    mismatches.push({
      trace: paths[0],
      step: null,
      action: null,
      message: `lifecycle trace corpus is missing critical scenarios: ${missingScenarios.join(', ')}`,
      expected: REQUIRED_SCENARIOS,
      actual: [...scenarios].sort(),
    });
    passed = Math.min(passed, paths.length - 1);
  }

  return {
    protocol: 'fmctl.adapter.v1',
    success: mismatches.length === 0,
    traces_total: paths.length,
    traces_passed: passed,
    mismatches,
    implementation: {
      language: 'typescript',
      name: '@opto-sync/reactive SyncLifecycleMachine',
      version,
    },
  };
}

const paths = process.argv.slice(2);
if (paths.length > 0) {
  process.stdout.write(`${JSON.stringify(replayPaths(paths), null, 2)}\n`);
} else {
  const request = validateRequest(JSON.parse(readFileSync(0, 'utf8')));
  process.stdout.write(JSON.stringify(replayPaths(request.traces)));
}
