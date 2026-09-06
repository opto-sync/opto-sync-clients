import assert from 'node:assert/strict';
import test from 'node:test';
import { ComputeWorkerPool, installComputeWorker } from '../src/compute-worker.ts';

class FakeWorker {
  messages: any[] = [];
  listeners = new Map<string, Set<(event: any) => void>>();
  terminated = false;
  postMessage(message: unknown) { this.messages.push(message); }
  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, data: unknown) { for (const listener of this.listeners.get(type) ?? []) listener({ data }); }
  reply(output: number) {
    this.emit('message', { protocol: 'opto.compute.v1', id: this.messages.at(-1).id, ok: true, output });
  }
  terminate() { this.terminated = true; }
}

test('two workers, bounded FIFO admission and out-of-order replies route correctly', async () => {
  const workers: FakeWorker[] = [];
  const pool = new ComputeWorkerPool<number, number>(() => {
    const worker = new FakeWorker(); workers.push(worker); return worker;
  }, { size: 2, maxPending: 3 });
  try {
    const one = pool.run(1); const two = pool.run(2); const three = pool.run(3);
    await assert.rejects(pool.run(4), { code: 'QUEUE_FULL' });
    assert.equal(workers[0].messages.length, 1);
    assert.equal(workers[1].messages.length, 1);
    workers[1].reply(20);
    assert.equal(await two, 20);
    assert.equal(workers[1].messages[1].input, 3);
    workers[0].reply(10); workers[1].reply(30);
    assert.deepEqual(await Promise.all([one, three]), [10, 30]);
  } finally { pool.dispose(); }
  assert.ok(workers.every(w => w.terminated && [...w.listeners.values()].every(s => s.size === 0)));
});

test('worker crashes and disposal settle every accepted request', async () => {
  const worker = new FakeWorker();
  const pool = new ComputeWorkerPool(() => worker, { size: 1 });
  const settled = Promise.allSettled([pool.run(1), pool.run(2)]);
  worker.emit('error', 'private payload must not escape');
  for (const result of await settled) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.equal(result.reason.code, 'WORKER_FAILED');
  }
  await assert.rejects(pool.run(3), { code: 'DISPOSED' });
  pool.dispose();
  const second = new ComputeWorkerPool(() => new FakeWorker(), { size: 1 });
  const pending = assert.rejects(second.run(1), { code: 'DISPOSED' });
  second.dispose(); await pending;
});

test('timeouts release workers; bad responses fail closed', async () => {
  const worker = new FakeWorker();
  const pool = new ComputeWorkerPool(() => worker, { size: 1, timeoutMs: 5 });
  await assert.rejects(pool.run(1), { code: 'TIMED_OUT' });
  assert.equal(worker.terminated, true);
  const malformed = new FakeWorker();
  const other = new ComputeWorkerPool(() => malformed, { size: 1 });
  const failed = assert.rejects(other.run(1), { code: 'INVALID_RESPONSE' });
  malformed.emit('message', { protocol: 'opto.compute.v1', id: 1, ok: true });
  await failed;
});

test('clone failures do not wedge a slot; worker exceptions are payload-free', async () => {
  const broken = new FakeWorker();
  broken.postMessage = () => { throw Error('uncloneable'); };
  const pool = new ComputeWorkerPool(() => broken, { size: 1 });
  await assert.rejects(pool.run(1), { code: 'TASK_FAILED' });
  pool.dispose();
  const scope = new FakeWorker();
  const stop = installComputeWorker(scope, () => { throw Error('secret payload'); });
  scope.emit('message', { protocol: 'opto.compute.v1', id: 7, input: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(scope.messages, [{ protocol: 'opto.compute.v1', id: 7, ok: false }]);
  stop();
  assert.equal(scope.listeners.get('message')!.size, 0);
});
