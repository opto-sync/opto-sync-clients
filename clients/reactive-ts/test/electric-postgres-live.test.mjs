// Real PostgreSQL logical replication -> Electric v1 HTTP API -> Opto Sync
// bridge. This is *not* Phoenix LiveView execution nor a full Opto Sync
// push/ack flow; both have dedicated future acceptance gates.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { bridgeElectricShape } from '../src/electric-shape.ts';

const file = 'clients/reactive-ts/e2e/electric.compose.yml';
const url = 'http://127.0.0.1:39100/v1/shape';
const scopeKey = 'tenant-test:public.docs:all';
const deadlineMs = 45_000;

function query(sql) {
  execFileSync('docker', ['compose', '-f', file, 'exec', '-T', 'postgres',
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'opto',
    '-c', sql], { stdio: 'pipe', timeout: 15_000 });
}

class HttpShapeStream {
  shapeHandle;
  lastOffset = '-1';
  callback;
  onError;
  closed = false;
  subscribe(callback, onError) {
    this.callback = callback;
    this.onError = onError;
    return () => { this.closed = true; };
  }
  constructor(cursor = null) {
    if (cursor) {
      this.shapeHandle = cursor.shapeHandle;
      this.lastOffset = cursor.offset;
    }
  }
  async poll() {
    assert.equal(this.closed, false, 'bridge unexpectedly closed');
    const params = new URLSearchParams({ table: 'public.docs', offset: this.lastOffset });
    if (this.shapeHandle && this.lastOffset !== '-1') params.set('handle', this.shapeHandle);
    const response = await fetch(url + '?' + params, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, 'Electric HTTP ' + response.status + ': ' + await response.text());
    const nextHandle = response.headers.get('electric-handle');
    const nextOffset = response.headers.get('electric-offset');
    assert.ok(nextHandle && nextOffset, 'Electric must return handle and offset');
    const messages = await response.json();
    assert.ok(Array.isArray(messages), 'Electric must return a JSON message batch');
    this.shapeHandle = nextHandle;
    this.lastOffset = nextOffset;
    await this.callback(messages);
    return messages;
  }
}

const rows = new Map();
const pending = new Map([['doc-1', { id: 'doc-1', title: 'optimistic-local' }]]);
let cursor = null;
const batches = [];
function transact(batch) {
  // In production this callback MUST be one IndexedDB/SQLite transaction.
  // Here, the in-memory fake makes the projection observable in an E2E test.
  if (batch.reset) rows.clear();
  for (const change of batch.changes) {
    if (change.operation === 'delete') rows.delete(change.electricKey);
    else rows.set(change.electricKey, change.value);
  }
  cursor = batch.cursor;
  batches.push(batch);
  return Promise.resolve();
}
function projectedTitle(id) {
  const local = pending.get(id);
  if (local) return local.title;
  return [...rows.values()].find(row => row.id === id)?.title ?? null;
}
async function until(operation, predicate) {
  const end = Date.now() + deadlineMs;
  let last;
  while (Date.now() < end) {
    last = await operation();
    if (predicate(last)) return last;
    await delay(250);
  }
  assert.fail('timed out waiting for Electric change; last result=' + JSON.stringify(last));
}

test('real Postgres WAL to Electric: initial snapshot, pending projection, update, restart, delete', { timeout: 130_000 }, async () => {
  query("CREATE TABLE IF NOT EXISTS public.docs (id text PRIMARY KEY, title text NOT NULL);");
  query("INSERT INTO public.docs(id,title) VALUES ('doc-1','server-initial') ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title;");
  const first = new HttpShapeStream();
  const bridge = bridgeElectricShape({ stream: first, scopeKey, transact });
  await until(() => first.poll(), () => batches.some(b => b.complete));
  assert.ok(cursor?.shapeHandle && cursor?.offset, 'complete snapshot must persist Electric cursor');
  assert.equal([...rows.values()].find(row => row.id === 'doc-1')?.title, 'server-initial');
  assert.equal(projectedTitle('doc-1'), 'optimistic-local', 'server snapshot must not erase pending write');

  query("UPDATE public.docs SET title='server-updated' WHERE id='doc-1';");
  await until(() => first.poll(), () => [...rows.values()].some(row => row.title === 'server-updated'));
  assert.equal(projectedTitle('doc-1'), 'optimistic-local');
  assert.equal(pending.size, 1, 'Electric changes must not acknowledge client mutation queue');

  const savedCursor = cursor;
  bridge.close();
  const restarted = new HttpShapeStream(savedCursor);
  const resumed = bridgeElectricShape({ stream: restarted, scopeKey,
    restoredCursor: savedCursor, transact });
  query("UPDATE public.docs SET title='after-restart' WHERE id='doc-1';");
  const start = batches.length;
  await until(() => restarted.poll(), () => [...rows.values()].some(row => row.title === 'after-restart'));
  assert.ok(batches.slice(start).every(b => !b.reset), 'resume must not replay initial snapshot');
  assert.equal(pending.size, 1);

  query("DELETE FROM public.docs WHERE id='doc-1';");
  await until(() => restarted.poll(), () => rows.size === 0);
  assert.equal(projectedTitle('doc-1'), 'optimistic-local', 'queued local mutation still projects over a delete');
  assert.equal(pending.size, 1);
  resumed.close();
});
