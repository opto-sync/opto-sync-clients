import assert from 'node:assert/strict';
import test from 'node:test';

import { TcpJsonLineProtocolTransport } from '../src/node-tcp.ts';

test('plain TCP rejects non-loopback destinations unless the caller explicitly attests the boundary', () => {
  assert.throws(
    () =>
      new TcpJsonLineProtocolTransport({
        host: 'sync.internal.example',
        port: 7443,
      }),
    /loopback-only/,
  );

  assert.doesNotThrow(
    () =>
      new TcpJsonLineProtocolTransport({
        host: 'sync.internal.example',
        port: 7443,
        allowNonLoopback: true,
        connect: (() => {
          throw new Error('constructor must not connect eagerly');
        }) as never,
      }),
  );
});
