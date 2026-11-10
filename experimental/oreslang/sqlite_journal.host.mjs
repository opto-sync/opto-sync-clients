// EXPERIMENTAL Node 24 host adapter. This is real SQLite, NOT compiled AttoLang.
// The supervisor exclusively owns this module and its database file permissions.
// An injected exchange callback is trusted infrastructure, never actor/user code.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, existsSync, lstatSync, chmodSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';

const MAX_I64 = (1n << 63n) - 1n;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const stage_receipts = new WeakMap();
const ack_receipts = new WeakMap();
const retire_receipts = new WeakMap();
const private_receipt = (registry, metadata) => {
  const receipt = Object.freeze(Object.create(null));
  registry.set(receipt, metadata);
  return receipt;
};
const require_value = (ok, message) => { if (!ok) throw new Error(message); };
const id_text = (value, field) => {
  require_value(typeof value === 'string' && value.length > 0 && value.length <= 128,
    field + ' must be 1..128 characters');
  return value;
};
const decimal = (value, field) => {
  require_value(typeof value === 'string' && DECIMAL.test(value), field + ' must be canonical decimal text');
  const parsed = BigInt(value);
  require_value(parsed <= MAX_I64, field + ' exceeds signed i64 maximum');
  return parsed;
};
const encoded_json = (value) => {
  require_value(value !== null && typeof value === 'object' && !Array.isArray(value),
    'payload must be an object');
  const text = JSON.stringify(value);
  require_value(typeof text === 'string' && text.length > 1 && text.length <= 1048576,
    'payload must be JSON <=1 MiB');
  const copy = JSON.parse(text);
  require_value(isDeepStrictEqual(value, copy), 'payload must be losslessly JSON serializable');
  return text;
};
const deep_copy = value => JSON.parse(JSON.stringify(value));

function checked_row(row, tenant, client_id) {
  require_value(row && row.schema_version === 1, 'unsupported SQLite journal schema');
  require_value(row.tenant === tenant, 'journal tenant mismatch');
  require_value(row.client_id === client_id, 'journal client mismatch');
  require_value(decimal(row.generation, 'generation') > 0n, 'invalid generation');
  const ack = decimal(row.last_ack, 'lastAck');
  decimal(row.checkpoint, 'checkpoint');
  const names = ['pending_json','started_ms','deadline_ms'];
  if (row.pending_json === null) {
    require_value(names.every(name => row[name] === null), 'empty journal has dangling retry metadata');
  } else {
    require_value(names.every(name => typeof row[name] === 'string'), 'pending journal missing retry metadata');
    const pending = JSON.parse(row.pending_json);
    require_value(pending && typeof pending === 'object' && !Array.isArray(pending) &&
      Object.keys(pending).sort().join(',') === 'baseRevision,mutationId,payload,recordId',
      'invalid pending mutation shape');
    require_value(ack < MAX_I64 && decimal(pending.mutationId, 'mutationId') === ack + 1n,
      'pending ID must be exactly lastAck + 1 without overflow');
    id_text(pending.recordId, 'recordId');
    decimal(pending.baseRevision, 'baseRevision');
    encoded_json(pending.payload);
    const started = decimal(row.started_ms, 'startedMs');
    const deadline = decimal(row.deadline_ms, 'deadlineMs');
    require_value(deadline > started, 'invalid persisted retry deadline');
  }
  return row;
}

export function open_sqlite_sync_journal(path, {tenant, client_id, exchange} = {}) {
  id_text(tenant, 'tenant');
  id_text(client_id, 'client_id');
  require_value(typeof path === 'string' && path.length > 0, 'journal path required');
  require_value(exchange === undefined || typeof exchange === 'function',
    'trusted transport exchange must be a function');
  const filename = resolve(path);
  mkdirSync(dirname(filename), {recursive:true, mode:0o700});
  if (existsSync(filename)) {
    const stat = lstatSync(filename);
    require_value(stat.isFile() && !stat.isSymbolicLink(), 'journal path must be a regular file');
  }
  const db = new DatabaseSync(filename, {timeout:1500});
  let closed = false;
  let busy = false;
  let generation;
  const ensure_open = () => require_value(!closed, 'journal session closed');
  const row = () => checked_row(db.prepare('SELECT * FROM journal WHERE singleton=1').get(), tenant, client_id);
  const transaction = fn => {
    ensure_open();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {db.exec('ROLLBACK');} catch {}
      throw error;
    }
  };
  const current = () => {
    ensure_open();
    const state = row();
    require_value(state.generation === generation, 'fenced: stale journal generation');
    return state;
  };
  const assert_idle = () => require_value(!busy, 'reentrant journal use forbidden');
  const pending_of = state => state.pending_json === null ? null : JSON.parse(state.pending_json);
  const mint_stage = state => private_receipt(stage_receipts, {
    session, generation, mutation_id:pending_of(state).mutationId
  });
  let session = Object.freeze({}); // fresh, unforgeable per-open session identity

  try {
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=FULL');
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('PRAGMA trusted_schema=OFF');
    require_value(db.prepare('PRAGMA journal_mode').get().journal_mode === 'wal',
      'SQLite WAL durability mode unavailable');
    require_value(db.prepare('PRAGMA synchronous').get().synchronous === 2,
      'SQLite FULL synchronous durability unavailable');
    db.exec(`CREATE TABLE IF NOT EXISTS journal (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      schema_version INTEGER NOT NULL,
      tenant TEXT NOT NULL, client_id TEXT NOT NULL,
      generation TEXT NOT NULL, last_ack TEXT NOT NULL,
      checkpoint TEXT NOT NULL, pending_json TEXT,
      started_ms TEXT, deadline_ms TEXT
    ) STRICT`);
    generation = transaction(() => {
      const found = db.prepare('SELECT * FROM journal WHERE singleton=1').get();
      if (!found) {
        db.prepare(`INSERT INTO journal VALUES
          (1, 1, ?, ?, '1', '0', '0', NULL, NULL, NULL)`).run(tenant, client_id);
        return '1';
      }
      checked_row(found, tenant, client_id);
      const previous = decimal(found.generation, 'generation');
      require_value(previous < MAX_I64, 'generation exhausted');
      const next = (previous + 1n).toString();
      db.prepare('UPDATE journal SET generation=? WHERE singleton=1 AND generation=?')
        .run(next, found.generation);
      return next;
    });
    chmodSync(filename, 0o600);
  } catch (error) {
    db.close();
    throw error;
  }

  function stage_mutation({record_id, base_revision='0', payload, started_ms, deadline_ms}) {
    assert_idle();
    id_text(record_id, 'recordId');
    decimal(base_revision, 'baseRevision');
    const payload_json = encoded_json(payload);
    const started = decimal(started_ms, 'startedMs');
    const deadline = decimal(deadline_ms, 'deadlineMs');
    require_value(deadline > started, 'retry deadline must exceed original start');
    const staged = transaction(() => {
      const state = current();
      require_value(state.pending_json === null, 'previous mutation must retire first');
      const last = decimal(state.last_ack, 'lastAck');
      require_value(last < MAX_I64, 'mutation ID exhausted');
      const mutation_id = (last + 1n).toString();
      const pending = JSON.stringify({
        mutationId:mutation_id, recordId:record_id,
        baseRevision:base_revision, payload:JSON.parse(payload_json)
      });
      db.prepare(`UPDATE journal SET pending_json=?, started_ms=?, deadline_ms=?
        WHERE singleton=1 AND generation=? AND pending_json IS NULL`)
        .run(pending,started_ms,deadline_ms,generation);
      return mutation_id;
    });
    return private_receipt(stage_receipts,{session,generation,mutation_id:staged});
  }

  function recovered_stage_receipt() {
    assert_idle();
    const state = current();
    require_value(state.pending_json !== null, 'no durable mutation pending');
    return mint_stage(state);
  }

  function snapshot() {
    assert_idle();
    const state = current();
    return deep_copy({
      schemaVersion:1, tenant, clientId:client_id, generation,
      lastAck:state.last_ack, checkpoint:state.checkpoint,
      pending:pending_of(state),
      startedMs:state.started_ms, deadlineMs:state.deadline_ms
    });
  }

  function exact_envelope(state) {
    const mutation = pending_of(state);
    require_value(mutation !== null, 'no durable mutation pending');
    return deep_copy({protocolVersion:1, clientId:client_id, mutations:[{
      mutationId:mutation.mutationId, operation:'upsert', table:'docs',
      recordId:mutation.recordId, baseRevision:mutation.baseRevision,
      payload:mutation.payload
    }]});
  }

  function verified_response(reply, envelope, previous_checkpoint) {
    require_value(reply && reply.status === 200, 'server did not acknowledge mutation');
    const data = reply.json;
    require_value(data && data.protocolVersion === 1 &&
      data.clientId === client_id && data.lastMutationId === envelope.mutations[0].mutationId,
      'server response identity/ledger mismatch');
    require_value(Array.isArray(data.results) && data.results.length === 1,
      'missing or extra server ACK outcomes');
    const result = data.results[0];
    require_value(result && result.mutationId === envelope.mutations[0].mutationId,
      'server ACK mutation identity mismatch');
    require_value(['applied','rejected','duplicate'].includes(result.status),
      'unrecognized server ACK outcome');
    if (result.status === 'duplicate') {
      require_value(['applied','rejected'].includes(result.originalStatus),
        'duplicate ACK lacks original outcome');
    }
    require_value(decimal(data.checkpoint,'checkpoint') >= decimal(previous_checkpoint,'checkpoint'),
      'server checkpoint regressed');
    return {status:result.status,checkpoint:data.checkpoint,mutation_id:result.mutationId};
  }

  async function dispatch(stage_receipt, now_ms) {
    assert_idle();
    const stage = stage_receipts.get(stage_receipt);
    require_value(stage && stage.session === session && stage.generation === generation,
      'not a trusted stage receipt for this session');
    decimal(now_ms, 'nowMs');
    require_value(typeof exchange === 'function', 'no trusted transport exchange configured');
    busy = true;
    try {
      const state = current();
      const pending = pending_of(state);
      require_value(pending !== null && pending.mutationId === stage.mutation_id,
        'stage receipt is not the current durable mutation');
      require_value(decimal(now_ms,'nowMs') >= decimal(state.started_ms,'startedMs') &&
        decimal(now_ms,'nowMs') < decimal(state.deadline_ms,'deadlineMs'),
        'original retry budget expired');
      const envelope = exact_envelope(state);
      let reply;
      try {
        // This is a trust boundary: only a privileged transport adapter may be
        // injected. HTTP/TLS authentication and remote generation fencing are
        // NOT implemented here; synthetic exchange callbacks are HOST-ONLY.
        reply = await exchange(envelope, Object.freeze({tenant,client_id,generation}));
      } catch {
        return {kind:'unknown',mutationId:pending.mutationId};
      }
      current(); // a restarted supervisor must fence any old in-flight response
      if (reply?.status !== 200) {
        return {kind:'not_acknowledged',status:reply?.status ?? null};
      }
      const info = verified_response(reply,envelope,state.checkpoint);
      const ack_receipt = private_receipt(ack_receipts,{
        session,generation,mutation_id:info.mutation_id,checkpoint:info.checkpoint,
        status:info.status
      });
      return {kind:'verified_response',status:info.status,ack_receipt};
    } finally {
      busy = false;
    }
  }

  function retire_verified(ack_receipt) {
    assert_idle();
    const meta = ack_receipts.get(ack_receipt);
    require_value(meta && meta.session === session && meta.generation === generation,
      'not a trusted verified ACK receipt for this session');
    const outcome = transaction(() => {
      const state = current();
      const pending = pending_of(state);
      require_value(pending && pending.mutationId === meta.mutation_id &&
        decimal(meta.checkpoint,'checkpoint') >= decimal(state.checkpoint,'checkpoint'),
        'verified ACK no longer matches durable journal');
      db.prepare(`UPDATE journal SET last_ack=?, checkpoint=?, pending_json=NULL,
        started_ms=NULL, deadline_ms=NULL
        WHERE singleton=1 AND generation=? AND pending_json=?`)
        .run(meta.mutation_id,meta.checkpoint,generation,state.pending_json);
      return {lastAck:meta.mutation_id,checkpoint:meta.checkpoint};
    });
    ack_receipts.delete(ack_receipt);
    const retirement_receipt = private_receipt(retire_receipts,{
      session,generation,last_ack:outcome.lastAck
    });
    return Object.freeze({kind:'durably_retired',...outcome,retirement_receipt});
  }

  function close() {
    if (closed) return;
    require_value(!busy, 'cannot close journal during dispatch');
    db.close();
    closed = true;
  }
  return Object.freeze({stage_mutation,recovered_stage_receipt,snapshot,dispatch,retire_verified,close});
}
