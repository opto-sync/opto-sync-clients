#!/usr/bin/env node

/**
 * Replay Quint Informal Trace Format (ITF) model-based traces against the
 * production TypeScript OptoSyncClient and its Dexie/IndexedDB queue.
 *
 * The model owns server-side ledger/commit facts. This adapter synthesizes only
 * those responses, while mutation allocation, durable queue insertion, immutable
 * request construction, acknowledgement rejection/application, checkpointing,
 * and snapshot installation execute through the compiled client package.
 */

import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

const requireFromClient = createRequire(
  new URL('../clients/ts/package.json', import.meta.url),
);
requireFromClient('fake-indexeddb/auto');
const { OptoSyncClient, SYNC_STATUS } = requireFromClient('.');
const { version: clientVersion } = requireFromClient('./package.json');

const MUTATION_SEQUENCE_KEY = 'mutation.seq';
const ACTION_FIELD = 'mbt::actionTaken';
const NONDET_PICKS_FIELD = 'mbt::nondetPicks';
const REQUIRED_ACTIONS = Object.freeze([
  'init',
  'idle',
  'compact',
  'enqueue',
  'send',
  'apply_new',
  'reject_new',
  'reply_duplicate',
  'inject_mismatched_response',
  'lose_committed_response',
  'lose_uncommitted_request',
  'discard_malformed_response',
  'acknowledge',
  'pull',
  'begin_reset',
  'crash_during_reset',
  'finish_reset',
]);
let databaseSequence = 0;

function invalid(message) {
  const error = new Error(message);
  error.name = 'FormalReplayError';
  return error;
}

function ensure(condition, message) {
  if (!condition) throw invalid(message);
}

function field(value, name) {
  ensure(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `expected object while reading ITF field \`${name}\``,
  );
  ensure(
    Object.prototype.hasOwnProperty.call(value, name),
    `missing ITF field \`${name}\``,
  );
  return value[name];
}

function taggedBigInt(value) {
  const encoded = field(value, '#bigint');
  ensure(typeof encoded === 'string', 'ITF #bigint must contain a decimal string');
  ensure(/^(?:0|[1-9]\d*)$/.test(encoded), `invalid ITF #bigint \`${encoded}\``);
  return BigInt(encoded);
}

function stateBigInt(state, name) {
  return taggedBigInt(field(state.s, name));
}

function stateBool(state, name) {
  const value = field(state.s, name);
  ensure(typeof value === 'boolean', `ITF state field \`${name}\` must be boolean`);
  return value;
}

function stateSet(state, name) {
  const entries = field(field(state.s, name), '#set');
  ensure(Array.isArray(entries), `ITF state field \`${name}\` must be a set`);
  return new Set(entries.map((entry) => taggedBigInt(entry).toString()));
}

function stateTag(state, name) {
  const tag = field(field(state.s, name), 'tag');
  ensure(typeof tag === 'string', `ITF state field \`${name}\` must be tagged`);
  return tag;
}

function decodeState(rawState) {
  ensure(
    rawState !== null &&
      typeof rawState === 'object' &&
      !Array.isArray(rawState),
    'ITF state must be an object',
  );
  const action = field(rawState, ACTION_FIELD);
  ensure(typeof action === 'string' && action.length > 0, 'ITF action must be a string');
  return {
    ...rawState,
    action,
    nondetPicks: field(rawState, NONDET_PICKS_FIELD),
  };
}

function pickedId(state) {
  const pick = field(state.nondetPicks, 'id');
  ensure(
    field(pick, 'tag') === 'Some',
    `action \`${state.action}\` requires a nondeterministic id`,
  );
  return taggedBigInt(field(pick, 'value'));
}

function requestMutationId(request) {
  ensure(request !== null, 'no in-flight request');
  ensure(
    Array.isArray(request.mutations) && request.mutations.length === 1,
    'formal adapter sends exactly one mutation per request',
  );
  const id = request.mutations[0]?.mutationId;
  ensure(typeof id === 'string' && /^[1-9]\d*$/.test(id), 'invalid request mutation id');
  return BigInt(id);
}

function sortedSet(set) {
  return [...set].sort((left, right) => {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function ensureSetsEqual(actual, expected, context, name) {
  const left = sortedSet(actual);
  const right = sortedSet(expected);
  ensure(
    JSON.stringify(left) === JSON.stringify(right),
    `${context}: ${name} ${JSON.stringify(left)} != model ${JSON.stringify(right)}`,
  );
}

function allocatedIds(nextId) {
  const result = new Set();
  for (let id = 1n; id < nextId; id += 1n) result.add(id.toString());
  return result;
}

async function createAdapter(tracePath) {
  databaseSequence += 1;
  const safeName = path.basename(tracePath).replace(/[^A-Za-z0-9_.-]/g, '-');
  const databaseName = `OptoSyncFormal-${process.pid}-${databaseSequence}-${safeName}`;
  const client = new OptoSyncClient({
    databaseName,
    stampUpdatedAt: false,
  });
  await client.db.open();
  return {
    client,
    request: null,
    sentRequests: new Map(),
    response: null,
    responseValid: false,
    replacingSnapshot: false,
  };
}

async function destroyAdapter(adapter) {
  if (!adapter) return;
  adapter.client.db.close();
  await adapter.client.db.delete();
}

async function responseFromState(adapter, state, status, originalStatus) {
  const mutationId = stateBigInt(state, 'response_mutation_id').toString();
  const checkpoint = stateBigInt(state, 'response_checkpoint').toString();
  const hasAppliedEffect = status === 'applied' || originalStatus === 'applied';
  const clientId = adapter.request?.clientId ?? (await adapter.client.clientId());
  const result = {
    mutationId,
    status,
    checkpoint,
  };
  if (originalStatus !== undefined) result.originalStatus = originalStatus;
  if (hasAppliedEffect) result.revision = mutationId;

  return {
    protocolVersion: 1,
    clientId,
    lastMutationId: stateBigInt(state, 'response_watermark').toString(),
    checkpoint,
    results: [result],
  };
}

async function databaseSnapshot(client) {
  const [mutations, metadata] = await Promise.all([
    client.db.localMutations.orderBy('id').toArray(),
    client.db.meta.orderBy('key').toArray(),
  ]);
  return { mutations, metadata };
}

async function applyAction(adapter, state, tracePath) {
  if (state.action === 'init') {
    await destroyAdapter(adapter);
    return createAdapter(tracePath);
  }

  ensure(adapter !== null, `action \`${state.action}\` occurred before init`);

  switch (state.action) {
    case 'idle':
    case 'compact':
      break;

    case 'enqueue': {
      const expectedId = stateBigInt(state, 'next_id') - 1n;
      ensure(expectedId > 0n, 'enqueue produced an invalid next_id');
      const rowId = await adapter.client.queueMutation(
        'docs',
        `record-${expectedId}`,
        { id: `record-${expectedId}`, value: expectedId.toString() },
      );
      const row = await adapter.client.db.localMutations.get(rowId);
      ensure(row !== undefined, `queueMutation returned missing row ${rowId}`);
      ensure(
        row.mutationId === expectedId.toString(),
        `enqueue allocated ${row.mutationId ?? '<missing>'}, model allocated ${expectedId}`,
      );
      break;
    }

    case 'send': {
      ensure(adapter.request === null, 'request already in flight');
      ensure(adapter.response === null, 'response already present');
      const expectedId = pickedId(state);
      const request = await adapter.client.protocolPushRequest(1);
      ensure(
        requestMutationId(request) === expectedId,
        `sent mutation does not match model id ${expectedId}`,
      );
      const requestKey = expectedId.toString();
      const previous = adapter.sentRequests.get(requestKey);
      if (previous === undefined) {
        adapter.sentRequests.set(requestKey, structuredClone(request));
      } else {
        ensure(
          isDeepStrictEqual(request, previous),
          `retry for mutation ${expectedId} changed its immutable request`,
        );
      }
      adapter.request = request;
      break;
    }

    case 'apply_new':
    case 'reject_new': {
      ensure(adapter.response === null, 'response already present');
      ensure(
        requestMutationId(adapter.request) === pickedId(state),
        `${state.action} id does not match the in-flight request`,
      );
      adapter.response = await responseFromState(
        adapter,
        state,
        state.action === 'apply_new' ? 'applied' : 'rejected',
        undefined,
      );
      adapter.responseValid = true;
      break;
    }

    case 'reply_duplicate': {
      ensure(adapter.response === null, 'response already present');
      const id = pickedId(state);
      ensure(
        requestMutationId(adapter.request) === id,
        'duplicate reply id does not match the in-flight request',
      );
      const idString = id.toString();
      let originalStatus;
      if (stateSet(state, 'applied').has(idString)) originalStatus = 'applied';
      else if (stateSet(state, 'rejected').has(idString)) originalStatus = 'rejected';
      else throw invalid('duplicate reply has no durable original outcome');
      adapter.response = await responseFromState(
        adapter,
        state,
        'duplicate',
        originalStatus,
      );
      adapter.responseValid = true;
      break;
    }

    case 'inject_mismatched_response': {
      ensure(adapter.response === null, 'response already present');
      ensure(adapter.request !== null, 'mismatched response without an in-flight request');
      const response = await responseFromState(adapter, state, 'applied', undefined);
      const before = await databaseSnapshot(adapter.client);
      let rejected = false;
      try {
        await adapter.client.acknowledgePush(response, adapter.request);
      } catch (error) {
        rejected = true;
        ensure(
          error instanceof Error &&
            error.message === 'push acknowledgement does not match the sent batch',
          `malformed response returned unexpected error: ${error}`,
        );
      }
      ensure(rejected, 'the model-injected response must be rejected');
      ensure(
        isDeepStrictEqual(await databaseSnapshot(adapter.client), before),
        'rejecting a malformed response mutated IndexedDB state',
      );
      adapter.response = response;
      adapter.responseValid = false;
      break;
    }

    case 'lose_committed_response':
    case 'lose_uncommitted_request':
      adapter.request = null;
      adapter.response = null;
      adapter.responseValid = false;
      break;

    case 'discard_malformed_response':
      ensure(
        adapter.response !== null && !adapter.responseValid,
        'discard_malformed_response requires a rejected response',
      );
      adapter.request = null;
      adapter.response = null;
      adapter.responseValid = false;
      break;

    case 'acknowledge': {
      ensure(adapter.responseValid, 'cannot acknowledge an invalid response');
      ensure(adapter.response !== null, 'acknowledge without a response');
      ensure(adapter.request !== null, 'acknowledge without an in-flight request');
      ensure(
        requestMutationId(adapter.request) === pickedId(state),
        'acknowledgement id does not match the in-flight request',
      );
      const changed = await adapter.client.acknowledgePush(
        adapter.response,
        adapter.request,
      );
      ensure(changed === 1, `acknowledgement changed ${changed} rows`);
      adapter.request = null;
      adapter.response = null;
      adapter.responseValid = false;
      break;
    }

    case 'pull':
      await adapter.client.setPullCheckpoint(
        stateBigInt(state, 'local_checkpoint').toString(),
      );
      break;

    case 'begin_reset':
      ensure(!adapter.replacingSnapshot, 'snapshot replacement already active');
      adapter.replacingSnapshot = true;
      break;

    case 'crash_during_reset': {
      ensure(
        adapter.replacingSnapshot,
        'crash_during_reset without an active replacement',
      );
      const snapshot = {
        protocolVersion: 1,
        checkpoint: stateBigInt(state, 'server_checkpoint').toString(),
        records: [],
      };
      const before = await databaseSnapshot(adapter.client);
      let replacementCalled = false;
      let replacementError;
      try {
        await adapter.client.installSnapshot(snapshot, async (records) => {
          replacementCalled = true;
          ensure(records.length === 0, 'model snapshot must contain no records');
          throw new Error('simulated snapshot replacement crash');
        });
      } catch (error) {
        replacementError = error;
      }
      ensure(replacementCalled, 'failed snapshot installation skipped replacement');
      ensure(
        replacementError instanceof Error &&
          replacementError.message === 'simulated snapshot replacement crash',
        `snapshot replacement returned unexpected error: ${replacementError}`,
      );
      ensure(
        isDeepStrictEqual(await databaseSnapshot(adapter.client), before),
        'failed snapshot replacement mutated IndexedDB queue or metadata',
      );
      adapter.replacingSnapshot = false;
      break;
    }

    case 'finish_reset': {
      ensure(adapter.replacingSnapshot, 'finish_reset without an active replacement');
      let replacementCalled = false;
      await adapter.client.installSnapshot(
        {
          protocolVersion: 1,
          checkpoint: stateBigInt(state, 'server_checkpoint').toString(),
          records: [],
        },
        async (records) => {
          replacementCalled = true;
          ensure(records.length === 0, 'model snapshot must contain no records');
        },
      );
      ensure(
        replacementCalled,
        'successful snapshot installation skipped authoritative replacement',
      );
      adapter.replacingSnapshot = false;
      break;
    }

    default:
      throw invalid(`unsupported model action \`${state.action}\``);
  }

  return adapter;
}

async function assertProjection(adapter, state, context) {
  ensure(adapter !== null, `${context}: no adapter after action`);

  const sequence = (await adapter.client.db.meta.get(MUTATION_SEQUENCE_KEY))?.value ?? '0';
  ensure(/^(?:0|[1-9]\d*)$/.test(sequence), `${context}: invalid durable mutation sequence`);
  const actualNextId = BigInt(sequence) + 1n;
  const expectedNextId = stateBigInt(state, 'next_id');
  ensure(
    actualNextId === expectedNextId,
    `${context}: next id ${actualNextId} != model ${expectedNextId}`,
  );

  const expectedCheckpoint = stateBigInt(state, 'local_checkpoint').toString();
  const actualCheckpoint = await adapter.client.pullCheckpoint();
  ensure(
    actualCheckpoint === expectedCheckpoint,
    `${context}: checkpoint ${actualCheckpoint} != model ${expectedCheckpoint}`,
  );

  const [pendingRows, allRows] = await Promise.all([
    adapter.client.pendingMutations(),
    adapter.client.db.localMutations.orderBy('id').toArray(),
  ]);
  const actualPending = new Set(
    pendingRows.map((row) => {
      ensure(row.mutationId !== undefined, `${context}: pending row lacks mutation id`);
      return BigInt(row.mutationId).toString();
    }),
  );
  const actualConfirmed = new Set(
    allRows
      .filter((row) => row.syncStatus === SYNC_STATUS.SYNCED)
      .map((row) => {
        ensure(row.mutationId !== undefined, `${context}: confirmed row lacks mutation id`);
        return BigInt(row.mutationId).toString();
      }),
  );
  const actualAll = new Set(
    allRows.map((row) => {
      ensure(row.mutationId !== undefined, `${context}: allocated row lacks mutation id`);
      return BigInt(row.mutationId).toString();
    }),
  );

  ensureSetsEqual(actualPending, stateSet(state, 'pending'), context, 'pending');
  ensureSetsEqual(
    actualConfirmed,
    stateSet(state, 'acknowledged'),
    context,
    'confirmed',
  );
  ensureSetsEqual(actualAll, allocatedIds(expectedNextId), context, 'allocated ids');

  const inFlight = stateBigInt(state, 'in_flight');
  if (adapter.request === null) {
    ensure(inFlight === 0n, `${context}: model has in-flight id ${inFlight}, adapter has none`);
  } else {
    ensure(inFlight > 0n, `${context}: adapter has a request, model has no in-flight id`);
    ensure(
      requestMutationId(adapter.request) === inFlight,
      `${context}: in-flight request does not contain model id ${inFlight}`,
    );
  }

  const responsePresent = stateBool(state, 'response_present');
  ensure(
    (adapter.response !== null) === responsePresent,
    `${context}: response presence differs from model`,
  );
  if (adapter.response !== null) {
    const result = adapter.response.results[0];
    ensure(result !== undefined, `${context}: adapter response has no mutation result`);
    ensure(
      adapter.response.lastMutationId ===
        stateBigInt(state, 'response_watermark').toString(),
      `${context}: response watermark differs from model`,
    );
    ensure(
      adapter.response.checkpoint ===
        stateBigInt(state, 'response_checkpoint').toString(),
      `${context}: response checkpoint differs from model`,
    );
    ensure(
      result.mutationId === stateBigInt(state, 'response_mutation_id').toString(),
      `${context}: response mutation id differs from model`,
    );
    ensure(
      adapter.responseValid === stateBool(state, 'response_valid_for_in_flight'),
      `${context}: response validity differs from model`,
    );
  } else {
    ensure(!adapter.responseValid, `${context}: absent response cannot be marked valid`);
  }

  const replacing = stateTag(state, 'reset_phase') === 'Replacing';
  ensure(
    adapter.replacingSnapshot === replacing,
    `${context}: reset phase differs from model`,
  );
}

async function replay(tracePath) {
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  ensure(Array.isArray(trace.states), `${tracePath}: ITF trace has no states array`);
  ensure(trace.states.length > 0, `${tracePath}: ITF trace has no states`);
  ensure(
    decodeState(trace.states[0]).action === 'init',
    `${tracePath}: ITF trace must begin with the model init action`,
  );

  let adapter = null;
  const actions = new Set();
  try {
    for (let index = 0; index < trace.states.length; index += 1) {
      const state = decodeState(trace.states[index]);
      ensure(
        index === 0 || state.action !== 'init',
        `${tracePath}: unexpected init action at state ${index}`,
      );
      actions.add(state.action);
      const context = `${tracePath} state ${index} action ${state.action}`;
      try {
        adapter = await applyAction(adapter, state, tracePath);
        await assertProjection(adapter, state, context);
      } catch (error) {
        throw invalid(`${context}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { states: trace.states.length, actions };
  } finally {
    await destroyAdapter(adapter);
  }
}

async function replayPaths(paths, protocolMode) {
  ensure(
    paths.length > 0,
    'usage: node formal/quint-itf-replay.mjs <trace.itf.json>...',
  );

  let states = 0;
  let passed = 0;
  const actions = new Set();
  const mismatches = [];
  for (const tracePath of paths) {
    try {
      const summary = await replay(tracePath);
      states += summary.states;
      passed += 1;
      for (const action of summary.actions) actions.add(action);
      const diagnostic = `replayed ${summary.states} model states from ${tracePath}\n`;
      if (protocolMode) process.stderr.write(diagnostic);
      else process.stdout.write(diagnostic);
    } catch (error) {
      if (!protocolMode) throw error;
      mismatches.push({
        trace: tracePath,
        step: null,
        action: null,
        message: error instanceof Error ? error.message : String(error),
        expected: null,
        actual: null,
      });
    }
  }
  const missing = REQUIRED_ACTIONS.filter((action) => !actions.has(action));
  if (missing.length > 0) {
    const message =
      `trace suite left production adapter branches untested: ${missing.join(', ')}`;
    if (!protocolMode) throw invalid(message);
    passed = Math.max(0, passed - 1);
    mismatches.push({
      trace: paths[0],
      step: null,
      action: missing[0],
      message,
      expected: REQUIRED_ACTIONS,
      actual: [...actions].sort(),
    });
  }
  if (!protocolMode) {
    process.stdout.write(
      `TypeScript OptoSyncClient conformed to ${states} states across ${paths.length} ` +
        `Quint ITF traces covering all ${REQUIRED_ACTIONS.length} model actions\n`,
    );
  }
  return {
    protocol: 'fmctl.adapter.v1',
    success: mismatches.length === 0 && passed === paths.length,
    traces_total: paths.length,
    traces_passed: passed,
    mismatches,
    implementation: {
      language: 'typescript',
      name: '@opto-sync/client OptoSyncClient',
      version: clientVersion,
    },
  };
}

function validateProtocolRequest(request) {
  ensure(
    request !== null && typeof request === 'object' && !Array.isArray(request),
    'adapter request must be an object',
  );
  const expectedKeys = [
    'adapter',
    'model',
    'project',
    'protocol',
    'specification',
    'traces',
  ];
  ensure(
    isDeepStrictEqual(Object.keys(request).sort(), expectedKeys),
    'adapter request contains missing or unknown fields',
  );
  ensure(request.protocol === 'fmctl.adapter.v1', 'unsupported adapter protocol');
  ensure(request.adapter === 'typescript', 'request selected a non-TypeScript adapter');
  ensure(typeof request.project === 'string' && request.project.length > 0, 'empty project');
  ensure(typeof request.model === 'string' && request.model.length > 0, 'empty model');
  ensure(
    typeof request.specification === 'string' && request.specification.length > 0,
    'invalid specification path',
  );
  ensure(
    Array.isArray(request.traces) &&
      request.traces.length > 0 &&
      request.traces.every((trace) => typeof trace === 'string' && trace.length > 0),
    'request must contain nonempty trace paths',
  );
}

async function runProtocol() {
  const input = readFileSync(0, 'utf8');
  const request = JSON.parse(input);
  validateProtocolRequest(request);
  ensure((await stat(request.specification)).isFile(), 'specification is not a file');
  const response = await replayPaths(request.traces, true);
  process.stdout.write(JSON.stringify(response));
}

async function main() {
  const paths = process.argv.slice(2).sort();
  if (paths.length === 0) {
    await runProtocol();
  } else {
    await replayPaths(paths, false);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
