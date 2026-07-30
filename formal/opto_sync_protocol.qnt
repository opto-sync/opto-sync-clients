// Executable model of the opto-sync protocol-v1 client/server lifecycle.
//
// This first model intentionally uses one client, one logical record stream, and
// three mutation identities. The small finite domain lets TLC exhaust the whole
// reachable state graph while retaining the failure modes that matter:
// committed-but-unacknowledged writes, duplicate retry, permanent rejection,
// malformed acknowledgements, compaction, snapshot reset, and crash recovery.
module opto_sync_protocol {
  type ResetPhase = Idle | Replacing

  // Mutation identities are strictly positive. Zero is an explicit sentinel for
  // "no request in flight" and for cleared response fields. Keeping these fields
  // first-order makes the model self-contained and avoids verifier-specific
  // Option helpers or partial unwrap operations.
  pure val NO_ID = 0
  pure val IDS = Set(1, 2, 3)
  pure val MAX_ID = 3

  type State = {
    next_id: int,
    pending: Set[int],
    in_flight: int,
    ledger: Set[int],
    applied: Set[int],
    rejected: Set[int],
    effect_count: int -> int,
    server_watermark: int,
    server_checkpoint: int,
    response_present: bool,
    response_mutation_id: int,
    response_watermark: int,
    response_checkpoint: int,
    response_valid_for_in_flight: bool,
    acknowledged: Set[int],
    local_checkpoint: int,
    retention_floor: int,
    reset_phase: ResetPhase,
    reset_pending_before: Set[int],
    reset_checkpoint_before: int,
    saw_lost_response: bool,
    saw_duplicate_reply: bool,
    saw_reset_crash: bool,
  }

  var s: State

  def is_oldest_pending(id) = and {
    s.pending.contains(id),
    s.pending.forall(other => id <= other),
  }

  action init = {
    s' = {
      next_id: 1,
      pending: Set(),
      in_flight: NO_ID,
      ledger: Set(),
      applied: Set(),
      rejected: Set(),
      effect_count: IDS.mapBy(_ => 0),
      server_watermark: 0,
      server_checkpoint: 0,
      response_present: false,
      response_mutation_id: NO_ID,
      response_watermark: 0,
      response_checkpoint: 0,
      response_valid_for_in_flight: false,
      acknowledged: Set(),
      local_checkpoint: 0,
      retention_floor: 0,
      reset_phase: Idle,
      reset_pending_before: Set(),
      reset_checkpoint_before: 0,
      saw_lost_response: false,
      saw_duplicate_reply: false,
      saw_reset_crash: false,
    }
  }

  // Allocate immutable client mutation identities contiguously.
  action enqueue = all {
    s.reset_phase == Idle,
    s.next_id <= MAX_ID,
    s' = {
      ...s,
      next_id: s.next_id + 1,
      pending: s.pending.union(Set(s.next_id)),
    },
  }

  // The client sends only its oldest queued mutation. It may send the next new
  // identity, or retry one whose commit became ambiguous because its response was
  // lost. Later mutations cannot overtake an unacknowledged predecessor.
  action send(id) = all {
    s.reset_phase == Idle,
    s.in_flight == NO_ID,
    not(s.response_present),
    is_oldest_pending(id),
    or {
      s.ledger.contains(id),
      id == s.server_watermark + 1,
    },
    s' = { ...s, in_flight: id },
  }

  // A new successful mutation atomically advances the ledger, effect, watermark,
  // pull checkpoint, and response. effect_count is deliberately a counter so the
  // no-double-apply property is not true merely because Set removes duplicates.
  action apply_new(id) = all {
    s.reset_phase == Idle,
    s.in_flight == id,
    not(s.response_present),
    id == s.server_watermark + 1,
    not(s.ledger.contains(id)),
    s' = {
      ...s,
      ledger: s.ledger.union(Set(id)),
      applied: s.applied.union(Set(id)),
      effect_count: s.effect_count.setBy(id, count => count + 1),
      server_watermark: id,
      server_checkpoint: s.server_checkpoint + 1,
      response_present: true,
      response_mutation_id: id,
      response_watermark: id,
      response_checkpoint: s.server_checkpoint + 1,
      response_valid_for_in_flight: true,
    },
  }

  // Permanent rejection is durable and advances the per-client watermark, but it
  // never executes the record effect. This prevents a poison mutation from
  // blocking every later mutation forever.
  action reject_new(id) = all {
    s.reset_phase == Idle,
    s.in_flight == id,
    not(s.response_present),
    id == s.server_watermark + 1,
    not(s.ledger.contains(id)),
    s' = {
      ...s,
      ledger: s.ledger.union(Set(id)),
      rejected: s.rejected.union(Set(id)),
      server_watermark: id,
      server_checkpoint: s.server_checkpoint + 1,
      response_present: true,
      response_mutation_id: id,
      response_watermark: id,
      response_checkpoint: s.server_checkpoint + 1,
      response_valid_for_in_flight: true,
    },
  }

  // An identical retry returns the durable result without executing the effect a
  // second time or allocating another checkpoint.
  action reply_duplicate(id) = all {
    s.reset_phase == Idle,
    s.in_flight == id,
    not(s.response_present),
    s.ledger.contains(id),
    s' = {
      ...s,
      response_present: true,
      response_mutation_id: id,
      response_watermark: id,
      response_checkpoint: s.server_checkpoint,
      response_valid_for_in_flight: true,
      saw_duplicate_reply: true,
    },
  }

  // Model an untrusted or stale response. The client must not acknowledge it
  // because it does not name the exact immutable request currently in flight.
  action inject_mismatched_response(id) = all {
    s.reset_phase == Idle,
    s.in_flight != NO_ID,
    not(s.response_present),
    id != s.in_flight,
    IDS.contains(id),
    s' = {
      ...s,
      response_present: true,
      response_mutation_id: id,
      response_watermark: id,
      response_checkpoint: s.server_checkpoint,
      response_valid_for_in_flight: false,
    },
  }

  // A response can disappear after the server transaction commits. The queued
  // mutation remains pending, so the only safe recovery is an identical retry.
  action lose_committed_response(id) = all {
    s.reset_phase == Idle,
    s.in_flight == id,
    s.response_present,
    s.response_valid_for_in_flight,
    s.response_mutation_id == id,
    s.ledger.contains(id),
    s' = {
      ...s,
      in_flight: NO_ID,
      response_present: false,
      response_mutation_id: NO_ID,
      response_watermark: 0,
      response_checkpoint: 0,
      response_valid_for_in_flight: false,
      saw_lost_response: true,
    },
  }

  // A request can also fail before the server commits anything.
  action lose_uncommitted_request(id) = all {
    s.reset_phase == Idle,
    s.in_flight == id,
    not(s.response_present),
    not(s.ledger.contains(id)),
    s' = { ...s, in_flight: NO_ID },
  }

  action discard_malformed_response = all {
    s.reset_phase == Idle,
    s.response_present,
    not(s.response_valid_for_in_flight),
    s' = {
      ...s,
      in_flight: NO_ID,
      response_present: false,
      response_mutation_id: NO_ID,
      response_watermark: 0,
      response_checkpoint: 0,
      response_valid_for_in_flight: false,
    },
  }

  // Acknowledgement is intentionally tied to both the in-flight request and the
  // response. A bare watermark cannot remove mutations that were never sent.
  action acknowledge(id) = all {
    s.reset_phase == Idle,
    s.in_flight == id,
    s.response_present,
    s.response_valid_for_in_flight,
    s.response_mutation_id == id,
    s.response_watermark == id,
    s.ledger.contains(id),
    s.pending.contains(id),
    s' = {
      ...s,
      pending: s.pending.filter(other => other != id),
      acknowledged: s.acknowledged.union(Set(id)),
      in_flight: NO_ID,
      response_present: false,
      response_mutation_id: NO_ID,
      response_watermark: 0,
      response_checkpoint: 0,
      response_valid_for_in_flight: false,
    },
  }

  // A normal pull applies the authoritative page before advancing the durable
  // checkpoint. This abstract action represents the successful atomic boundary.
  action pull = all {
    s.reset_phase == Idle,
    s.local_checkpoint >= s.retention_floor,
    s' = { ...s, local_checkpoint: s.server_checkpoint },
  }

  // Compaction only removes history. Current records and mutation ledger entries
  // remain, while clients behind retention_floor must install a snapshot.
  action compact = all {
    s.reset_phase == Idle,
    s.server_checkpoint > s.retention_floor,
    s' = { ...s, retention_floor: s.server_checkpoint },
  }

  action begin_reset = all {
    s.reset_phase == Idle,
    s.local_checkpoint < s.retention_floor,
    s' = {
      ...s,
      reset_phase: Replacing,
      reset_pending_before: s.pending,
      reset_checkpoint_before: s.local_checkpoint,
    },
  }

  // A crash during replacement cannot advance the checkpoint or remove pending
  // local mutations. The complete snapshot can therefore be retried.
  action crash_during_reset = all {
    s.reset_phase == Replacing,
    s' = {
      ...s,
      reset_phase: Idle,
      saw_reset_crash: true,
    },
  }

  action finish_reset = all {
    s.reset_phase == Replacing,
    s' = {
      ...s,
      reset_phase: Idle,
      local_checkpoint: s.server_checkpoint,
    },
  }

  action idle = s' = s

  action step = {
    nondet id = IDS.oneOf()
    any {
      enqueue,
      send(id),
      apply_new(id),
      reject_new(id),
      reply_duplicate(id),
      inject_mismatched_response(id),
      lose_committed_response(id),
      lose_uncommitted_request(id),
      discard_malformed_response,
      acknowledge(id),
      pull,
      compact,
      begin_reset,
      crash_during_reset,
      finish_reset,
      idle,
    }
  }

  val identity_bounds = and {
    s.next_id >= 1,
    s.next_id <= MAX_ID + 1,
    s.server_watermark >= 0,
    s.server_watermark <= MAX_ID,
    s.in_flight >= NO_ID,
    s.in_flight <= MAX_ID,
    s.pending.forall(id => IDS.contains(id) and id < s.next_id),
    s.acknowledged.forall(id => IDS.contains(id) and id < s.next_id),
  }

  // Every allocated identity is in exactly one client-side lifecycle bucket.
  val client_queue_is_a_partition = IDS.forall(id => or {
    and {
      id < s.next_id,
      or {
        and { s.pending.contains(id), not(s.acknowledged.contains(id)) },
        and { s.acknowledged.contains(id), not(s.pending.contains(id)) },
      },
    },
    and {
      id >= s.next_id,
      not(s.pending.contains(id)),
      not(s.acknowledged.contains(id)),
    },
  })

  // The durable ledger is a contiguous prefix; gaps can never become committed.
  val ledger_is_contiguous =
    s.ledger == IDS.filter(id => id <= s.server_watermark)

  val outcomes_partition_ledger = and {
    s.applied.forall(id => s.ledger.contains(id)),
    s.rejected.forall(id => s.ledger.contains(id)),
    s.ledger.forall(id => s.applied.contains(id) or s.rejected.contains(id)),
    s.applied.forall(id => not(s.rejected.contains(id))),
  }

  // Every applied mutation executes exactly once, including after an ambiguous
  // response and duplicate retry. Rejected/unseen identities execute zero times.
  val effects_are_exactly_once = IDS.forall(id => or {
    s.applied.contains(id) and s.effect_count.get(id) == 1,
    not(s.applied.contains(id)) and s.effect_count.get(id) == 0,
  })

  val acknowledgement_is_safe = and {
    s.acknowledged.forall(id => s.ledger.contains(id)),
    s.acknowledged.forall(id => not(s.pending.contains(id))),
  }

  val checkpoints_are_ordered = and {
    s.server_checkpoint == s.ledger.size(),
    s.server_checkpoint == s.server_watermark,
    s.local_checkpoint >= 0,
    s.local_checkpoint <= s.server_checkpoint,
    s.retention_floor >= 0,
    s.retention_floor <= s.server_checkpoint,
  }

  // While replacement is in progress, the old checkpoint and every queued
  // mutation are frozen. Only finish_reset may advance the checkpoint.
  val reset_is_atomic =
    s.reset_phase != Replacing or and {
      s.pending == s.reset_pending_before,
      s.local_checkpoint == s.reset_checkpoint_before,
    }

  val in_flight_is_queued = or {
    s.in_flight == NO_ID,
    and {
      IDS.contains(s.in_flight),
      s.pending.contains(s.in_flight),
      or {
        s.ledger.contains(s.in_flight),
        s.in_flight == s.server_watermark + 1,
      },
    },
  }

  val response_is_bounded = or {
    and {
      not(s.response_present),
      s.response_mutation_id == NO_ID,
      s.response_watermark == 0,
      s.response_checkpoint == 0,
      not(s.response_valid_for_in_flight),
    },
    and {
      s.response_present,
      IDS.contains(s.response_mutation_id),
      s.response_watermark >= 1,
      s.response_watermark <= MAX_ID,
      s.response_checkpoint >= 0,
      s.response_checkpoint <= s.server_checkpoint,
      or {
        not(s.response_valid_for_in_flight),
        and {
          s.in_flight == s.response_mutation_id,
          s.response_watermark == s.response_mutation_id,
          s.ledger.contains(s.response_mutation_id),
        },
      },
    },
  }

  val protocol_safety = and {
    identity_bounds,
    client_queue_is_a_partition,
    ledger_is_contiguous,
    outcomes_partition_ledger,
    effects_are_exactly_once,
    acknowledgement_is_safe,
    checkpoints_are_ordered,
    reset_is_atomic,
    in_flight_is_queued,
    response_is_bounded,
  }

  // Reachability witnesses used by CI so the interesting failure/recovery paths
  // do not silently become dead code as this model evolves.
  val ambiguous_commit_reached = s.saw_lost_response
  val duplicate_retry_reached = s.saw_duplicate_reply
  val reset_crash_reached = s.saw_reset_crash
}
