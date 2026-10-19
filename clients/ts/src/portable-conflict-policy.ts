/** Stable cross-language conflict-policy identity; no executable callbacks. */
export type PortablePolicyId = 'opto.lww.identity.v1' | 'opto.fww.identity.v1';
export interface PortablePolicy {
  readonly id: PortablePolicyId;
  readonly version: 1;
  readonly tieBreaker: 'mutation_id_utf16';
}
export interface ConflictCandidate {
  readonly mutationId: string;
  readonly logicalTime: string;
  readonly tombstone: boolean;
  readonly canonicalPayload: string;
}
export class UnsupportedPortablePolicyError extends Error {
  constructor() { super('unsupported_portable_conflict_policy'); }
}
const validId = (v: string) => /^[a-zA-Z0-9._:-]{1,128}$/.test(v);
const validTimestamp = (v: string) => /^(0|[1-9][0-9]{0,19})$/.test(v)
  && BigInt(v) <= 18446744073709551615n;

export function admitPortablePolicy(value: PortablePolicy): Readonly<PortablePolicy> {
  if (!value || value.version !== 1 ||
      !['opto.lww.identity.v1', 'opto.fww.identity.v1'].includes(value.id) ||
      value.tieBreaker !== 'mutation_id_utf16') {
    throw new UnsupportedPortablePolicyError();
  }
  return Object.freeze({id: value.id, version: 1 as const, tieBreaker: 'mutation_id_utf16' as const});
}
/** The same frozen policy must accompany a durable queued mutation replay. */
export function assertPortablePolicyFrozen(oldValue: PortablePolicy, replay: PortablePolicy): void {
  const oldPolicy = admitPortablePolicy(oldValue);
  const next = admitPortablePolicy(replay);
  if (JSON.stringify(oldPolicy) !== JSON.stringify(next)) throw new UnsupportedPortablePolicyError();
}
/** Tie ordering uses UTF-16 code units, not locale/arrival order. */
export function resolvePortableConflict(
  policy: PortablePolicy, left: ConflictCandidate, right: ConflictCandidate,
): ConflictCandidate {
  const admitted = admitPortablePolicy(policy);
  for (const candidate of [left, right]) {
    if (!validId(candidate.mutationId) || !validTimestamp(candidate.logicalTime) ||
        typeof candidate.tombstone !== 'boolean' || typeof candidate.canonicalPayload !== 'string') {
      throw new UnsupportedPortablePolicyError();
    }
  }
  const leftTime = BigInt(left.logicalTime);
  const rightTime = BigInt(right.logicalTime);
  const order = leftTime < rightTime ? -1 : leftTime > rightTime ? 1 :
    left.mutationId < right.mutationId ? -1 : left.mutationId > right.mutationId ? 1 :
      left.canonicalPayload < right.canonicalPayload ? -1 :
        left.canonicalPayload > right.canonicalPayload ? 1 : 0;
  return (admitted.id === 'opto.lww.identity.v1' ? order >= 0 : order <= 0) ? left : right;
}
