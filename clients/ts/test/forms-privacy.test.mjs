import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import 'fake-indexeddb/auto';

const require = createRequire(import.meta.url);
const { createBrowserFormQueue } = require('../dist/forms/index.js');

test('form queue can forget sensitive payloads after canonical persistence', async () => {
  const databaseName = `opto-form-forget-${crypto.randomUUID()}`;
  const queue = createBrowserFormQueue({ databaseName });
  const id = await queue.queueMutation(
    'forms/application',
    'submission-sensitive',
    { legalName: 'Ada Lovelace', dateOfBirth: '1815-12-10' },
  );
  assert.equal((await queue.pendingMutations()).length, 1);
  await queue.deleteMutation(id);
  assert.equal((await queue.pendingMutations()).length, 0);
  await queue.close();

  const reopened = createBrowserFormQueue({ databaseName });
  assert.equal((await reopened.pendingMutations()).length, 0);
  await reopened.close();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
});
