from pathlib import Path

source_path = Path('clients/reactive-ts/src/live-hints.ts')
source = source_path.read_text(encoding='utf-8')

old_options = """  retryAttempts?: number;
  retryScheduler?: SchedulerLike;
}
"""
new_options = """  retryAttempts?: number;
  retryScheduler?: SchedulerLike;
  /** Maximum accepted wake-hint message size. Default 256 KiB. */
  maxMessageBytes?: number;
  /** Injectable entropy for full-jitter reconnect tests. */
  retryRandom?: () => number;
}
"""
if source.count(old_options) < 2:
    raise SystemExit('expected WebSocket and Supabase retry option blocks')
source = source.replace(old_options, new_options, 1)

old_delay = """function retryDelay(
  retryBase: number,
  retryMax: number,
  count: number,
): number {
  return Math.min(
    retryMax,
    retryBase * 2 ** Math.min(Math.max(0, count - 1), 10),
  );
}
"""
new_delay = """function retryDelay(
  retryBase: number,
  retryMax: number,
  count: number,
  random?: () => number,
): number {
  const ceiling = Math.min(
    retryMax,
    retryBase * 2 ** Math.min(Math.max(0, count - 1), 10),
  );
  if (!random) return ceiling;
  const sample = Math.min(1, Math.max(0, random()));
  return Math.round(ceiling * sample);
}

function messageByteLength(value: unknown): number | null {
  if (typeof value === 'string') {
    return typeof TextEncoder === 'function'
      ? new TextEncoder().encode(value).byteLength
      : value.length;
  }
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value && typeof value === 'object' && 'size' in value) {
    const size = (value as { size?: unknown }).size;
    return Number.isSafeInteger(size) && Number(size) >= 0 ? Number(size) : null;
  }
  return null;
}
"""
if source.count(old_delay) != 1:
    raise SystemExit('expected one retryDelay implementation')
source = source.replace(old_delay, new_delay)

old_setup = """  const decode = options.decode ?? defaultDecode;
  const { retryBase, retryMax, retryAttempts } = retryOptions(options);

  return options.session$.pipe(
"""
new_setup = """  const decode = options.decode ?? defaultDecode;
  const { retryBase, retryMax, retryAttempts } = retryOptions(options);
  const maxMessageBytes = options.maxMessageBytes ?? 256 * 1_024;
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1) {
    throw new RangeError('maxMessageBytes must be a positive safe integer');
  }
  const retryRandom = options.retryRandom ?? Math.random;

  return options.session$.pipe(
"""
if source.count(old_setup) != 1:
    raise SystemExit('expected raw WebSocket setup block')
source = source.replace(old_setup, new_setup)

old_observable = """      return new Observable<SyncHint>((subscriber) => {
        const socket = create(url, options.protocols);
        const onMessage = (event: { data?: unknown }) => {
          const decoded = decode(event.data, identity);
          if (!decoded) return;
          subscriber.next({
            ...decoded,
            reason: 'remote-change',
            source: 'websocket',
            sessionPartition,
          });
        };
        const onError = () =>
          subscriber.error(new Error('opto-sync WebSocket hint error'));
        const onClose = (event: { code?: number; reason?: string }) => {
          subscriber.error(
            new Error(
              `opto-sync WebSocket closed (code=${
                Number.isSafeInteger(event.code) ? event.code : 0
              })`,
            ),
          );
        };
        socket.addEventListener('message', onMessage);
        socket.addEventListener('error', onError);
        socket.addEventListener('close', onClose);
        return () => {
          socket.removeEventListener('message', onMessage);
          socket.removeEventListener('error', onError);
          socket.removeEventListener('close', onClose);
          socket.close(1000, 'session changed or subscriber left');
        };
      }).pipe(
        retry({
          count: retryAttempts,
          delay: (_error, count) =>
            timer(
              retryDelay(retryBase, retryMax, count),
              options.retryScheduler,
            ),
        }),
      );
"""
new_observable = """      return new Observable<SyncHint>((subscriber) => {
        let intentionalTeardown = false;
        let failed = false;
        let socket: WebSocketLike;
        const fail = (message: string, closeCode?: number, closeReason?: string) => {
          if (failed || intentionalTeardown || subscriber.closed) return;
          failed = true;
          if (closeCode !== undefined) {
            try {
              socket.close(closeCode, closeReason);
            } catch {
              // The subscriber error below owns lifecycle completion.
            }
          }
          subscriber.error(new Error(message));
        };
        try {
          socket = create(url, options.protocols);
        } catch {
          subscriber.error(new Error('opto-sync WebSocket hint creation failed'));
          return;
        }
        const onMessage = (event: { data?: unknown }) => {
          if (intentionalTeardown || failed || subscriber.closed) return;
          const bytes = messageByteLength(event.data);
          if (bytes !== null && bytes > maxMessageBytes) {
            fail(
              'opto-sync WebSocket hint message exceeds the configured limit',
              1009,
              'message too large',
            );
            return;
          }
          let decoded: DecodedSyncHint | null;
          try {
            decoded = decode(event.data, identity);
          } catch {
            fail('opto-sync WebSocket hint decode failed', 1002, 'decode failed');
            return;
          }
          if (!decoded) return;
          subscriber.next({
            ...decoded,
            reason: 'remote-change',
            source: 'websocket',
            sessionPartition,
          });
        };
        const onError = () => fail('opto-sync WebSocket hint error');
        const onClose = (event: { code?: number; reason?: string }) => {
          fail(
            `opto-sync WebSocket closed (code=${
              Number.isSafeInteger(event.code) ? event.code : 0
            })`,
          );
        };
        socket.addEventListener('message', onMessage);
        socket.addEventListener('error', onError);
        socket.addEventListener('close', onClose);
        return () => {
          intentionalTeardown = true;
          socket.removeEventListener('message', onMessage);
          socket.removeEventListener('error', onError);
          socket.removeEventListener('close', onClose);
          try {
            socket.close(1000, 'session changed or subscriber left');
          } catch {
            // Teardown is idempotent and best-effort.
          }
        };
      }).pipe(
        retry({
          count: retryAttempts,
          delay: (_error, count) =>
            timer(
              retryDelay(retryBase, retryMax, count, retryRandom),
              options.retryScheduler,
            ),
        }),
      );
"""
if source.count(old_observable) != 1:
    raise SystemExit('expected raw WebSocket observable block')
source = source.replace(old_observable, new_observable)
source_path.write_text(source, encoding='utf-8')

test_path = Path('clients/reactive-ts/test/hints.test.ts')
tests = test_path.read_text(encoding='utf-8')
marker = "test('BroadcastChannel bus sanitizes metadata for local and remote tabs', async () => {"
if tests.count(marker) != 1:
    raise SystemExit('expected BroadcastChannel test marker')
new_tests = """test('raw WebSocket hint failures are bounded, redacted, and generation-fenced', () => {
  const sessions = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  const constructorErrors: Error[] = [];
  createWebSocketHints$({
    session$: sessions,
    url: () => 'ws://127.0.0.1/hints',
    create: () => {
      throw new Error('secret-token-from-constructor');
    },
    retryAttempts: 0,
  }).subscribe({ error: (error) => constructorErrors.push(error as Error) });
  assert.equal(constructorErrors[0]?.message, 'opto-sync WebSocket hint creation failed');
  assert.doesNotMatch(constructorErrors[0]?.message ?? '', /secret-token/);

  const sockets: FakeSocket[] = [];
  const decodeErrors: Error[] = [];
  let decodeCalls = 0;
  const subscription = createWebSocketHints$({
    session$: sessions,
    url: () => 'ws://127.0.0.1/hints',
    create: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    decode: () => {
      decodeCalls += 1;
      throw new Error('secret-payload-value');
    },
    retryAttempts: 0,
  }).subscribe({ error: (error) => decodeErrors.push(error as Error) });
  const retiredCallback = [...(sockets[0].listeners.get('message') ?? [])][0];
  const rotated = { ...identity, session_id: 'session-b' };
  sessions.next({ status: 'authenticated', identity: rotated });
  retiredCallback?.({ data: '{}' });
  assert.equal(decodeCalls, 0, 'retired callbacks cannot invoke a decoder');
  sockets[1].emit('message', { data: '{}' });
  assert.equal(decodeCalls, 1);
  assert.equal(decodeErrors[0]?.message, 'opto-sync WebSocket hint decode failed');
  assert.doesNotMatch(decodeErrors[0]?.message ?? '', /secret-payload/);
  assert.equal(sockets[1].closed, true);
  subscription.unsubscribe();
  sessions.complete();
});

test('raw WebSocket hint messages enforce the configured byte limit', () => {
  const sessions = new BehaviorSubject<SyncSession>({
    status: 'authenticated',
    identity,
  });
  const socket = new FakeSocket();
  const errors: Error[] = [];
  createWebSocketHints$({
    session$: sessions,
    url: () => 'ws://127.0.0.1/hints',
    create: () => socket,
    maxMessageBytes: 4,
    retryAttempts: 0,
  }).subscribe({ error: (error) => errors.push(error as Error) });
  socket.emit('message', { data: '12345' });
  assert.match(errors[0]?.message ?? '', /configured limit/);
  assert.equal(socket.closed, true);
  sessions.complete();
});

"""
tests = tests.replace(marker, new_tests + marker)
test_path.write_text(tests, encoding='utf-8')
