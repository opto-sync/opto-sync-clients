/** Replay Quint connectivity traces through the production TypeScript watcher. */
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

const require = createRequire(import.meta.url);
const { ManualConnectivityWatcher } = require('../clients/ts');
const { version } = require('../clients/ts/package.json');
const ACTION_FIELD = 'mbt::actionTaken';
const REQUIRED_ACTIONS = Object.freeze([
  'init',
  'idle',
  'publish_unknown',
  'publish_offline',
  'publish_link',
  'publish_internet',
  'force_offline',
  'restore_automatic',
]);
const REQUIRED_SCENARIOS = Object.freeze([
  'idempotent_force_offline',
  'idempotent_restore_automatic',
]);
const PUBLISHED_STATE_BY_ACTION = Object.freeze({
  publish_unknown: 'unknown',
  publish_offline: 'offline',
  publish_link: 'link',
  publish_internet: 'internet',
});
const STATE_BY_TAG = Object.freeze({
  Unknown: 'unknown',
  Offline: 'offline',
  Link: 'link',
  Internet: 'internet',
});
const MODE_BY_TAG = Object.freeze({
  Automatic: 'automatic',
  ForcedOffline: 'offline',
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

function enumValue(value, mapping, label) {
  const tag = field(object(value, label), 'tag');
  ensure(typeof tag === 'string' && mapping[tag], `unknown ${label} ${String(tag)}`);
  return mapping[tag];
}

function modelProjection(rawState) {
  const state = object(field(rawState, 's'), 'ITF connectivity state');
  for (const name of ['exposed_verified', 'emitted']) {
    ensure(typeof field(state, name) === 'boolean', `${name} must be boolean`);
  }
  return {
    state: enumValue(state.exposed_state, STATE_BY_TAG, 'connectivity state'),
    mode: enumValue(state.mode, MODE_BY_TAG, 'connectivity mode'),
    verified: state.exposed_verified,
    emitted: state.emitted,
  };
}

function implementationProjection(watcher, emitted) {
  const snapshot = watcher.snapshot();
  return {
    state: snapshot.state,
    mode: snapshot.mode,
    verified: snapshot.verifiedAt !== undefined,
    emitted,
  };
}

function applyAction(watcher, action) {
  const publishedState = PUBLISHED_STATE_BY_ACTION[action];
  if (publishedState) {
    watcher.publish(publishedState, 'manual');
    return;
  }
  if (action === 'force_offline') {
    watcher.setMode('offline');
    return;
  }
  if (action === 'restore_automatic') {
    watcher.setMode('automatic');
    return;
  }
  ensure(action === 'idle', `model action ${action} has no production operation`);
}

function replayTrace(path, coverage, scenarios) {
  const trace = object(JSON.parse(readFileSync(path, 'utf8')), 'ITF trace');
  const states = field(trace, 'states');
  ensure(Array.isArray(states) && states.length > 0, 'ITF trace must contain states');
  ensure(states.length <= 100_000, 'ITF trace exceeds the connectivity replay state limit');

  let clock = 1;
  const watcher = new ManualConnectivityWatcher({ now: () => clock++ });
  let deliveryCount = 0;
  watcher.subscribe(() => {
    deliveryCount += 1;
  }, { emitCurrent: false });

  for (let step = 0; step < states.length; step += 1) {
    const rawState = object(states[step], `ITF state ${step}`);
    const action = field(rawState, ACTION_FIELD);
    ensure(typeof action === 'string' && action.length > 0, `ITF state ${step} has no model action`);
    ensure(REQUIRED_ACTIONS.includes(action), `ITF state ${step} has unknown action ${action}`);
    coverage.add(action);

    const deliveriesBefore = deliveryCount;
    if (step === 0) {
      ensure(action === 'init', 'the first connectivity state must be init');
    } else {
      const previousMode = watcher.snapshot().mode;
      if (action === 'force_offline' && previousMode === 'offline') {
        scenarios.add('idempotent_force_offline');
      }
      if (action === 'restore_automatic' && previousMode === 'automatic') {
        scenarios.add('idempotent_restore_automatic');
      }
      applyAction(watcher, action);
    }

    const expected = modelProjection(rawState);
    const actual = implementationProjection(watcher, deliveryCount > deliveriesBefore);
    if (!isDeepStrictEqual(actual, expected)) {
      return {
        trace: path,
        step,
        action,
        message: 'production TypeScript connectivity watcher does not refine Quint',
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
  ensure(request.project === 'opto-sync-clients', 'unexpected connectivity project');
  ensure(request.model === 'connectivity-override-v1', 'unexpected connectivity model');
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
      message: `connectivity trace corpus is missing actions: ${missing.join(', ')}`,
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
      message: `connectivity trace corpus is missing critical scenarios: ${missingScenarios.join(', ')}`,
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
      name: '@opto-sync/client ManualConnectivityWatcher',
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
