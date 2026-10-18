/**
 * Versioned, transport-independent immutable application transaction receipt.
 * This is a policy layer, NOT a same-store SQLite/IndexedDB group constructor.
 */
export type TransactionCapability = 'atomic' | 'ordered' | 'unsupported';
export type MutationOutcome = 'accepted' | 'rejected';
export interface GroupMember {
  mutationId: string;
  table: string;
  recordId: string;
  operation: 'insert' | 'update' | 'delete';
  payloadDigest: string;
}
export interface TransactionGroup {
  version: 1;
  groupId: string;
  members: readonly Readonly<GroupMember>[];
}
export interface GroupReceipt {
  groupId: string;
  status: 'committed' | 'rejected' | 'response_lost';
  outcomes?: readonly { mutationId: string; outcome: MutationOutcome }[];
}
export interface GroupDecision {
  status: 'committed' | 'rejected' | 'partially_resolved' | 'ambiguous';
  resolvedIds: readonly string[];
  rejectedIds: readonly string[];
}
export class GroupContractError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'GroupContractError'; }
}
const fail = (code: string): never => { throw new GroupContractError(code); };
const isId = (v: string): boolean => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const isDigest = (v: string): boolean => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

export function makeTransactionGroup(groupId: string, input: readonly GroupMember[]): TransactionGroup {
  if (!isId(groupId)) fail('invalid_group_id');
  if (!Array.isArray(input) || input.length < 2 || input.length > 256) fail('invalid_group_size');
  const seen = new Set<string>();
  const members = input.map((member) => {
    if (!isId(member.mutationId) || !isId(member.table) || !isId(member.recordId)
      || !['insert','update','delete'].includes(member.operation) || !isDigest(member.payloadDigest)) {
      return fail('invalid_member');
    }
    if (seen.has(member.mutationId)) return fail('duplicate_mutation_id');
    seen.add(member.mutationId);
    return Object.freeze({mutationId: member.mutationId, table: member.table,
      recordId: member.recordId, operation: member.operation, payloadDigest: member.payloadDigest});
  });
  return Object.freeze({ version: 1 as const, groupId, members: Object.freeze(members) });
}

/** Exact membership/order/content is immutable across retry, batching and restart. */
export function assertSameTransactionGroup(expected: TransactionGroup, replay: TransactionGroup): void {
  if (expected.groupId !== replay.groupId ||
      JSON.stringify(expected) !== JSON.stringify(replay)) fail('group_identity_reused');
}

/** Do not derive a group outcome from a transport batch or missing response. */
export function decideTransactionGroup(
  group: TransactionGroup, capability: TransactionCapability, receipt: GroupReceipt,
): GroupDecision {
  if (capability === 'unsupported') fail('atomicity_not_negotiated');
  if (receipt.groupId !== group.groupId) fail('wrong_group');
  if (receipt.status === 'response_lost') {
    if (receipt.outcomes?.length) fail('ambiguous_with_outcomes');
    return Object.freeze({status: 'ambiguous', resolvedIds: [], rejectedIds: []});
  }
  const outcomes = receipt.outcomes;
  if (!outcomes || outcomes.length !== group.members.length) {
    throw new GroupContractError('non_exact_ack');
  }
  const ids = group.members.map(m => m.mutationId);
  for (let i = 0; i < ids.length; ++i) {
    if (outcomes[i].mutationId !== ids[i] ||
      !['accepted','rejected'].includes(outcomes[i].outcome)) fail('non_exact_ack');
  }
  const accepted = outcomes.filter(o => o.outcome === 'accepted').map(o => o.mutationId);
  const rejected = outcomes.filter(o => o.outcome === 'rejected').map(o => o.mutationId);
  if (capability === 'atomic' && accepted.length !== 0 && rejected.length !== 0) {
    fail('atomic_partial_ack');
  }
  if (receipt.status === 'committed' && accepted.length !== ids.length) fail('status_outcome_mismatch');
  if (receipt.status === 'rejected' && rejected.length === 0) fail('status_outcome_mismatch');
  return Object.freeze({
    status: accepted.length === ids.length ? 'committed' :
      rejected.length === ids.length ? 'rejected' : 'partially_resolved',
    resolvedIds: Object.freeze(accepted),
    rejectedIds: Object.freeze(rejected),
  });
}
