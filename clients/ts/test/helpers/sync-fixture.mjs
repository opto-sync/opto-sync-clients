/**
 * A minimal but protocol-correct opto-sync backend, for browser tests.
 *
 * The point of this fixture is that assertions can be made against what the
 * SERVER actually received rather than against spies inside the page. "Exactly
 * one tab drained the queue" and "`await-server` did not resolve before the
 * server confirmed" are both statements about the server's log, so the server
 * has to be real enough to keep one.
 *
 * It implements just enough of protocol v1 to satisfy `validatePushResponse`
 * and the sync loop's pull/checkpoint handling:
 *   POST /sync/push  -> PushResponse
 *   POST /sync/pull  -> PullResponse (always empty; these tests only push)
 *   GET  /sync/log   -> the recorded request log, for assertions
 *   POST /sync/gate  -> open/close the ack gate (consistency-mode tests)
 */

/** @returns {{route: Function, log: object, openGate: () => void}} */
export function createSyncFixture() {
  /** Every push batch the server received, in arrival order. */
  const pushes = [];
  /** mutationId -> number of times it arrived (any client). */
  const deliveries = new Map();
  /** Set once a mutation has been applied, so replays answer 'duplicate'. */
  const applied = new Set();
  let checkpoint = 0n;

  /** While closed, /sync/push parks instead of answering. */
  let gateOpen = true;
  let waiters = [];
  const gate = () =>
    gateOpen ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve));
  const openGate = () => {
    gateOpen = true;
    for (const resolve of waiters) resolve();
    waiters = [];
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 4_000_000) reject(new Error('fixture body too large'));
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(raw || '{}'));
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const handlePush = async (req, res) => {
    const request = await readBody(req);
    // Record BEFORE the gate: a request that arrived but has not been answered
    // must still be visible to the test, otherwise "the server has seen it but
    // not confirmed it" cannot be distinguished from "never sent".
    const key = (mutationId) => `${request.clientId}/${mutationId}`;
    pushes.push({
      clientId: request.clientId,
      mutationIds: request.mutations.map((m) => m.mutationId),
      receivedAt: Date.now(),
    });
    for (const mutation of request.mutations) {
      deliveries.set(key(mutation.mutationId), (deliveries.get(key(mutation.mutationId)) ?? 0) + 1);
    }

    await gate();

    const results = request.mutations.map((mutation) => {
      checkpoint += 1n;
      const id = key(mutation.mutationId);
      if (applied.has(id)) {
        return {
          mutationId: mutation.mutationId,
          status: 'duplicate',
          originalStatus: 'applied',
          checkpoint: checkpoint.toString(),
        };
      }
      applied.add(id);
      return {
        mutationId: mutation.mutationId,
        status: 'applied',
        checkpoint: checkpoint.toString(),
        revision: checkpoint.toString(),
      };
    });

    json(res, 200, {
      protocolVersion: 1,
      clientId: request.clientId,
      lastMutationId: request.mutations[request.mutations.length - 1].mutationId,
      checkpoint: checkpoint.toString(),
      results,
    });
  };

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {boolean} true when this fixture answered the request
   */
  const route = (req, res) => {
    const url = (req.url ?? '').split('?')[0];
    if (url === '/sync/push') {
      handlePush(req, res).catch((error) => json(res, 500, { error: String(error) }));
      return true;
    }
    if (url === '/sync/pull') {
      json(res, 200, {
        protocolVersion: 1,
        checkpoint: checkpoint.toString(),
        hasMore: false,
        changes: [],
      });
      return true;
    }
    if (url === '/sync/log') {
      json(res, 200, {
        pushes,
        duplicateDeliveries: [...deliveries.entries()]
          .filter(([, count]) => count > 1)
          .map(([id, count]) => ({ id, count })),
        distinctMutations: deliveries.size,
      });
      return true;
    }
    if (url === '/sync/gate') {
      openGate();
      json(res, 200, { ok: true });
      return true;
    }
    return false;
  };

  return {
    route,
    openGate,
    closeGate() {
      gateOpen = false;
    },
    get pushes() {
      return pushes;
    },
    /** Batches whose mutation ids arrived more than once, across all tabs. */
    get duplicateDeliveries() {
      return [...deliveries.entries()].filter(([, count]) => count > 1);
    },
    get deliveredMutationIds() {
      return [...deliveries.keys()];
    },
  };
}

/**
 * Page-side source for a transport that speaks to {@link createSyncFixture}.
 *
 * Injected into the browser as a string and evaluated there, so the real
 * `ProtocolSyncLoop` drives real `fetch` calls over a real origin.
 */
export const FIXTURE_TRANSPORT_SOURCE = `
  window.makeFixtureTransport = () => ({
    async push(request, signal) {
      const response = await fetch('/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
      if (!response.ok) throw new Error('push failed: ' + response.status);
      return response.json();
    },
    async pull(checkpoint, limit, signal) {
      const response = await fetch('/sync/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkpoint, limit }),
        signal,
      });
      if (!response.ok) throw new Error('pull failed: ' + response.status);
      return response.json();
    },
    async snapshot() {
      return { protocolVersion: 1, checkpoint: '0', records: [] };
    },
  });
  window.noopCallbacks = () => ({
    async applyChanges() {},
    async replaceAuthoritative() {},
  });
`;
