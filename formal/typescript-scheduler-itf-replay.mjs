/** Replay Quint scheduler traces through the production TypeScript sync loop. */
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

import {
  ProtocolSyncLoop,
  SyncTransportError,
} from '../clients/ts/dist/esm/sync-loop.js';

const require = createRequire(import.meta.url);
const { version } = require('../clients/ts/package.json');
const ACTION_FIELD = 'mbt::actionTaken';
const REQUIRED_ACTIONS = Object.freeze([
  'init',
  'idle',
  'start',
  'stop',
  'hint',
  'go_offline',
  'go_online',
  'timer_fire',
  'timer_join',
  'stale_timer_fire',
  'page_more',
  'begin_reset',
  'finish_reset',
  'cycle_success',
  'cycle_success_more',
  'cycle_retryable_failure',
  'cycle_permanent_failure',
  'malformed_response',
  'stale_cycle_success',
  'stale_cycle_failure',
]);
const REQUIRED_SCENARIOS = Object.freeze([
  'stop_during_cycle',
  'trailing_wake',
  'offline_during_cycle',
  'online_recovery',
  'retryable_failure',
  'permanent_failure',
  'reset_ordering',
  'malformed_response',
  'paging_rerun',
  'stale_cycle',
  'stale_timer',
]);
const PHASE_BY_TAG = Object.freeze({
  Stopped: 'stopped',
  Idle: 'idle',
  Syncing: 'syncing',
  Offline: 'offline',
  Backoff: 'backoff',
  Error: 'error',
});
const RESET_BY_TAG = Object.freeze({
  NoReset: 'none',
  SnapshotRequested: 'requested',
  SnapshotInstalled: 'installed',
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

function tagged(value, mapping, label) {
  const tag = field(value, 'tag');
  ensure(typeof tag === 'string' && mapping[tag], `unknown ${label} tag ${String(tag)}`);
  return mapping[tag];
}

function itfInteger(value, name) {
  const encoded = field(value, '#bigint');
  ensure(
    typeof encoded === 'string' && /^(?:0|[1-9]\d*)$/.test(encoded),
    `${name} must contain a canonical non-negative ITF bigint`,
  );
  const parsed = Number(encoded);
  ensure(Number.isSafeInteger(parsed), `${name} exceeds the JavaScript safe-integer domain`);
  return parsed;
}

function modelProjection(rawState) {
  const state = object(field(rawState, 's'), 'ITF scheduler state');
  const boolean = (name) => {
    const value = field(state, name);
    ensure(typeof value === 'boolean', `${name} must be boolean`);
    return value;
  };
  const integer = (name) => {
    return itfInteger(field(state, name), name);
  };
  return {
    phase: tagged(field(state, 'phase'), PHASE_BY_TAG, 'phase'),
    online: boolean('online'),
    timerPending: boolean('timer_pending'),
    cyclePending: boolean('cycle_pending'),
    networkActive: boolean('network_active'),
    wakePending: boolean('wake_pending'),
    consecutiveFailures: integer('consecutive_failures'),
    resetPhase: tagged(field(state, 'reset_phase'), RESET_BY_TAG, 'reset_phase'),
    pagesSeen: integer('pages_seen'),
  };
}

class ManualTimer {
  active = true;
  fired = false;

  constructor(callback) {
    this.callback = callback;
  }

  cancel() {
    this.active = false;
  }

  fire() {
    ensure(!this.fired, 'timer fired twice');
    this.fired = true;
    this.active = false;
    this.callback();
  }
}

class ManualTimers {
  handles = [];

  factory = (_delayMs, callback) => {
    const timer = new ManualTimer(callback);
    this.handles.push(timer);
    return timer;
  };

  get pending() {
    return this.handles.some((timer) => timer.active && !timer.fired);
  }

  fireCurrent() {
    const timer = this.handles.findLast((candidate) => candidate.active && !candidate.fired);
    ensure(timer, 'no current timer to fire');
    timer.fire();
  }

  fireStale() {
    const timer = this.handles.find((candidate) => !candidate.active && !candidate.fired);
    ensure(timer, 'no cancelled timer to fire');
    timer.fire();
  }
}

function mutation(id) {
  return {
    mutationId: id,
    operation: 'upsert',
    table: 'docs',
    recordId: `record-${id}`,
    payload: { id },
  };
}

class ReplayQueue {
  checkpoint = '0';
  pending = [];

  async protocolPushRequest(limit = 100) {
    return {
      protocolVersion: 1,
      clientId: 'formal-typescript',
      mutations: this.pending.slice(0, limit),
    };
  }

  async acknowledgePush(response) {
    const watermark = BigInt(response.lastMutationId);
    const before = this.pending.length;
    this.pending = this.pending.filter((entry) => BigInt(entry.mutationId) > watermark);
    return before - this.pending.length;
  }

  async pullCheckpoint() {
    return this.checkpoint;
  }

  async setPullCheckpoint(checkpoint) {
    this.checkpoint = checkpoint;
  }

  async installSnapshot(snapshot, replaceAuthoritative) {
    await replaceAuthoritative(snapshot.records);
    this.checkpoint = snapshot.checkpoint;
  }
}

class ControlledTransport {
  pendingPull = undefined;
  pendingSnapshot = undefined;
  autoSuccess = false;
  cyclePending = false;
  resetPhase = 'none';
  pagesSeen = 0;

  pull(checkpoint, _limit, signal) {
    this.cyclePending = true;
    if (this.autoSuccess) {
      return Promise.resolve({
        protocolVersion: 1,
        checkpoint,
        hasMore: false,
        changes: [],
      });
    }
    ensure(!this.pendingPull, 'production loop issued overlapping pulls');
    return new Promise((resolve, reject) => {
      this.pendingPull = { checkpoint, signal, resolve, reject };
    });
  }

  async push(request) {
    const lastMutationId = request.mutations.at(-1)?.mutationId;
    ensure(lastMutationId, 'push must contain a mutation');
    return {
      protocolVersion: 1,
      clientId: request.clientId,
      lastMutationId,
      checkpoint: this.pendingPull?.checkpoint ?? '0',
      results: request.mutations.map((entry) => ({
        mutationId: entry.mutationId,
        status: 'applied',
      })),
    };
  }

  snapshot(_signal, _reset) {
    ensure(!this.pendingSnapshot, 'production loop issued overlapping snapshots');
    this.resetPhase = 'requested';
    return new Promise((resolve, reject) => {
      this.pendingSnapshot = { resolve, reject };
    });
  }

  resolvePage(hasMore) {
    const pending = this.takePull();
    const next = String(BigInt(pending.checkpoint) + 1n);
    if (hasMore) this.pagesSeen += 1;
    pending.resolve({
      protocolVersion: 1,
      checkpoint: next,
      hasMore,
      changes: [],
    });
  }

  resolveReset() {
    const pending = this.takePull();
    pending.resolve({ protocolVersion: 1, error: 'RESET_REQUIRED' });
  }

  resolveSnapshot() {
    const pending = this.pendingSnapshot;
    ensure(pending, 'no snapshot to resolve');
    this.pendingSnapshot = undefined;
    this.resetPhase = 'installed';
    pending.resolve({
      protocolVersion: 1,
      checkpoint: '10',
      records: [{
        table: 'docs',
        recordId: 'snapshot',
        record: { snapshot: true },
        revision: '1',
      }],
    });
  }

  resolveMalformed() {
    if (this.pendingPull) {
      const pending = this.takePull();
      pending.resolve({
        protocolVersion: 1,
        checkpoint: pending.checkpoint,
        hasMore: 'false',
        changes: [],
      });
      return;
    }

    const pending = this.takeSnapshot();
    pending.resolve({
      protocolVersion: 1,
      checkpoint: '10',
      records: 'not-an-array',
    });
  }

  reject(error) {
    if (this.pendingPull) {
      this.takePull().reject(error);
      return;
    }
    this.takeSnapshot().reject(error);
  }

  takePull() {
    const pending = this.pendingPull;
    ensure(pending, 'no pull to settle');
    this.pendingPull = undefined;
    return pending;
  }

  takeSnapshot() {
    const pending = this.pendingSnapshot;
    ensure(pending, 'no request to settle');
    this.pendingSnapshot = undefined;
    return pending;
  }
}

async function eventually(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(message);
}

class ReplayHarness {
  online = true;
  wakePending = false;

  constructor() {
    this.timers = new ManualTimers();
    this.queue = new ReplayQueue();
    this.transport = new ControlledTransport();
    this.loop = new ProtocolSyncLoop(
      this.queue,
      this.transport,
      {
        async applyChanges() {},
        async replaceAuthoritative() {},
      },
      {
        pushLimit: 1,
        maxPushBatchesPerCycle: 1,
        retryBaseMs: 1,
        retryMaxMs: 8,
        random: () => 0,
        now: () => 0,
        isOnline: () => this.online,
        timerFactory: this.timers.factory,
        observeBrowserLifecycle: false,
      },
    );
  }

  projection() {
    const cyclePending = this.transport.cyclePending;
    const phase = this.loop.state.status;
    const ownsActiveCycle = phase === 'syncing';
    return {
      phase,
      online: this.online,
      timerPending: this.timers.pending,
      cyclePending,
      networkActive: phase === 'syncing' && this.online && cyclePending,
      wakePending: this.wakePending,
      consecutiveFailures: this.loop.state.consecutiveFailures,
      resetPhase: ownsActiveCycle ? this.transport.resetPhase : 'none',
      pagesSeen: ownsActiveCycle ? this.transport.pagesSeen : 0,
    };
  }

  async apply(action) {
    switch (action) {
      case 'idle':
        return;
      case 'start':
        this.loop.start();
        return;
      case 'stop':
        this.loop.stop();
        this.wakePending = false;
        return;
      case 'hint':
        if (this.transport.cyclePending) this.wakePending = true;
        this.loop.hint();
        return;
      case 'go_offline':
        this.online = false;
        this.loop.hint();
        this.wakePending = false;
        return;
      case 'go_online':
        this.online = true;
        if (this.transport.cyclePending) this.wakePending = true;
        this.loop.hint();
        return;
      case 'timer_fire':
        this.timers.fireCurrent();
        await eventually(() => Boolean(this.transport.pendingPull), 'timer did not start a production cycle');
        return;
      case 'timer_join':
        this.timers.fireCurrent();
        this.wakePending = true;
        await new Promise((resolve) => setImmediate(resolve));
        return;
      case 'stale_timer_fire':
        this.timers.fireStale();
        await new Promise((resolve) => setImmediate(resolve));
        return;
      case 'page_more':
        this.transport.resolvePage(true);
        await eventually(() => Boolean(this.transport.pendingPull), 'hasMore did not request the next page');
        return;
      case 'begin_reset':
        this.transport.resolveReset();
        await eventually(() => Boolean(this.transport.pendingSnapshot), 'reset did not request a snapshot');
        return;
      case 'finish_reset':
        this.transport.resolveSnapshot();
        await eventually(() => Boolean(this.transport.pendingPull), 'snapshot install did not resume pull');
        return;
      case 'cycle_success_more':
        this.queue.pending = [mutation('1'), mutation('2')];
        await this.settleSuccess();
        return;
      case 'cycle_success':
      case 'stale_cycle_success':
        await this.settleSuccess();
        return;
      case 'cycle_retryable_failure':
      case 'stale_cycle_failure':
        this.transport.reject(new SyncTransportError('retryable formal failure'));
        await this.settleCycle();
        return;
      case 'cycle_permanent_failure':
        this.transport.reject(new SyncTransportError('permanent formal failure', false));
        await this.settleCycle();
        return;
      case 'malformed_response':
        this.transport.resolveMalformed();
        await this.settleCycle();
        return;
      default:
        throw new Error(`model action ${action} has no production operation`);
    }
  }

  async settleSuccess() {
    this.transport.autoSuccess = true;
    if (this.transport.pendingSnapshot) {
      this.transport.resolveSnapshot();
    } else {
      this.transport.resolvePage(false);
    }
    await this.settleCycle();
    this.transport.autoSuccess = false;
  }

  async settleCycle() {
    await eventually(
      () => this.loop.state.status !== 'syncing',
      'production cycle did not settle',
    );
    await new Promise((resolve) => setImmediate(resolve));
    this.transport.cyclePending = false;
    this.transport.resetPhase = 'none';
    this.transport.pagesSeen = 0;
    this.wakePending = false;
  }
}

function recordScenario(action, previous, scenarios) {
  if (action === 'stop' && previous.cyclePending) scenarios.add('stop_during_cycle');
  if ((action === 'hint' || action === 'timer_join') && previous.cyclePending) scenarios.add('trailing_wake');
  if (action === 'go_offline' && previous.cyclePending) scenarios.add('offline_during_cycle');
  if (action === 'go_online') scenarios.add('online_recovery');
  if (action === 'cycle_retryable_failure') scenarios.add('retryable_failure');
  if (action === 'cycle_permanent_failure') scenarios.add('permanent_failure');
  if (action === 'finish_reset') scenarios.add('reset_ordering');
  if (action === 'malformed_response') scenarios.add('malformed_response');
  if (action === 'cycle_success_more') scenarios.add('paging_rerun');
  if (action === 'stale_cycle_success' || action === 'stale_cycle_failure') scenarios.add('stale_cycle');
  if (action === 'stale_timer_fire') scenarios.add('stale_timer');
}

async function replayTrace(path, coverage, scenarios) {
  const trace = object(JSON.parse(readFileSync(path, 'utf8')), 'ITF trace');
  const states = field(trace, 'states');
  ensure(Array.isArray(states) && states.length > 0, 'ITF trace must contain states');
  ensure(states.length <= 100_000, 'ITF trace exceeds scheduler replay limit');
  const harness = new ReplayHarness();

  for (let step = 0; step < states.length; step += 1) {
    const rawState = object(states[step], `ITF state ${step}`);
    const action = field(rawState, ACTION_FIELD);
    ensure(typeof action === 'string' && REQUIRED_ACTIONS.includes(action), `unknown model action ${String(action)}`);
    coverage.add(action);
    if (step === 0) {
      ensure(action === 'init', 'the first scheduler state must be init');
    } else {
      const previous = modelProjection(states[step - 1]);
      recordScenario(action, previous, scenarios);
      await harness.apply(action);
    }

    const expected = modelProjection(rawState);
    const actual = harness.projection();
    if (!isDeepStrictEqual(actual, expected)) {
      return {
        trace: path,
        step,
        action,
        message: 'production TypeScript scheduler does not refine Quint',
        expected,
        actual,
      };
    }
  }
  harness.loop.stop();
  return undefined;
}

function validateRequest(value) {
  const request = object(value, 'adapter request');
  ensure(request.protocol === 'fmctl.adapter.v1', 'unsupported adapter protocol');
  ensure(request.adapter === 'typescript', 'request selected a non-TypeScript adapter');
  ensure(request.project === 'opto-sync-clients', 'unexpected scheduler project');
  ensure(request.model === 'protocol-sync-scheduler-v1', 'unexpected scheduler model');
  ensure(typeof request.specification === 'string' && statSync(request.specification).isFile(), 'specification is not a file');
  ensure(Array.isArray(request.traces) && request.traces.length > 0, 'request must contain traces');
  ensure(request.traces.every((trace) => typeof trace === 'string' && statSync(trace).isFile()), 'every trace must be a file');
  return request;
}

async function replayPaths(paths) {
  const coverage = new Set();
  const scenarios = new Set();
  const mismatches = [];
  let passed = 0;
  for (const path of [...paths].sort()) {
    try {
      const mismatch = await replayTrace(path, coverage, scenarios);
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
  const missingScenarios = REQUIRED_SCENARIOS.filter((scenario) => !scenarios.has(scenario));
  if (missing.length > 0 || missingScenarios.length > 0) {
    mismatches.push({
      trace: paths[0],
      step: null,
      action: null,
      message: `scheduler corpus coverage missing actions [${missing.join(', ')}] scenarios [${missingScenarios.join(', ')}]`,
      expected: { actions: REQUIRED_ACTIONS, scenarios: REQUIRED_SCENARIOS },
      actual: { actions: [...coverage].sort(), scenarios: [...scenarios].sort() },
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
      name: '@opto-sync/client ProtocolSyncLoop',
      version,
    },
  };
}

const paths = process.argv.slice(2);
const result = paths.length > 0
  ? await replayPaths(paths)
  : await replayPaths(validateRequest(JSON.parse(readFileSync(0, 'utf8'))).traces);
process.stdout.write(`${JSON.stringify(result, null, paths.length > 0 ? 2 : 0)}\n`);
