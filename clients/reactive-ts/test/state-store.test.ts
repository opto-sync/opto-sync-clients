import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { StateStore, type StateEffect } from '../src/state-store.ts';

type State = Readonly<{ count: number; status: string }>;
type Action = { type: string; value: number | string };
const initial = (): State => Object.freeze({ count: 0, status: 'idle' });
function reduce(s: State, a: Action): State {
  switch (a.type) {
    case 'add': return Object.freeze({ ...s, count: s.count + Number(a.value) });
    case 'hydrate': return Object.freeze({ ...s, count: Number(a.value) });
    case 'status': return Object.freeze({ ...s, status: String(a.value) });
    default: throw Error('unknown action');
  }
}

test('portable state-store v1 corpus', () => {
  const corpus = JSON.parse(readFileSync(new URL('../../../conformance/state-store/scenario.json', import.meta.url), 'utf8'));
  assert.equal(corpus.contract, 'opto.state-store.v1');
  const store = new StateStore(initial(), reduce);
  const selections: number[] = [];
  const unsubscribe = store.select(s => s.count, value => selections.push(value));
  const effects = new Map<string, StateEffect<Action>>();
  for (const step of corpus.steps) {
    switch (step.op) {
      case 'dispatch': store.dispatch(step.action); break;
      case 'begin': effects.set(step.id, store.beginEffect(step.key)); break;
      case 'effect': assert.equal(effects.get(step.id)!.dispatch(step.action), step.accepted); break;
      case 'close': effects.get(step.id)!.close(); break;
      case 'reset': store.reset(initial()); break;
      case 'unsubscribe': unsubscribe(); unsubscribe(); break;
      case 'dispose': store.dispose(); break;
      default: assert.fail(`unknown step ${step.op}`);
    }
    assert.equal(store.revision, step.revision);
    if ('count' in step) assert.equal(store.state.count, step.count);
    if ('status' in step) assert.equal(store.state.status, step.status);
    if ('selections' in step) assert.deepEqual(selections, step.selections);
  }
  assert.throws(() => store.dispatch({ type: 'add', value: 1 }), /disposed/);
  assert.throws(() => store.reset(initial()), /disposed/);
  assert.throws(() => store.beginEffect('late'), /disposed/);
  assert.throws(() => store.select(s => s, () => {}), /disposed/);
});

test('reducer failure is atomic; rendering errors are isolated; nested dispatch is rejected', () => {
  const errors: unknown[] = [];
  const store = new StateStore(initial(), reduce, e => errors.push(e));
  assert.throws(() => store.dispatch({ type: 'fail', value: 0 }));
  assert.equal(store.revision, 0);
  assert.equal(store.state.count, 0);
  store.select(s => s.count, count => { if (count) store.dispatch({ type: 'add', value: 100 }); });
  const good: number[] = [];
  store.select(s => s.count, count => good.push(count));
  store.dispatch({ type: 'add', value: 1 });
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /reentrant/);
  assert.deepEqual(good, [0, 1]);
  assert.equal(store.revision, 1);
  assert.throws(() => store.select(s => s.count, () => { throw Error('initial'); }));
  store.dispatch({ type: 'status', value: 'ready' });
  assert.equal(errors.length, 1, 'failed initial subscribers are not retained');
});

test('selector equality and cancellation during notification', () => {
  const store = new StateStore(initial(), reduce);
  const selected: number[][] = [];
  store.select(s => [s.count], v => selected.push(v), (a, b) => a[0] === b[0]);
  let stop = () => {};
  store.select(s => s.count, count => { if (count > 0) stop(); });
  const late: number[] = [];
  stop = store.select(s => s.count, count => late.push(count));
  store.dispatch({ type: 'status', value: 'loading' });
  store.dispatch({ type: 'add', value: 2 });
  assert.deepEqual(selected, [[0], [2]]);
  assert.deepEqual(late, [0]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('real opto-sync queue and native reconciliation hydrate pending intent over newer remote state', async () => {
  const requireClient = createRequire(new URL('../../ts/package.json', import.meta.url));
  requireClient('fake-indexeddb/auto');
  const { OptoSyncClient } = requireClient('./dist/index.js') as typeof import('../../ts/src/index.ts');
  const client = new OptoSyncClient({ databaseName: 'state-store-integration', stampUpdatedAt: false });
  const store = new StateStore<Record<string, unknown>, Record<string, unknown>>({}, (_, value) => value);
  try {
    await client.queueMutation('todos', 'one', { id: 'one', title: 'pending edit', updatedAt: '1' });
    const remote = { id: 'one', title: 'newer server echo', updatedAt: '9000', owner: 'kept' };
    await store.projectLocalView('todo:one', () => client.localView('todos', 'one', remote), value => value!);
    assert.equal(store.state.title, 'pending edit');
    assert.equal(store.state.owner, 'kept');
    assert.equal((await client.pendingMutations()).length, 1, 'hydration never acknowledges writes');
    store.reset({});
    // Recreating the UI projection does not strand or delete the durable queue.
    await store.projectLocalView('todo:one', () => client.localView('todos', 'one', remote), value => value!);
    assert.equal(store.state.title, 'pending edit');
  } finally {
    store.dispose();
    await client.db.delete();
  }
});

test('out-of-order projections, logout and disposal never hydrate stale results', async () => {
  const store = new StateStore(initial(), reduce);
  const hydrate = (value: number): Action => ({ type: 'hydrate', value });
  const old = deferred<number>();
  const first = store.projectLocalView('view', () => old.promise, hydrate);
  assert.equal(await store.projectLocalView('view', async () => 7, hydrate), true);
  old.resolve(99);
  assert.equal(await first, false);
  assert.equal(store.state.count, 7);
  const rotating = deferred<number>();
  const pending = store.projectLocalView('view', () => rotating.promise, hydrate);
  store.reset(initial());
  rotating.resolve(55);
  assert.equal(await pending, false);
  const failed = store.projectLocalView('view', async () => { throw Error('disk'); }, hydrate);
  await assert.rejects(failed, /disk/);
  assert.equal(store.state.count, 0);
  const closing = deferred<number>();
  const last = store.projectLocalView('view', () => closing.promise, hydrate);
  store.dispose();
  closing.resolve(55);
  assert.equal(await last, false);
});

test('durable commit survives a view unmount; failed commit never reports queued UI state', async () => {
  const store = new StateStore(initial(), reduce);
  const disk = deferred<void>();
  const queue: number[] = [];
  const effect = store.beginEffect('write');
  const write = (async () => {
    try {
      await disk.promise; // Host's atomic app-row + queue transaction.
      queue.push(1);
      return effect.dispatch({ type: 'hydrate', value: queue.length });
    } finally { effect.close(); }
  })();
  store.dispose();
  disk.resolve();
  assert.equal(await write, false);
  assert.deepEqual(queue, [1]);
  const other = new StateStore(initial(), reduce);
  await assert.rejects(other.projectLocalView('view', async () => { throw Error('transaction'); },
    value => ({ type: 'hydrate', value })), /transaction/);
  assert.equal(other.revision, 0);
});
