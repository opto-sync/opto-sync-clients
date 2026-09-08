import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const implementations = [
  ['package', require('../dist/forms/index.js')],
  ['standalone', await import('../browser/forms/index.js')],
];
const tick = () => new Promise((resolve) => setImmediate(resolve));

class FakeForm extends EventTarget {
  dataset = { optoSyncForm: 'retry-test' };
  id = 'retry-test';
  method = 'post';
  action = 'https://example.test/intake';
  controls = [];
  replays = 0;
  replayError;
  ownerDocument = { createElement: () => ({ name: '', value: '', type: '' }) };
  getAttribute() { return null; }
  querySelector(selector) {
    const name = selector.match(/^\[name="(.+)"\]$/)?.[1];
    return this.controls.find((control) => control.name === name) ?? null;
  }
  append(control) { this.controls.push(control); }
  requestSubmit() {
    if (this.replayError) throw this.replayError;
    this.replays++;
    this.dispatchEvent(new Event('submit', { cancelable: true }));
  }
}
function setup(api, markMutation) {
  const rows = [];
  const marks = [];
  const queue = {
    async queueMutation(tableName, recordId, envelope) {
      rows.push({ tableName, recordId, envelope });
      return rows.length;
    },
    markMutation: markMutation ?? (async (id, syncStatus) => marks.push({ id, syncStatus })),
  };
  const form = new FakeForm();
  const unbind = api.bindHtmxForm(queue, form, {
    randomId: () => 'stable-submission',
    formDataFactory: () => new FormData(),
  });
  const submit = async () => {
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
  };
  const complete = (detail, event = 'htmx:afterRequest') =>
    form.dispatchEvent(new CustomEvent(event, { detail }));
  return { form, rows, marks, submit, complete, unbind };
}

for (const [name, api] of implementations) {
  for (const status of [undefined, 0, 408, 409, 425, 429, 503]) {
    test(`${name}: HTMX ${status ?? 'unknown'} keeps durable intent but permits another submit`, async () => {
      const context = setup(api);
      const pending = [];
      context.form.addEventListener('opto-sync:form-pending', (event) => pending.push(event.detail));
      try {
        await context.submit();
        const xhr = status === undefined ? {} : { status };
        context.complete({ successful: false, xhr });
        await tick();
        await context.submit();
        assert.equal(context.form.replays, 2, 'transient response must not disable the form');
        assert.equal(context.rows.length, 2);
        assert.deepEqual(context.marks, [], 'ambiguous intent must not be acknowledged or rejected');
        assert.equal(context.rows[0].recordId, context.rows[1].recordId, 'stable idempotency identity');
        assert.deepEqual(pending, [{ queueId: 1, status }]);
        context.complete({ successful: true, xhr });
        await tick();
        assert.deepEqual(context.marks, [], 'late duplicate XHR must not acknowledge a new row');
        context.complete({ successful: true, xhr: { status: 201 } });
        await tick();
        assert.deepEqual(context.marks, [{ id: 2, syncStatus: api.FORM_SYNC_STATUS.SYNCED }]);
      } finally { context.unbind(); }
    });
  }

  test(`${name}: failed queue acknowledgement reports an error and releases the submit gate`, async () => {
    const failure = new Error('queue write failed');
    let calls = 0;
    const context = setup(api, () => { calls++; return Promise.reject(failure); });
    const errors = [];
    context.form.addEventListener('opto-sync:form-error', (event) => errors.push(event.detail.error));
    try {
      await context.submit();
      const detail = { successful: true, xhr: { status: 201 } };
      context.complete(detail);
      context.complete(detail);
      await tick();
      assert.equal(calls, 1, 'duplicate events must not start concurrent cleanup');
      assert.deepEqual(errors, [failure]);
      await context.submit();
      assert.equal(context.form.replays, 2);
    } finally { context.unbind(); }
  });

  test(`${name}: terminal response is marked once across responseError and afterRequest`, async () => {
    const context = setup(api);
    try {
      await context.submit();
      const detail = { successful: false, xhr: { status: 422 } };
      context.complete(detail, 'htmx:responseError');
      context.complete(detail);
      await tick();
      assert.deepEqual(context.marks, [{ id: 1, syncStatus: api.FORM_SYNC_STATUS.FAILED }]);
      await context.submit();
      assert.equal(context.form.replays, 2);
    } finally { context.unbind(); }
  });

  test(`${name}: failed replay preserves queued intent without permanently blocking submit`, async () => {
    const context = setup(api);
    try {
      context.form.replayError = new Error('requestSubmit failed');
      await context.submit();
      context.form.replayError = undefined;
      await context.submit();
      assert.equal(context.form.replays, 1);
      assert.equal(context.rows.length, 2);
      assert.deepEqual(context.marks, []);
    } finally { context.unbind(); }
  });
}
