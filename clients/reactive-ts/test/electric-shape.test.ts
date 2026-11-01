import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeElectricShape } from '../src/electric-shape.ts';
import type { ElectricShapeBatch, ElectricShapeMessage } from '../src/electric-shape.ts';

type Row = { id: string; title: string };
class FakeStream {
  shapeHandle = 'shape-A';
  lastOffset = '3_0';
  private onMessage?: (messages: ElectricShapeMessage<Row>[]) => void | Promise<void>;
  private onError?: (error: Error) => void;
  stopped = false;
  subscribe(cb: (messages: ElectricShapeMessage<Row>[]) => void | Promise<void>, onError?: (error: Error) => void) {
    this.onMessage = cb; this.onError = onError; this.stopped = false;
    return () => { this.stopped = true; };
  }
  async send(messages: ElectricShapeMessage<Row>[], offset: string) {
    this.lastOffset = offset;
    await this.onMessage!(messages);
  }
  fail(error: Error) { this.onError?.(error); }
}
const row = (id: string, title: string): ElectricShapeMessage<Row> =>
  ({ key: 'electric:' + id, value: { id, title }, headers: { operation: 'insert' } });
const control = (name: string): ElectricShapeMessage<Row> => ({ headers: { control: name } });
const cursor = { version: 1 as const, scopeKey: 'scope-A', shapeHandle: 'shape-A', offset: '3_0' };

test('initial snapshot only exposes complete cursor at up-to-date; pending queue is external', async () => {
  const stream = new FakeStream();
  const seen: ElectricShapeBatch<Row>[] = [];
  const bridge = bridgeElectricShape({ stream, scopeKey: 'scope-A', transact: async batch => { seen.push(batch); } });
  await stream.send([row('1', 'draft')], '1_0');
  assert.equal(seen[0]?.reset, true);
  assert.equal(seen[0]?.complete, false);
  assert.equal(seen[0]?.cursor, null);
  await stream.send([control('up-to-date')], '2_0');
  assert.equal(seen[1]?.complete, true);
  assert.deepEqual(seen[1]?.cursor, { ...cursor, offset: '2_0' });
  await stream.send([row('2', 'other')], '3_0');
  assert.equal(seen[2]?.reset, false);
  assert.deepEqual(seen[2]?.cursor, cursor);
  bridge.close();
});

test('must-refetch invalidates cursor and atomically resets authoritative subset', async () => {
  const stream = new FakeStream();
  const seen: ElectricShapeBatch<Row>[] = [];
  const bridge = bridgeElectricShape({ stream, scopeKey: 'scope-A', restoredCursor: cursor, transact: async b => { seen.push(b); } });
  stream.shapeHandle = 'shape-B';
  await stream.send([row('old', 'stale'), control('must-refetch'), row('new', 'fresh')], '4_0');
  assert.equal(seen[0]?.reset, true);
  assert.equal(seen[0]?.cursor, null);
  assert.deepEqual(seen[0]?.changes.map(x => x.electricKey), ['electric:new']);
  await stream.send([control('up-to-date')], '5_0');
  assert.deepEqual(seen[1]?.cursor, { version: 1, scopeKey: 'scope-A', shapeHandle: 'shape-B', offset: '5_0' });
  bridge.close();
});

test('rejects cross-tenant shape cursors and unannounced shape rotation', async () => {
  assert.throws(() => bridgeElectricShape({ stream: new FakeStream(), scopeKey: 'scope-B', restoredCursor: cursor, transact: async () => {} }), /scope/);
  const stream = new FakeStream();
  const bridge = bridgeElectricShape({ stream, scopeKey: 'scope-A', restoredCursor: cursor, transact: async () => {} });
  stream.shapeHandle = 'shape-B';
  await stream.send([row('1', 'bad')], '5_0');
  assert.equal(stream.stopped, true);
  await assert.rejects(bridge.idle(), /handle changed/);
});

test('never interprets opaque Electric delete keys as Opto Sync primary keys', async () => {
  const stream = new FakeStream();
  const seen: ElectricShapeBatch<Row>[] = [];
  const bridge = bridgeElectricShape({ stream, scopeKey: 'scope-A', restoredCursor: cursor, transact: async b => { seen.push(b); } });
  await stream.send([{ key: '[\"opaque\",3]', headers: { operation: 'delete' } }], '4_0');
  assert.deepEqual(seen[0]?.changes, [{ electricKey: '["opaque",3]', operation: 'delete', value: null }]);
  bridge.close();
});

test('failed atomic write stops stream without advancing cursor', async () => {
  const stream = new FakeStream();
  const bridge = bridgeElectricShape({ stream, scopeKey: 'scope-A', transact: async () => { throw new Error('disk full'); } });
  await stream.send([row('1', 'x'), control('up-to-date')], '2_0');
  assert.equal(stream.stopped, true);
  await assert.rejects(bridge.idle(), /disk full/);
});

test('rejects subset events, malformed rows, and invalid operations', async () => {
  const cases: ElectricShapeMessage<Row>[][] = [
    [{ headers: { event: 'move-out' } }],
    [{ key: '', value: { id: '1', title: 'x' }, headers: { operation: 'insert' } }],
    [{ key: 'x', headers: { operation: 'insert' } }],
    [{ headers: { control: 'subset-end' } }],
  ];
  for (const messages of cases) {
    const stream = new FakeStream();
    const bridge = bridgeElectricShape({ stream, scopeKey: 'scope-A', transact: async () => {} });
    await stream.send(messages, '1_0');
    assert.equal(stream.stopped, true);
    await assert.rejects(bridge.idle());
  }
});

test('concurrent callbacks commit in delivery order and capture their own offsets', async () => {
  const stream = new FakeStream();
  const saved: string[] = [];
  const bridge = bridgeElectricShape({ stream, scopeKey: 'scope-A', restoredCursor: cursor, transact: async b => {
    await new Promise(resolve => setTimeout(resolve, 2));
    saved.push(b.cursor!.offset);
  } });
  const first = stream.send([row('1', 'a')], '4_0');
  const second = stream.send([row('2', 'b')], '5_0');
  await Promise.all([first, second]);
  assert.deepEqual(saved, ['4_0', '5_0']);
  bridge.close();
});

test('Electric error callback is contained and the bridge fails closed', async () => {
  const stream = new FakeStream();
  const errors: string[] = [];
  const bridge = bridgeElectricShape({
    stream, scopeKey: 'scope-A', restoredCursor: cursor,
    transact: async () => {}, onError: e => { errors.push(e.message); },
  });
  stream.fail(new Error('expired authorization'));
  await assert.rejects(bridge.idle(), /expired authorization/);
  assert.deepEqual(errors, ['expired authorization']);
  assert.equal(stream.stopped, true);
});

test('rejects restored cursor if the stream did not resume at exactly that position', () => {
  const stream = new FakeStream();
  stream.lastOffset = '2_0';
  assert.throws(() => bridgeElectricShape({
    stream, scopeKey: 'scope-A', restoredCursor: cursor, transact: async () => {},
  }), /not constructed with the restored/);
});

test('rejects ambiguous control and operation header', async () => {
  const stream = new FakeStream();
  const bridge = bridgeElectricShape({
    stream, scopeKey: 'scope-A', transact: async () => {},
  });
  await stream.send([{ key: 'x', value: { id: 'x', title: 'y' },
    headers: { control: 'up-to-date', operation: 'insert' } }], '4_0');
  await assert.rejects(bridge.idle(), /ambiguous/);
  assert.equal(stream.stopped, true);
});

test('snapshot-end is recognized but never treated as up-to-date', async () => {
  const stream = new FakeStream();
  const batches: ElectricShapeBatch<Row>[] = [];
  const bridge = bridgeElectricShape({ stream, scopeKey: 'scope-A',
    transact: async batch => { batches.push(batch); } });
  await stream.send([row('1', 'initial'), control('snapshot-end')], '3_0');
  assert.equal(batches[0]?.complete, false);
  assert.equal(batches[0]?.cursor, null);
  await stream.send([control('up-to-date')], '4_0');
  assert.equal(batches[1]?.complete, true);
  assert.equal(batches[1]?.cursor?.offset, '4_0');
  bridge.close();
});
