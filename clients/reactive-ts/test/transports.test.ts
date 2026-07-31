import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import test from 'node:test';

import { HttpProtocolTransport } from '../src/http-transport.ts';
import { TcpJsonLineProtocolTransport } from '../src/node-tcp.ts';

const pushRequest = {
  protocolVersion: 1 as const,
  clientId: 'client-1',
  mutations: [
    {
      mutationId: '1',
      table: 'todos',
      recordId: 'todo-1',
      operation: 'upsert' as const,
      record: { title: 'queued' },
    },
  ],
};

const pushResponse = {
  protocolVersion: 1 as const,
  clientId: 'client-1',
  lastMutationId: '1',
  checkpoint: '5',
  results: [
    {
      mutationId: '1',
      status: 'applied' as const,
      revision: '5',
      checkpoint: '5',
    },
  ],
};

const pullResponse = {
  protocolVersion: 1 as const,
  checkpoint: '5',
  hasMore: false,
  changes: [],
};

const snapshotResponse = {
  protocolVersion: 1 as const,
  checkpoint: '5',
  records: [],
};

test('HTTP transport authenticates push/pull/snapshot and refuses cross-origin reset URLs', async () => {
  const seen: Array<{ method: string; url: string; auth?: string }> = [];
  const server = createHttpServer(async (request, response) => {
    seen.push({
      method: request.method ?? '',
      url: request.url ?? '',
      auth: request.headers.authorization,
    });
    response.setHeader('content-type', 'application/json');
    if (request.url?.startsWith('/sync/v1/push')) {
      response.end(JSON.stringify(pushResponse));
    } else if (request.url?.startsWith('/sync/v1/pull')) {
      response.end(JSON.stringify(pullResponse));
    } else if (request.url?.startsWith('/sync/v1/snapshot')) {
      response.end(JSON.stringify(snapshotResponse));
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const transport = new HttpProtocolTransport({
    baseUrl: `http://127.0.0.1:${address.port}`,
    headers: () => ({ authorization: 'Bearer redacted-test-token' }),
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await transport.push(pushRequest, signal), pushResponse);
  assert.deepEqual(await transport.pull('0', 25, signal), pullResponse);
  assert.deepEqual(await transport.snapshot(signal), snapshotResponse);
  await assert.rejects(
    transport.snapshot(signal, {
      protocolVersion: 1,
      error: 'RESET_REQUIRED',
      snapshotUrl: 'https://attacker.invalid/snapshot',
    }),
    /cross-origin/,
  );
  assert.deepEqual(
    seen.map(({ method, url, auth }) => ({ method, url, auth })),
    [
      { method: 'POST', url: '/sync/v1/push', auth: 'Bearer redacted-test-token' },
      {
        method: 'GET',
        url: '/sync/v1/pull?checkpoint=0&limit=25',
        auth: 'Bearer redacted-test-token',
      },
      { method: 'GET', url: '/sync/v1/snapshot', auth: 'Bearer redacted-test-token' },
    ],
  );
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test('bounded TCP JSONL transport uses the same protocol envelope', async () => {
  const methods: string[] = [];
  const server = createTcpServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as {
        id: string;
        method: string;
        payload: unknown;
        auth?: Record<string, string>;
      };
      methods.push(request.method);
      assert.deepEqual(request.auth, { session: 'session-1' });
      const result =
        request.method === 'push'
          ? pushResponse
          : request.method === 'pull'
            ? pullResponse
            : snapshotResponse;
      socket.end(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const transport = new TcpJsonLineProtocolTransport({
    host: '127.0.0.1',
    port: address.port,
    auth: () => ({ session: 'session-1' }),
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await transport.push(pushRequest, signal), pushResponse);
  assert.deepEqual(await transport.pull('0', 10, signal), pullResponse);
  assert.deepEqual(await transport.snapshot(signal), snapshotResponse);
  assert.deepEqual(methods, ['push', 'pull', 'snapshot']);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
