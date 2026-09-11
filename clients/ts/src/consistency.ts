/**
 * Versioned, wire-neutral consistency policy identifiers and the pure
 * local-plus-remote read reconciliation used by every opto-sync client.
 *
 * Durable mutation intent stores the canonical policy id. Legacy caller names
 * (`background`, `local-first`, `await-server`, `remote-confirmed`, …) map
 * onto those identifiers; they are never written back as the stored identity.
 */

export const CONSISTENCY_POLICY = Object.freeze({
  remoteAcknowledged: 'opto.consistency.remote-acknowledged.v1',
  writeThroughLocalFirst: 'opto.consistency.write-through-local-first.v1',
  queuedLocalFirst: 'opto.consistency.queued-local-first.v1',
} as const);

export type ConsistencyPolicyId =
  (typeof CONSISTENCY_POLICY)[keyof typeof CONSISTENCY_POLICY];

const POLICY_SET: ReadonlySet<string> = new Set(
  Object.values(CONSISTENCY_POLICY),
);

const POLICY_ALIASES: Readonly<Record<string, ConsistencyPolicyId>> =
  Object.freeze({
    'opto.consistency.remote-acknowledged.v1':
      CONSISTENCY_POLICY.remoteAcknowledged,
    'remote-acknowledged': CONSISTENCY_POLICY.remoteAcknowledged,
    strict: CONSISTENCY_POLICY.remoteAcknowledged,
    'remote-confirmed': CONSISTENCY_POLICY.remoteAcknowledged,
    'await-server': CONSISTENCY_POLICY.remoteAcknowledged,
    'opto.consistency.write-through-local-first.v1':
      CONSISTENCY_POLICY.writeThroughLocalFirst,
    'write-through-local-first': CONSISTENCY_POLICY.writeThroughLocalFirst,
    'local-then-remote': CONSISTENCY_POLICY.writeThroughLocalFirst,
    'local-first': CONSISTENCY_POLICY.writeThroughLocalFirst,
    'opto.consistency.queued-local-first.v1':
      CONSISTENCY_POLICY.queuedLocalFirst,
    'queued-local-first': CONSISTENCY_POLICY.queuedLocalFirst,
    'local-durable': CONSISTENCY_POLICY.queuedLocalFirst,
    background: CONSISTENCY_POLICY.queuedLocalFirst,
  });

export type OutcomeStatus =
  | 'confirmed'
  | 'pending'
  | 'rejected'
  | 'transformed'
  | 'ambiguous'
  | 'cancelled';

export type OverlayStatus = 'pending' | 'rejected' | 'transformed';

export type Provenance =
  | 'authoritative'
  | 'pending'
  | 'rejected'
  | 'transformed'
  | 'stale';

export type RecordOperation = 'upsert' | 'delete';

export class UnknownConsistencyPolicyError extends Error {
  readonly code = 'UNKNOWN_CONSISTENCY_POLICY' as const;
  constructor(public readonly identifier: string) {
    super(
      `unknown consistency policy ${JSON.stringify(identifier)}; expected one of ${[...POLICY_SET].join(', ')}`,
    );
    this.name = 'UnknownConsistencyPolicyError';
  }
}

export class FrozenMutationIntentError extends Error {
  readonly code = 'FROZEN_MUTATION_INTENT' as const;
  constructor(message = 'queued mutation intent is immutable') {
    super(message);
    this.name = 'FrozenMutationIntentError';
  }
}

export interface MutationIntent {
  clientId: string;
  mutationId: string;
  table: string;
  recordId: string;
  operation: RecordOperation;
  payload?: Record<string, unknown>;
  baseRevision?: string;
  resurrect?: boolean;
  consistencyPolicy: ConsistencyPolicyId;
}

export interface ConsistencyOutcome {
  status: OutcomeStatus;
  consistencyPolicy: ConsistencyPolicyId;
  coveredMutationIds?: readonly string[];
  message?: string;
}

export interface ProtocolIdentity {
  clientId: string;
  mutationId: string;
}

export interface BaseRow {
  table: string;
  recordId: string;
  revision: string;
  operation: RecordOperation;
  payload?: Record<string, unknown>;
  identity?: ProtocolIdentity;
  arrivalSeq?: number;
}

export interface OverlayEntry {
  mutationId: string;
  clientId: string;
  table: string;
  recordId: string;
  operation: RecordOperation;
  payload?: Record<string, unknown>;
  revision?: string;
  consistencyPolicy: ConsistencyPolicyId | string;
  status: OverlayStatus;
  transformedPayload?: Record<string, unknown>;
}

export interface ProjectedRow {
  table: string;
  recordId: string;
  revision: string;
  operation: RecordOperation;
  payload?: Record<string, unknown>;
  provenance: Provenance;
}

export interface ReadReconciliationInput {
  localBase: readonly BaseRow[];
  overlay: readonly OverlayEntry[];
  remote?: readonly BaseRow[];
  acknowledgedMutationIds?: readonly string[];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalizeConsistencyPolicy(
  identifier: string,
): ConsistencyPolicyId {
  const canonical = POLICY_ALIASES[identifier];
  if (!canonical) {
    throw new UnknownConsistencyPolicyError(identifier);
  }
  return canonical;
}

export function isConsistencyPolicyId(
  identifier: string,
): identifier is ConsistencyPolicyId {
  return POLICY_SET.has(identifier);
}

function recordKey(table: string, recordId: string): string {
  return `${table}\0${recordId}`;
}

function compareDecimal(left: string, right: string): number {
  const leftOk = /^(?:0|[1-9]\d*)$/.test(left);
  const rightOk = /^(?:0|[1-9]\d*)$/.test(right);
  const a = leftOk ? left : '0';
  const b = rightOk ? right : '0';
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function clonePayload(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function toProjected(row: BaseRow, provenance: Provenance): ProjectedRow {
  const projected: ProjectedRow = {
    table: row.table,
    recordId: row.recordId,
    revision: row.revision,
    operation: row.operation,
    provenance,
  };
  if (row.payload) projected.payload = clonePayload(row.payload);
  return projected;
}

/**
 * Refuse any change to identity or content of an already queued mutation.
 * Canonical policy aliases of the stored identifier are treated as identical.
 */
export function assertQueuedIntentFrozen(
  existing: MutationIntent,
  proposed: MutationIntent,
): void {
  const existingPolicy = canonicalizeConsistencyPolicy(
    existing.consistencyPolicy,
  );
  const proposedPolicy = canonicalizeConsistencyPolicy(
    proposed.consistencyPolicy,
  );
  const same =
    existing.clientId === proposed.clientId &&
    existing.mutationId === proposed.mutationId &&
    existing.table === proposed.table &&
    existing.recordId === proposed.recordId &&
    existing.operation === proposed.operation &&
    (existing.baseRevision ?? '') === (proposed.baseRevision ?? '') &&
    Boolean(existing.resurrect) === Boolean(proposed.resurrect) &&
    existingPolicy === proposedPolicy &&
    stableJson(existing.payload ?? null) ===
      stableJson(proposed.payload ?? null);
  if (!same) {
    throw new FrozenMutationIntentError(
      `queued mutation ${existing.clientId}/${existing.mutationId} cannot change identity or content`,
    );
  }
}

export function outcomeForNetwork(
  policy: ConsistencyPolicyId | string,
  network:
    | 'acked'
    | 'rejected'
    | 'transformed'
    | 'response-lost'
    | 'cancelled'
    | 'not-attempted',
  coveredMutationIds: readonly string[] = [],
): ConsistencyOutcome {
  const consistencyPolicy = canonicalizeConsistencyPolicy(policy);
  if (network === 'cancelled') {
    return { status: 'cancelled', consistencyPolicy };
  }
  if (consistencyPolicy === CONSISTENCY_POLICY.queuedLocalFirst) {
    return { status: 'pending', consistencyPolicy };
  }
  if (network === 'not-attempted') {
    return { status: 'pending', consistencyPolicy };
  }
  if (network === 'response-lost') {
    return {
      status: 'ambiguous',
      consistencyPolicy,
      message: 'committed-but-response-lost',
    };
  }
  if (network === 'rejected') {
    return { status: 'rejected', consistencyPolicy, coveredMutationIds };
  }
  if (network === 'transformed') {
    return { status: 'transformed', consistencyPolicy, coveredMutationIds };
  }
  return { status: 'confirmed', consistencyPolicy, coveredMutationIds };
}

function selectRemoteWinner(rows: readonly BaseRow[]): BaseRow {
  return rows.reduce((winner, candidate) => {
    const byRevision = compareDecimal(candidate.revision, winner.revision);
    if (byRevision > 0) return candidate;
    if (byRevision < 0) return winner;
    const candidateId = candidate.identity?.mutationId ?? '';
    const winnerId = winner.identity?.mutationId ?? '';
    if (candidateId !== winnerId) {
      return candidateId < winnerId ? candidate : winner;
    }
    return winner;
  });
}

/**
 * Deterministic local-plus-remote read reconciliation.
 *
 * Local base is applied first. Remote rows merge by protocol revision (and
 * mutation identity on ties), never by arrival time. Absence is not deletion.
 * Overlay entries keep insertion order. Remote-acknowledged pending work stays
 * off the projected payload until confirmation. Exact-batch acknowledgement
 * removes only the named mutation identities.
 */
export function reconcileReadModel(
  input: ReadReconciliationInput,
): ProjectedRow[] {
  const working = new Map<string, ProjectedRow>();
  for (const row of input.localBase) {
    working.set(recordKey(row.table, row.recordId), toProjected(row, 'authoritative'));
  }

  if (input.remote && input.remote.length > 0) {
    const grouped = new Map<string, BaseRow[]>();
    for (const row of input.remote) {
      const key = recordKey(row.table, row.recordId);
      const group = grouped.get(key);
      if (group) group.push(row);
      else grouped.set(key, [row]);
    }
    for (const [key, group] of grouped) {
      const remote = selectRemoteWinner(group);
      const local = working.get(key);
      if (!local) {
        working.set(key, toProjected(remote, 'authoritative'));
        continue;
      }
      if (compareDecimal(remote.revision, local.revision) <= 0) {
        continue;
      }
      working.set(key, toProjected(remote, 'authoritative'));
    }
  }

  const acknowledged = new Set(input.acknowledgedMutationIds ?? []);
  for (const entry of input.overlay) {
    if (acknowledged.has(entry.mutationId)) continue;
    const policy = canonicalizeConsistencyPolicy(entry.consistencyPolicy);
    const hidePendingProjection =
      entry.status === 'pending' &&
      policy === CONSISTENCY_POLICY.remoteAcknowledged;
    if (hidePendingProjection) continue;

    const key = recordKey(entry.table, entry.recordId);
    const payload =
      entry.status === 'transformed'
        ? clonePayload(entry.transformedPayload ?? entry.payload)
        : clonePayload(entry.payload);
    const projected: ProjectedRow = {
      table: entry.table,
      recordId: entry.recordId,
      revision: entry.revision ?? working.get(key)?.revision ?? '0',
      operation: entry.operation,
      provenance: entry.status,
    };
    if (payload) projected.payload = payload;
    working.set(key, projected);
  }

  return [...working.values()].sort((left, right) => {
    const table = left.table.localeCompare(right.table);
    if (table !== 0) return table;
    return left.recordId.localeCompare(right.recordId);
  });
}

export const META_INTENT_POLICY_PREFIX = 'intent.policy.';

export function intentPolicyMetaKey(mutationId: string): string {
  return `${META_INTENT_POLICY_PREFIX}${mutationId}`;
}
