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

import 'fake-indexeddb/auto';

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { OptoSyncClient, SYNC_STATUS } = require('../dist/client.js');

const MUTATION_SEQUENCE_KEY = 'mutation.seq';
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

function pickedId(state) {
  const pick = field(state.nondetPicks ?? {}, 'id');
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
    response: null,
    responseValid: false,
    replacingSnapshot: false,
  };
}

async function destroyAdapter(adapter) {
  if (!adapter) return;
  try {
    adapter.client.db.close();
    await adapter.client.db.delete();
  } catch (error) {
    process.stderr.write(`warning: failed to delete formal replay database: ${error}\n`);
  }
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
  return JSON.stringify({ mutations, metadata });
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
        (await databaseSnapshot(adapter.client)) === before,
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

    case 'crash_during_reset':
      ensure(
        adapter.replacingSnapshot,
        'crash_during_reset without an active replacement',
      );
      adapter.replacingSnapshot = false;
      break;

    case 'finish_reset': {
      ensure(adapter.replacingSnapshot, 'finish_reset without an active replacement');
      await adapter.client.installSnapshot(
        {
          protocolVersion: 1,
          checkpoint: stateBigInt(state, 'server_checkpoint').toString(),
          records: [],
        },
        async () => {},
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

  let adapter = null;
  try {
    for (let index = 0; index < trace.states.length; index += 1) {
      const state = trace.states[index];
      ensure(
        state !== null && typeof state === 'object' && typeof state.action === 'string',
        `${tracePath}: invalid state ${index}`,
      );
      const context = `${tracePath} state ${index} action ${state.action}`;
      try {
        adapter = await applyAction(adapter, state, tracePath);
        await assertProjection(adapter, state, context);
      } catch (error) {
        throw invalid(`${context}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return trace.states.length;
  } finally {
    await destroyAdapter(adapter);
  }
}

async function main() {
  const paths = process.argv.slice(2).sort();
  ensure(
    paths.length > 0,
    'usage: node formal/quint-itf-replay.mjs <trace.itf.json>...',
  );

  let states = 0;
  for (const tracePath of paths) {
    const count = await replay(tracePath);
    states += count;
    process.stdout.write(`replayed ${count} model states from ${tracePath}\n`);
  }
  process.stdout.write(
    `TypeScript OptoSyncClient conformed to ${states} states across ${paths.length} Quint ITF traces\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
