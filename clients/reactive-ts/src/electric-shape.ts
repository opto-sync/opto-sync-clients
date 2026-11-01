/**
 * Electric/Phoenix.Sync read-path bridge.
 *
 * Electric ShapeStream is supplied by the application: do not import a
 * particular @electric-sql/client version or create an unauthenticated stream.
 * This layer never sends writes or acknowledges Opto Sync mutations.
 */
export interface ElectricShapeCursor {
  version: 1;
  scopeKey: string;
  shapeHandle: string;
  offset: string;
}

export type ElectricShapeMessage<T extends Record<string, unknown>> = {
  key?: string;
  value?: T;
  headers: {
    operation?: 'insert' | 'update' | 'delete';
    control?: string;
    event?: string;
    txids?: number[];
  };
};

export interface ElectricShapeStream<T extends Record<string, unknown>> {
  readonly shapeHandle?: string;
  readonly lastOffset: string;
  subscribe(
    callback: (messages: ElectricShapeMessage<T>[]) => void | Promise<void>,
    onError?: (error: Error) => void,
  ): () => void;
}

export interface ElectricShapeChange<T extends Record<string, unknown>> {
  /** Opaque Electric row key; never guess an application recordId from it. */
  electricKey: string;
  operation: 'upsert' | 'delete';
  value: T | null;
  txids?: readonly number[];
}

export interface ElectricShapeBatch<T extends Record<string, unknown>> {
  /** Replace the authoritative shape subset, NOT the local mutation queue. */
  reset: boolean;
  changes: readonly ElectricShapeChange<T>[];
  /** Full authoritative snapshot is usable only after the up-to-date control. */
  complete: boolean;
  /** Null means invalidate persisted cursor within the same storage transaction. */
  cursor: ElectricShapeCursor | null;
}

export interface ElectricShapeBridgeOptions<T extends Record<string, unknown>> {
  stream: ElectricShapeStream<T>;
  scopeKey: string;
  /**
   * Previously committed cursor. The caller MUST have configured ShapeStream
   * with this same handle/offset before subscribing.
   */
  restoredCursor?: ElectricShapeCursor | null;
  /** Apply data and cursor together, atomically; preserve local queued writes. */
  transact: (batch: ElectricShapeBatch<T>) => Promise<void>;
  onError?: (error: Error) => void;
}

export interface ElectricShapeBridge {
  close(): void;
  /** Await pending processing; throws if the bridge failed. */
  idle(): Promise<void>;
}

function validCursor(cursor: ElectricShapeCursor): boolean {
  return cursor.version === 1 &&
    typeof cursor.scopeKey === 'string' && cursor.scopeKey.length > 0 &&
    cursor.scopeKey.length <= 256 &&
    typeof cursor.shapeHandle === 'string' && cursor.shapeHandle.length > 0 &&
    cursor.shapeHandle.length <= 512 &&
    typeof cursor.offset === 'string' && cursor.offset.length > 0 &&
    cursor.offset.length <= 256;
}

/**
 * Commit Electric batches sequentially. Do not use Electric offsets as protocol
 * push acknowledgements, revisions, or commit-ordered pull checkpoints.
 */
export function bridgeElectricShape<T extends Record<string, unknown>>(
  options: ElectricShapeBridgeOptions<T>,
): ElectricShapeBridge {
  const { stream, transact, scopeKey } = options;
  if (typeof scopeKey !== 'string' || scopeKey.length === 0 || scopeKey.length > 256) {
    throw new RangeError('invalid Electric shape scopeKey');
  }
  const restored = options.restoredCursor ?? null;
  if (restored && (!validCursor(restored) || restored.scopeKey !== scopeKey)) {
    throw new Error('Electric cursor does not match the authenticated shape scope');
  }
  if (restored && (stream.shapeHandle !== restored.shapeHandle ||
                   stream.lastOffset !== restored.offset)) {
    throw new Error('Electric stream was not constructed with the restored handle/offset');
  }

  let ready = restored !== null;
  let resetPending = restored === null;
  let lastCursor = restored;
  let closed = false;
  let failure: Error | null = null;
  let unsubscribe: (() => void) | undefined;
  let pending: Promise<void> = Promise.resolve();

  const fail = (error: unknown): void => {
    const e = error instanceof Error ? error : new Error(String(error));
    failure = e;
    closed = true;
    unsubscribe?.();
    try { options.onError?.(e); } catch { /* observers cannot change failure handling */ }
  };

  const process = async (
    messages: ElectricShapeMessage<T>[],
    observedHandle: string | undefined,
    observedOffset: string,
  ): Promise<void> => {
    if (closed) return;
    let reset = resetPending;
    let caughtUp = false;
    const changes: ElectricShapeChange<T>[] = [];
    for (const message of messages) {
      if (!message || !message.headers || typeof message.headers !== 'object') {
        throw new Error('malformed Electric message');
      }
      const { operation, control, event, txids } = message.headers;
      if ([operation, control, event].filter(x => x !== undefined).length !== 1) {
        throw new Error('Electric message has ambiguous header discriminator');
      }
      if (event !== undefined) {
        throw new Error('Electric subset move events require a separate adapter');
      }
      if (control !== undefined) {
        if (control === 'must-refetch') {
          // Any earlier changes in this callback belong to the stale shape.
          changes.length = 0;
          reset = true;
          caughtUp = false;
        } else if (control === 'up-to-date') {
          caughtUp = true;
        } else if (control === 'snapshot-end') {
          // Electric's snapshot-end marks a snapshot boundary but is not the
          // catch-up barrier; do not publish a resumable cursor yet.
        } else {
          throw new Error('unsupported Electric control message: ' + control);
        }
        continue;
      }
      if (operation !== 'insert' && operation !== 'update' && operation !== 'delete') {
        throw new Error('unsupported Electric change operation');
      }
      if (typeof message.key !== 'string' || message.key.length === 0) {
        throw new Error('Electric change requires an opaque row key');
      }
      if (operation !== 'delete' &&
          (!message.value || typeof message.value !== 'object' || Array.isArray(message.value))) {
        throw new Error('Electric upsert requires an object value');
      }
      if (txids !== undefined &&
          (!Array.isArray(txids) || txids.some((id) => !Number.isSafeInteger(id) || id < 0))) {
        throw new Error('invalid Electric txids');
      }
      changes.push({
        electricKey: message.key,
        operation: operation === 'delete' ? 'delete' : 'upsert',
        value: operation === 'delete' ? null : message.value!,
        ...(txids ? { txids: [...txids] } : {}),
      });
    }

    const complete = (reset ? false : ready) || caughtUp;
    if (complete && (!observedHandle || !observedOffset)) {
      throw new Error('Electric complete batch has no resumable shape handle/offset');
    }
    if (!reset && lastCursor && observedHandle &&
        lastCursor.shapeHandle !== observedHandle) {
      throw new Error('Electric handle changed without a must-refetch reset');
    }
    const cursor: ElectricShapeCursor | null = complete
      ? { version: 1, scopeKey, shapeHandle: observedHandle!, offset: observedOffset }
      : null;
    if (cursor && !validCursor(cursor)) {
      throw new Error('invalid Electric cursor from stream');
    }
    // A callback MUST atomically apply authoritative rows and persist (or clear)
    // the cursor. An interrupted snapshot remains non-resumable.
    await transact({ reset, changes, complete, cursor });
    lastCursor = cursor;
    ready = complete;
    resetPending = false;
  };

  const receive = (messages: ElectricShapeMessage<T>[]): Promise<void> => {
    // Electric's publisher rethrows rejected subscriber callbacks on a
    // microtask. Contain storage errors and expose them through idle/onError.
    if (closed) return Promise.resolve();
    // Capture immediately: later events may advance the mutable stream cursor.
    const handle = stream.shapeHandle;
    const offset = stream.lastOffset;
    pending = pending.then(() => process(messages, handle, offset)).catch(fail);
    return pending;
  };
  unsubscribe = stream.subscribe(receive, (error) => {
    if (!closed) {
      // Fatal rather than silently accepting a truncated stream.
      pending = pending.then(() => { throw error; }).catch(fail);
    }
  });
  if (closed) unsubscribe();
  return {
    close() { closed = true; unsubscribe?.(); },
    async idle() {
      await pending;
      if (failure) throw failure;
    },
  };
}
