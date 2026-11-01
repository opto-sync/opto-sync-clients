import "@typespec/json-schema";

using TypeSpec.JsonSchema;

@jsonSchema
namespace OptoSync.CheckpointBarrierV1;

/** Canonical non-negative decimal protocol checkpoint. */
@pattern("^(?:0|[1-9]\\d*)$")
scalar Checkpoint extends string;

/** A source position that represents all relevant commits before request completion. */
model AuthoritativeCheckpointTarget {
  protocolVersion: 1;
  checkpoint: Checkpoint;
  generation?: string;
}

/** Stable cross-runtime terminal codes for a caller-visible freshness wait. */
enum CaughtUpBarrierErrorCode {
  CAUGHT_UP_INVALID_TARGET,
  CAUGHT_UP_INVALID_LOCAL_CHECKPOINT,
  CAUGHT_UP_INVALIDATED,
  CAUGHT_UP_TIMEOUT,
  CAUGHT_UP_CANCELLED,
  CAUGHT_UP_OFFLINE,
}

/** Successful durable caught-up proof. */
model CaughtUpResult {
  targetCheckpoint: Checkpoint;
  checkpoint: Checkpoint;
  generation?: string;
  elapsedMs: uint64;
  cycles: uint32;
  alreadyCaughtUp: boolean;
}
