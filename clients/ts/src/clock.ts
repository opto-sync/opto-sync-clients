/**
 * Hybrid Logical Clock (HLC) for ordering optimistic writes.
 *
 * ## Why this exists
 *
 * The merge engine resolves conflicts with last-write-wins on `updatedAt` (and,
 * if a caller opts into `fwwKeys`, first-write-wins on those keys). That is only
 * correct if the timestamps it compares are actually ordered. A raw device wall
 * clock is not:
 *
 * - **Skew.** A device whose clock runs 5 minutes fast wins *every* conflict,
 *   permanently, even when its edit is genuinely older. The other device's
 *   fresh edits are silently discarded as "stale".
 * - **Rollback.** NTP corrections, manual changes, and suspend/resume can move
 *   a clock backwards. A device that does this writes timestamps that lose to
 *   its own earlier writes, so its edits silently vanish.
 * - **Ties.** Two writes with the same millisecond are neither newer, so the
 *   engine falls through to a plain merge and the *arrival order* decides. That
 *   makes the result non-convergent: two replicas applying the same two writes
 *   in different orders end up different.
 *
 * An HLC fixes all three. It tracks the physical clock but never moves
 * backwards, carries a logical counter to break ties within a millisecond, and
 * embeds a node id so no two nodes can ever produce the same timestamp — which
 * gives a **total order**, and therefore convergence.
 *
 * ## Wire format
 *
 * `<13-digit millis>-<4-hex counter>-<node id>`, e.g. `1721822400000-0000-9f3a2b`
 *
 * Fixed-width components on purpose: the merge engine compares non-digit
 * strings lexicographically, so fixed width makes lexicographic order equal
 * chronological order. Do not "optimize" the padding away.
 *
 * 13 digits covers milliseconds through the year 2286. Past that the width
 * grows and lexicographic ordering would break; a future major version should
 * widen the field rather than let it overflow.
 *
 * ## What this does NOT solve
 *
 * An HLC orders writes consistently; it does not make a client's clock
 * *accurate*. A device hours off still stamps writes hours off, and a
 * server-authoritative timestamp is strictly better when the server sees the
 * write. Prefer server stamping for `syncedAt` and use the HLC for the
 * client-side `updatedAt` that must exist before the server ever sees it.
 */

const MILLIS_DIGITS = 13;
const COUNTER_DIGITS = 4;
const MAX_COUNTER = 0xffff;

export interface HlcParts {
  millis: number;
  counter: number;
  nodeId: string;
}

/** Storage for the clock's last state, so it survives a reload. */
export interface HlcPersistence {
  load(): Promise<string | null> | string | null;
  save(timestamp: string): Promise<void> | void;
}

/**
 * How far ahead of local physical time an observed remote timestamp may be
 * before it is refused. Without a bound, `observe()` adopts any remote value,
 * so ONE client with a broken or hostile clock poisons every clock that syncs
 * with it — and every honest write then loses to the poisoned timestamp
 * forever. Reference implementations all bound this: jlongster/Actual uses
 * 60s, uhlc-rs defaults to 500ms.
 */
export const DEFAULT_MAX_DRIFT_MS = 60_000;

export class ClockDriftError extends Error {
  constructor(readonly remote: string, readonly driftMs: number, readonly maxDriftMs: number) {
    super(
      `remote timestamp ${remote} is ${driftMs}ms ahead of local time ` +
        `(max ${maxDriftMs}ms); refusing to adopt it`,
    );
    this.name = 'ClockDriftError';
  }
}

export interface HybridLogicalClockOptions {
  /**
   * Stable identifier for this client install. Two clients must never share
   * one, or their timestamps can collide and the total order is lost.
   */
  nodeId: string;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Optional durable storage; without it the clock resets on reload. */
  persistence?: HlcPersistence;
  /** Refuse remote timestamps further ahead than this. See DEFAULT_MAX_DRIFT_MS. */
  maxDriftMs?: number;
}

function pad(value: number, digits: number, radix: number): string {
  return value.toString(radix).padStart(digits, '0');
}

export function formatHlc(parts: HlcParts): string {
  if (
    !Number.isSafeInteger(parts.millis) ||
    parts.millis < 0 ||
    parts.millis > 9_999_999_999_999
  ) {
    throw new RangeError('HLC millis must be a non-negative 13-digit integer');
  }
  if (!Number.isInteger(parts.counter) || parts.counter < 0 || parts.counter > MAX_COUNTER) {
    throw new RangeError('HLC counter must be an integer from 0 through 65535');
  }
  if (!parts.nodeId || parts.nodeId.includes('-')) {
    throw new TypeError('HLC nodeId must be non-empty and contain no "-"');
  }
  return `${pad(parts.millis, MILLIS_DIGITS, 10)}-${pad(parts.counter, COUNTER_DIGITS, 16)}-${parts.nodeId}`;
}

/** Returns null for anything that is not an HLC produced by this module. */
export function parseHlc(timestamp: string): HlcParts | null {
  const m = /^(\d{13})-([0-9a-f]{4})-([^-]+)$/.exec(timestamp);
  if (!m) return null;
  return { millis: Number(m[1]), counter: parseInt(m[2], 16), nodeId: m[3] };
}

/** Total order over HLC strings. Lexicographic, because the format is fixed-width. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compose a per-writer node id from a durable device id and a per-instance
 * suffix.
 *
 * The suffix is essential and easy to miss: several browser tabs share one
 * IndexedDB, so they would share a persisted device id, read the same clock
 * state, and issue *identical* timestamps — which reintroduces exactly the tie
 * that the node id exists to prevent. Replicache solves the same problem with
 * per-tab "client groups". Each clock instance therefore gets its own suffix.
 *
 * Separator is `.` because `-` delimits the wire format.
 */
export function composeNodeId(deviceId: string, instanceSuffix = randomNodeId(3)): string {
  return `${deviceId}.${instanceSuffix}`;
}

/**
 * Generate a random id with the platform's CSPRNG. Persist the DEVICE id — a
 * client that regenerates it on every load loses consistent tie-breaking
 * against its own past writes.
 */
export function randomNodeId(byteLength = 6): string {
  const bytes = new Uint8Array(byteLength);
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    // Non-cryptographic fallback for exotic runtimes. Collision risk is what
    // matters here, not unpredictability, but prefer the CSPRNG when present.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class HybridLogicalClock {
  readonly nodeId: string;
  private readonly nowFn: () => number;
  private readonly persistence?: HlcPersistence;
  private readonly maxDriftMs: number;
  private millis = 0;
  private counter = 0;

  constructor(options: HybridLogicalClockOptions) {
    if (!options.nodeId) throw new Error('HybridLogicalClock requires a stable nodeId');
    if (options.nodeId.includes('-')) {
      // The wire format is split on '-', so a node id containing one would
      // make parseHlc ambiguous.
      throw new Error(`nodeId must not contain "-": ${options.nodeId}`);
    }
    this.nodeId = options.nodeId;
    this.nowFn = options.now ?? Date.now;
    this.persistence = options.persistence;
    this.maxDriftMs = options.maxDriftMs ?? DEFAULT_MAX_DRIFT_MS;
  }

  /**
   * Restore the last issued timestamp so the clock cannot go backwards across
   * a reload. Call once before issuing timestamps.
   */
  async restore(): Promise<void> {
    const saved = await this.persistence?.load();
    if (!saved) return;
    const parts = parseHlc(saved);
    if (!parts) return;
    this.millis = parts.millis;
    this.counter = parts.counter;
  }

  /** Current state without advancing. */
  peek(): HlcParts {
    return { millis: this.millis, counter: this.counter, nodeId: this.nodeId };
  }

  /**
   * Issue the next timestamp. Strictly greater than every timestamp this clock
   * has issued or observed, even if the wall clock jumped backwards.
   */
  async next(): Promise<string> {
    const physical = this.nowFn();
    if (physical > this.millis) {
      this.millis = physical;
      this.counter = 0;
    } else {
      // Wall clock stalled or went backwards: keep logical time moving.
      this.counter += 1;
      if (this.counter > MAX_COUNTER) {
        this.millis += 1;
        this.counter = 0;
      }
    }
    const ts = formatHlc(this.peek());
    await this.persistence?.save(ts);
    return ts;
  }

  /**
   * Advance past a timestamp observed from another node, so our next write
   * outranks anything we have already seen. This is what makes the clock
   * *hybrid* — it respects causality, not just local time.
   *
   * Ignores values that are not HLCs from this module (a plain epoch number or
   * an ISO string from a legacy writer), because their scale is not comparable.
   */
  async observe(remoteTimestamp: string): Promise<void> {
    const remote = parseHlc(remoteTimestamp);
    if (!remote) return;

    // Bounded trust: a timestamp far in the future is a broken or hostile
    // clock, not causality. Adopting it would make every honest write lose to
    // it indefinitely, so fail loudly instead of silently propagating it.
    const drift = remote.millis - this.nowFn();
    if (drift > this.maxDriftMs) {
      throw new ClockDriftError(remoteTimestamp, drift, this.maxDriftMs);
    }

    if (remote.millis > this.millis) {
      this.millis = remote.millis;
      this.counter = remote.counter;
    } else if (remote.millis === this.millis && remote.counter > this.counter) {
      this.counter = remote.counter;
    } else {
      return; // already ahead
    }
    await this.persistence?.save(formatHlc(this.peek()));
  }
}
