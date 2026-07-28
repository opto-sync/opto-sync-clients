// Executable model of the opto-sync protocol-v1 client/server lifecycle.
//
// This first model intentionally uses one client, one logical record stream, and
// three mutation identities. The small finite domain lets TLC exhaust the whole
// reachable state graph while retaining the failure modes that matter:
// committed-but-unacknowledged writes, duplicate retry, permanent rejection,
// malformed acknowledgements, compaction, snapshot reset, and crash recovery.
module opto_sync_protocol {
  type ResetPhase = Idle | Replacing

  type Response = {
    mutation_id: int,
    watermark: int,
    checkpoint: int,
    valid_for_in_flight: bool,
  }

  type State = {
    next_id: int,
    pending: Set[int],
    in_flight: Option[int],
    ledger: Set[int],
    applied: Set[int],
    rejected: Set[int],
    effect_count: int -> int,
    server_watermark: int,
    server_checkpoint: int,
    response: Option[Response],
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

  pure val IDS = Set(1, 2, 3)
  pure val MAX_ID = 3

  var s: State

  action init = {
    s' = {
      next_id: 1,
      pending: Set(),
      in_flight: None,
      ledger: Set(),
      applied: Set(),
      rejected: Set(),
      effect_count: IDS.mapBy(_ => 0),
      server_watermark: 0,
      server_checkpoint: 0,
      response: None,
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
      pending: s.pending.setAdd(s.next_id),
    },
  }

  // The client may send the next new mutation, or retry one whose commit became
  // ambiguous because its response was lost.
  action send(id) = all {
    s.reset_phase == Idle,
    s.in_flight == None,
    s.response == None,
    s.pending.contains(id),
    or {
      s.ledger.contains(id),
      id == s.server_watermark + 1,
    },
    s' = { ...s, in_flight: Some(id) },
  }

  // A new successful mutation atomically advances the ledger, effect, watermark,
  // pull checkpoint, and response. effect_count is deliberately a counter so the
  // no-double-apply property is not true merely because Set removes duplicates.
  action apply_new(id) = all {
    s.reset_phase == Idle,
    s.in_flight == Some(id),
    id == s.server_watermark + 1,
    not(s.ledger.contains(id)),
    s' = {
      ...s,
      ledger: s.ledger.setAdd(id),
      applied: s.applied.setAdd(id),
      effect_count: s.effect_count.setBy(id, count => count + 1),
      server_watermark: id,
      server_checkpoint: s.server_checkpoint + 1,
      response: Some({
        mutation_id: id,
        watermark: id,
        checkpoint: s.server_checkpoint + 1,
        valid_for_in_flight: true,
      }),
    },
  }

  // Permanent rejection is durable and advances the per-client watermark, but it
  // never executes the record effect. This prevents a poison mutation from
  // blocking every later mutation forever.
  action reject_new(id) = all {
    s.reset_phase == Idle,
    s.in_flight == Some(id),
    id == s.server_watermark + 1,
    not(s.ledger.contains(id)),
    s' = {
      ...s,
      ledger: s.ledger.setAdd(id),
      rejected: s.rejected.setAdd(id),
      server_watermark: id,
      server_checkpoint: s.server_checkpoint + 1,
      response: Some({
        mutation_id: id,
        watermark: id,
        checkpoint: s.server_checkpoint + 1,
        valid_for_in_flight: true,
      }),
    },
  }

  // An identical retry returns the durable result without executing the effect a
  // second time or allocating another checkpoint.
  action reply_duplicate(id) = all {
    s.reset_phase == Idle,
    s.in_flight == Some(id),
    s.ledger.contains(id),
    s' = {
      ...s,
      response: Some({
        mutation_id: id,
        watermark: id,
        checkpoint: s.server_checkpoint,
        valid_for_in_flight: true,
      }),
      saw_duplicate_reply: true,
    },
  }

  // Model an untrusted or stale response. The client must not acknowledge it
  // because it does not name the exact immutable request currently in flight.
  action inject_mismatched_response(id) = all {
    s.reset_phase == Idle,
    s.in_flight != None,
    id != s.in_flight.unwrap(),
    IDS.contains(id),
    s' = {
      ...s,
      response: Some({
        mutation_id: id,
        watermark: id,
        checkpoint: s.server_checkpoint,
        valid_for_in_flight: false,
      }),
    },
  }

  // A response can disappear after the server transaction commits. The queued
  // mutation remains pending, so the only safe recovery is an identical retry.
  action lose_committed_response = all {
    s.reset_phase == Idle,
    s.response != None,
    s.in_flight != None,
    s.ledger.contains(s.in_flight.unwrap()),
    s' = {
      ...s,
      in_flight: None,
      response: None,
      saw_lost_response: true,
    },
  }

  // A request can also fail before the server commits anything.
  action lose_uncommitted_request = all {
    s.reset_phase == Idle,
    s.in_flight != None,
    s.response == None,
    not(s.ledger.contains(s.in_flight.unwrap())),
    s' = { ...s, in_flight: None },
  }

  action discard_malformed_response = all {
    s.reset_phase == Idle,
    s.response != None,
    not(s.response.unwrap().valid_for_in_flight),
    s' = { ...s, in_flight: None, response: None },
  }

  // Acknowledgement is intentionally tied to both the in-flight request and the
  // response. A bare watermark cannot remove mutations that were never sent.
  action acknowledge(id) = all {
    s.reset_phase == Idle,
    s.in_flight == Some(id),
    s.response != None,
    s.response.unwrap().valid_for_in_flight,
    s.response.unwrap().mutation_id == id,
    s.response.unwrap().watermark == id,
    s.ledger.contains(id),
    s.pending.contains(id),
    s' = {
      ...s,
      pending: s.pending.filter(other => other != id),
      acknowledged: s.acknowledged.setAdd(id),
      in_flight: None,
      response: None,
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
      lose_committed_response,
      lose_uncommitted_request,
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
    s.pending.forall(id => IDS.contains(id) and id < s.next_id),
    s.acknowledged.forall(id => IDS.contains(id) and id < s.next_id),
  }

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

  val in_flight_is_queued = match s.in_flight {
    | None => true
    | Some(id) => s.pending.contains(id) and or {
        s.ledger.contains(id),
        id == s.server_watermark + 1,
      }
  }

  val response_is_bounded = match s.response {
    | None => true
    | Some(r) => and {
        IDS.contains(r.mutation_id),
        r.watermark >= 1,
        r.watermark <= MAX_ID,
        r.checkpoint >= 0,
        r.checkpoint <= s.server_checkpoint,
      }
  }

  val protocol_safety = and {
    identity_bounds,
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
