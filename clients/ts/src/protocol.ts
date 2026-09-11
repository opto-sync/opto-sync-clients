import type { LocalMutation } from './client.js';
import type { JsonRecord } from './reconcile-core.js';

export interface ProtocolMutationOptions {
  baseRevision?: string;
  resurrect?: boolean;
  /** Canonical or aliased consistency policy stored on the durable intent. */
  consistencyPolicy?: string;
}

export interface PushMutation {
  mutationId: string;
  operation: 'upsert' | 'delete';
  table: string;
  recordId: string;
  payload?: JsonRecord;
  baseRevision?: string;
  resurrect?: boolean;
}

export interface PushRequest {
  protocolVersion: 1;
  clientId: string;
  mutations: PushMutation[];
}

export interface MutationResult {
  mutationId: string;
  status: 'applied' | 'duplicate' | 'rejected';
  originalStatus?: 'applied' | 'rejected';
  checkpoint?: string;
  revision?: string;
  code?: string;
  message?: string;
}

export interface PushResponse {
  protocolVersion: 1;
  clientId: string;
  lastMutationId: string;
  checkpoint: string;
  results: MutationResult[];
}

export interface Change {
  checkpoint: string;
  table: string;
  recordId: string;
  operation: 'upsert' | 'delete';
  record: JsonRecord | null;
  revision: string;
  source?: { clientId: string; mutationId: string };
}

export interface PullResponse {
  protocolVersion: 1;
  checkpoint: string;
  hasMore: boolean;
  changes: Change[];
}

export interface SnapshotRecord {
  table: string;
  recordId: string;
  record: JsonRecord;
  revision: string;
}

export interface SnapshotResponse {
  protocolVersion: 1;
  checkpoint: string;
  records: SnapshotRecord[];
}

const decimal = /^(?:0|[1-9]\d*)$/;
const positiveDecimal = /^[1-9]\d*$/;

function requireDecimal(
  value: string | undefined,
  name: string,
  allowZero = true,
): string {
  if (
    value === undefined ||
    !decimal.test(value) ||
    (!allowZero && value === '0')
  ) {
    throw new Error(
      `${name} must be a canonical ${allowZero ? 'unsigned' : 'positive'} decimal string`,
    );
  }
  return value;
}

/**
 * Convert a stable snapshot of pending Dexie rows into a protocol v1 batch.
 *
 * Rows missing v3 mutation identity are refused: sending them with fabricated
 * ids would let a retry alias different content. Migrate them explicitly in
 * application code or drain them through the legacy endpoint first.
 */
export function buildPushRequest(
  clientId: string,
  pending: readonly LocalMutation[],
  defaults: ProtocolMutationOptions = {},
  limit = 100,
): PushRequest {
  if (!clientId || limit < 1 || limit > 100 || !Number.isInteger(limit)) {
    throw new Error(
      'clientId must be non-empty and limit must be an integer from 1 to 100',
    );
  }
  const rows = pending.slice(0, limit);
  const mutations = rows.map((row, index): PushMutation => {
    if (row.clientId !== clientId) {
      throw new Error(
        `pending row ${row.id ?? index} belongs to a different client`,
      );
    }
    const mutationId = requireDecimal(
      row.mutationId === undefined ? undefined : String(row.mutationId),
      'mutationId',
      false,
    );
    if (index > 0) {
      const prior = BigInt(rows[index - 1].mutationId as string | number);
      if (BigInt(mutationId) !== prior + 1n) {
        throw new Error(
          'pending protocol mutations must be contiguous and insertion ordered',
        );
      }
    }

    const operation = row.operation ?? 'upsert';
    const mutation: PushMutation = {
      mutationId,
      operation,
      table: row.tableName,
      recordId: row.recordId,
      baseRevision: row.baseRevision ?? defaults.baseRevision,
    };
    if (operation === 'upsert') {
      const payload: unknown = JSON.parse(row.jsonPayload);
      if (
        payload === null ||
        Array.isArray(payload) ||
        typeof payload !== 'object'
      ) {
        throw new Error(`mutation ${mutationId} payload must be a JSON object`);
      }
      mutation.payload = payload as JsonRecord;
      if (row.resurrect ?? defaults.resurrect) mutation.resurrect = true;
    }
    return mutation;
  });
  return { protocolVersion: 1, clientId, mutations };
}

/**
 * Prove that an acknowledgement covers exactly the immutable batch sent.
 *
 * A watermark alone is not sufficient: accepting a watermark beyond the
 * request could discard locally queued mutations the server never received.
 */
export function validatePushResponse(
  request: PushRequest,
  response: PushResponse,
): void {
  if (
    request.protocolVersion !== 1 ||
    request.mutations.length === 0 ||
    response.protocolVersion !== 1 ||
    response.clientId !== request.clientId ||
    !decimal.test(response.lastMutationId) ||
    !decimal.test(response.checkpoint) ||
    !Array.isArray(response.results) ||
    response.results.length !== request.mutations.length ||
    response.lastMutationId !==
      request.mutations[request.mutations.length - 1].mutationId
  ) {
    throw new Error('push acknowledgement does not match the sent batch');
  }

  for (let index = 0; index < request.mutations.length; index += 1) {
    const expected = request.mutations[index];
    const result = response.results[index];
    if (
      result === null ||
      typeof result !== 'object' ||
      result.mutationId !== expected.mutationId ||
      !['applied', 'duplicate', 'rejected'].includes(result.status) ||
      (result.checkpoint !== undefined && !decimal.test(result.checkpoint)) ||
      (result.revision !== undefined && !positiveDecimal.test(result.revision)) ||
      (result.originalStatus !== undefined &&
        !['applied', 'rejected'].includes(result.originalStatus)) ||
      (result.status === 'duplicate') !==
        (result.originalStatus !== undefined)
    ) {
      throw new Error('push acknowledgement does not match the sent batch');
    }
  }
}
