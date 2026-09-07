import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import 'fake-indexeddb/auto';

const require = createRequire(import.meta.url);
const forms = require('../dist/forms/index.js');
const standalone = await import('../browser/forms/index.js');
const {
  FORM_SYNC_STATUS,
  bindHtmxForm,
  bindNativeForm,
  createBrowserFormQueue,
  queueFormPayload,
  sanitizeFormPayload,
  serializeFormData,
} = forms;

class FakeQueue {
  rows = [];
  marks = [];
  async queueMutation(tableName, recordId, payload, protocol) {
    this.rows.push({ tableName, recordId, payload, protocol });
    return this.rows.length;
  }
  async markMutation(id, syncStatus) {
    this.marks.push({ id, syncStatus });
  }
}
class FakeInput {
  type = '';
  name = '';
  value = '';
}
class FakeForm extends EventTarget {
  dataset = { optoSyncForm: 'pre-interest' };
  id = 'pre-interest';
  method = 'post';
  action = 'https://api.hhaus.org/v1/pre-interests?discard=1';
  controls = [];
  requestSubmitCalls = 0;
  submitCalls = 0;
  ownerDocument = { createElement: () => new FakeInput() };
  getAttribute(name) {
    if (name === 'name') return 'pre-interest';
    if (name === 'action') return this.action;
    return null;
  }
  querySelector(selector) {
    const match = selector.match(/^\[name="(.+)"\]$/);
    return match
      ? this.controls.find((item) => item.name === match[1]) ?? null
      : null;
  }
  append(input) {
    this.controls.push(input);
  }
  requestSubmit() {
    this.requestSubmitCalls += 1;
    this.dispatchEvent(new Event('submit', { cancelable: true }));
  }
  submit() {
    this.submitCalls += 1;
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('deep sanitizer removes credentials without mutating its input', () => {
  const input = {
    email: 'ada@example.test',
    turnstileToken: 'secret-token',
    nested: { csrf_token: 'never-store', idea: 'A member-owned workshop' },
    choices: [{ accessToken: 'nope', city: 'Medellin' }],
  };
  assert.deepEqual(sanitizeFormPayload(input), {
    email: 'ada@example.test',
    nested: { idea: 'A member-owned workshop' },
    choices: [{ city: 'Medellin' }],
  });
  assert.equal(input.turnstileToken, 'secret-token');
});

test('manual queue keeps a stable id and strips URL credentials', async () => {
  const queue = new FakeQueue();
  const queued = await queueFormPayload(queue, {
    formName: 'hhaus.pre-interest',
    tableName: 'form_submissions/hhaus/pre-interest',
    submissionId: 'submission-123',
    sourceUrl: 'https://hhaus.org/submit-pre-interest/?token=nope#fragment',
    action: 'https://api.hhaus.org/v1/pre-interests?access_token=nope',
    method: 'post',
    payload: { email: 'ada@example.test', turnstileToken: 'transient' },
    now: () => new Date('2026-09-07T12:00:00.000Z'),
  });
  assert.equal(queued.queueId, 1);
  assert.equal(queue.rows[0].recordId, 'submission-123');
  assert.equal(queue.rows[0].payload.sourceUrl, 'https://hhaus.org/submit-pre-interest/');
  assert.equal(queue.rows[0].payload.action, 'https://api.hhaus.org/v1/pre-interests');
  assert.deepEqual(queue.rows[0].payload.payload, { email: 'ada@example.test' });
});

test('FormData preserves repeated values and drops challenge tokens', () => {
  const data = new FormData();
  data.append('city', 'Medellin');
  data.append('interest', 'community meals');
  data.append('interest', 'coworking');
  data.append('cf-turnstile-response', 'transient');
  assert.deepEqual(serializeFormData(data), {
    fields: { city: 'Medellin', interest: ['community meals', 'coworking'] },
  });
});

test('native connector queues before transport and acknowledges success', async () => {
  const queue = new FakeQueue();
  const form = new FakeForm();
  const order = [];
  const unbind = bindNativeForm(queue, form, {
    tableName: 'forms/pre-interest',
    randomId: () => 'submission-native',
    now: () => new Date('2026-09-07T12:00:00.000Z'),
    formDataFactory: () => {
      const data = new FormData();
      data.append('email', 'ada@example.test');
      return data;
    },
    submit: async () => {
      order.push('submit');
      assert.equal(queue.rows.length, 1);
      return { ok: true, status: 201 };
    },
  });
  form.addEventListener('opto-sync:form-queued', () => order.push('queued'));
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  unbind();
  assert.deepEqual(order, ['queued', 'submit']);
  assert.deepEqual(queue.marks, [{ id: 1, syncStatus: FORM_SYNC_STATUS.SYNCED }]);
  assert.equal(form.controls[0].value, 'submission-native');
});

test('HTMX connector queues before replay and acknowledges afterRequest', async () => {
  const queue = new FakeQueue();
  const form = new FakeForm();
  const unbind = bindHtmxForm(queue, form, {
    tableName: 'forms/application',
    randomId: () => 'submission-htmx',
    now: () => new Date('2026-09-07T13:00:00.000Z'),
    formDataFactory: () => {
      const data = new FormData();
      data.append('legalName', 'Ada Lovelace');
      data.append('turnstileToken', 'never-store');
      return data;
    },
  });
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  assert.equal(queue.rows.length, 1);
  assert.equal(form.requestSubmitCalls, 1);
  assert.equal(
    form.controls.find((item) => item.name === '_opto_mutation_id').value,
    '1',
  );
  assert.equal(JSON.stringify(queue.rows[0].payload).includes('never-store'), false);
  form.dispatchEvent(
    new CustomEvent('htmx:afterRequest', {
      detail: { successful: true, xhr: { status: 201 } },
    }),
  );
  await tick();
  unbind();
  assert.deepEqual(queue.marks, [{ id: 1, syncStatus: FORM_SYNC_STATUS.SYNCED }]);
});

test('IndexedDB queue survives reopen and filters acknowledged rows', async () => {
  const databaseName = `opto-form-test-${crypto.randomUUID()}`;
  const queue = createBrowserFormQueue({ databaseName });
  const first = await queue.queueMutation(
    'forms/pre-interest',
    'submission-a',
    { email: 'ada@example.test' },
  );
  await queue.queueMutation(
    'forms/application',
    'submission-b',
    { legalName: 'Ada Lovelace' },
  );
  assert.equal((await queue.pendingMutations()).length, 2);
  await queue.markMutation(first, FORM_SYNC_STATUS.SYNCED);
  assert.deepEqual(
    (await queue.pendingMutations()).map((row) => row.recordId),
    ['submission-b'],
  );
  await queue.close();
  const reopened = createBrowserFormQueue({ databaseName });
  assert.deepEqual(
    (await reopened.pendingMutations('forms/application')).map(
      (row) => row.recordId,
    ),
    ['submission-b'],
  );
  await reopened.close();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
});

test('standalone browser export matches the package connector surface', () => {
  for (const name of [
    'bindHtmxForm',
    'bindNativeForm',
    'createBrowserFormQueue',
    'queueFormPayload',
    'sanitizeFormPayload',
  ]) {
    assert.equal(typeof standalone[name], 'function', name);
  }
  assert.equal(standalone.FORM_SCHEMA_VERSION, forms.FORM_SCHEMA_VERSION);
});
