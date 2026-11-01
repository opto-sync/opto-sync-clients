import assert from 'node:assert/strict';
import test from 'node:test';
import { createScopedCollection } from '../src/scoped-collection.ts';
import { ScopedHttpError, syncScopedCollectionOnce } from '../src/scoped-http.ts';

const token = 'a'.repeat(64);
const scope = { version: 1 as const, table: 'docs', recordIds: ['a'] };
function client() {
  return createScopedCollection<{ title: string }>({
    scope, sessionPartition: 'tenant:user:session',
  });
}

test('scoped HTTP coordinator snapshots, pulls and handles empty-global jumps', async () => {
  const collection = client();
  const requests: Record<string, unknown>[] = [];
  let credentials = 0;
  const http: typeof fetch = async (input, init) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(request);
    assert.equal((init?.headers as Record<string, string>).authorization,
      'Bearer current-' + credentials);
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/snapshot')) {
      return new Response(JSON.stringify({
        protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: token,
        checkpoint: '10', records: [{ recordId: 'a', revision: '1', record: { title: 'old' } }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: token,
      fromCheckpoint: '10', checkpoint: '15', hasMore: false,
      changes: [{ checkpoint: '11', recordId: 'a', revision: '2',
        operation: 'upsert', record: { title: 'new' } }],
    }), { status: 200 });
  };
  const result = await syncScopedCollectionOnce(collection, {
    baseUrl: 'https://sync.example.invalid',
    headers: () => ({ authorization: 'Bearer current-' + ++credentials }),
    fetchImpl: http,
  });
  assert.deepEqual(result, { status: 'caught-up', checkpoint: '15' });
  assert.equal(requests.length, 2);
  assert.equal(credentials, 2);
  assert.equal(requests[1].scopeToken, token);
  assert.equal(collection.getView().rows.get('a')?.title, 'new');
});

test('server reset invalidates only scoped head and permits a fresh snapshot', async () => {
  const collection = client();
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: token,
    checkpoint: '5', records: [],
  });
  const status = await syncScopedCollectionOnce(collection, {
    baseUrl: 'https://sync.example.invalid',
    headers: () => ({}),
    fetchImpl: async () => new Response(JSON.stringify({
      protocolVersion: 1, error: 'RESET_REQUIRED',
    }), { status: 409 }),
  });
  assert.deepEqual(status, { status: 'reset-required' });
  assert.equal(collection.getView().ready, false);
  assert.equal(collection.getView().checkpoint, null);
});

test('authorization failures are typed and do not echo response text', async () => {
  const collection = client();
  await assert.rejects(syncScopedCollectionOnce(collection, {
    baseUrl: 'https://sync.example.invalid',
    headers: () => ({}),
    fetchImpl: async () => new Response(JSON.stringify({
      error: 'UNAUTHORIZED', privateData: 'must-never-appear',
    }), { status: 401 }),
  }), (err: unknown) => {
    assert.ok(err instanceof ScopedHttpError);
    assert.equal(err.code, 'UNAUTHORIZED');
    assert.doesNotMatch(err.message, /must-never-appear/);
    return true;
  });
});

test('no implicit checkpoint advancement on malformed HTTP page', async () => {
  const collection = client();
  await collection.installSnapshot({
    protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: token,
    checkpoint: '8', records: [{ recordId: 'a', revision: '1', record: { title: 'safe' } }],
  });
  await assert.rejects(syncScopedCollectionOnce(collection, {
    baseUrl: 'https://sync.example.invalid',
    headers: () => ({}),
    fetchImpl: async () => new Response(JSON.stringify({
      protocolVersion: 1, scopeKey: collection.scopeKey, scopeToken: token,
      fromCheckpoint: '7', checkpoint: '10', hasMore: false, changes: [],
    }), { status: 200 }),
  }), /mismatch/);
  assert.equal(collection.getView().checkpoint, '8');
  assert.equal(collection.getView().rows.get('a')?.title, 'safe');
});
