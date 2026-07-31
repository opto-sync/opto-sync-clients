/// Repository-local formal replay state built around the production queue.
///
/// The wrapper owns only model-observation metadata that the public queue does
/// not retain (server outcomes and snapshot replacement phase). Queue mutation,
/// request construction, response validation, acknowledgement, and checkpoint
/// advancement all delegate to `opto_sync_client`.
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import opto_sync_client

pub type Outcome {
  AppliedOutcome
  RejectedOutcome
}

pub type ResetPhase {
  Idle
  Replacing
}

pub type KnownOutcome {
  KnownOutcome(id: Int, outcome: Outcome)
}

pub type State {
  State(
    queue: opto_sync_client.Queue,
    outcomes: List(KnownOutcome),
    reset_phase: ResetPhase,
  )
}

pub type Reply {
  Applied(id: Int, watermark: Int, checkpoint: Int)
  Rejected(id: Int, watermark: Int, checkpoint: Int)
  Duplicate(id: Int, watermark: Int, checkpoint: Int, original: Outcome)
}

pub fn initial_state() -> State {
  let assert Ok(queue) = opto_sync_client.new("gleam-formal-adapter")
  State(queue:, outcomes: [], reset_phase: Idle)
}

pub fn enqueue(state: State) -> #(State, Int) {
  let State(queue, outcomes, reset_phase) = state
  let assert Ok(#(next_queue, mutation)) =
    opto_sync_client.enqueue_upsert(
      queue,
      "formal_records",
      "trace",
      "{}",
      None,
      False,
    )
  #(
    State(queue: next_queue, outcomes:, reset_phase:),
    mutation.mutation_id,
  )
}

pub fn server_outcome(state: State, id: Int, applied: Bool) -> #(State, Reply) {
  let State(queue, outcomes, reset_phase) = state
  case find_outcome(outcomes, id) {
    Some(original) -> #(
      state,
      Duplicate(id:, watermark: id, checkpoint: id, original:),
    )
    None -> {
      let outcome = case applied {
        True -> AppliedOutcome
        False -> RejectedOutcome
      }
      let reply = case outcome {
        AppliedOutcome -> Applied(id:, watermark: id, checkpoint: id)
        RejectedOutcome -> Rejected(id:, watermark: id, checkpoint: id)
      }
      #(
        State(
          queue:,
          outcomes: [KnownOutcome(id:, outcome:), ..outcomes],
          reset_phase:,
        ),
        reply,
      )
    }
  }
}

pub fn acknowledge(state: State, id: Int, accepted: Bool) -> State {
  let State(queue, outcomes, reset_phase) = state
  case accepted, opto_sync_client.build_push_request(queue, 1) {
    True, Ok(request) -> {
      let status = case find_outcome(outcomes, id) {
        Some(AppliedOutcome) -> opto_sync_client.Applied
        Some(RejectedOutcome) -> opto_sync_client.Rejected
        None -> opto_sync_client.Applied
      }
      let response =
        opto_sync_client.PushResponse(
          protocol_version: 1,
          client_id: "gleam-formal-adapter",
          last_mutation_id: int.to_string(id),
          checkpoint: int.to_string(id),
          results: [
            opto_sync_client.MutationResult(
              mutation_id: int.to_string(id),
              status:,
              original_status: None,
              checkpoint: Some(int.to_string(id)),
              revision: None,
            ),
          ],
        )
      case opto_sync_client.acknowledge(queue, request, response) {
        Ok(next_queue) -> State(queue: next_queue, outcomes:, reset_phase:)
        Error(_) -> state
      }
    }
    _, _ -> state
  }
}

pub fn pull(state: State, checkpoint: Int) -> State {
  let State(queue, outcomes, reset_phase) = state
  case opto_sync_client.set_checkpoint(queue, int.to_string(checkpoint)) {
    Ok(next_queue) -> State(queue: next_queue, outcomes:, reset_phase:)
    Error(_) -> state
  }
}

pub fn begin_reset(state: State) -> State {
  let State(queue, outcomes, _) = state
  State(queue:, outcomes:, reset_phase: Replacing)
}

pub fn crash_during_reset(state: State) -> State {
  let State(queue, outcomes, _) = state
  State(queue:, outcomes:, reset_phase: Idle)
}

pub fn finish_reset(state: State, checkpoint: Int) -> State {
  let State(queue, outcomes, _) = pull(state, checkpoint)
  State(queue:, outcomes:, reset_phase: Idle)
}

pub fn encode_projection_json(state: State) -> String {
  let State(queue, outcomes, reset_phase) = state
  let assert Ok(projection) = project(queue)
  let FormalProjection(
    next_mutation_id,
    pending_mutation_ids,
    confirmed_mutation_ids,
    allocated_mutation_ids,
    checkpoint,
  ) = projection
  json.object([
    #("nextId", tagged_int(next_mutation_id)),
    #("pending", tagged_int_list(pending_mutation_ids)),
    #("confirmed", tagged_int_list(confirmed_mutation_ids)),
    #("allocated", tagged_int_list(allocated_mutation_ids)),
    #("knownOutcomes", json.array(outcomes, encode_outcome)),
    #("checkpoint", tagged_int(checkpoint)),
    #(
      "resetPhase",
      json.string(case reset_phase {
        Idle -> "idle"
        Replacing -> "replacing"
      }),
    ),
  ])
  |> json.to_string
}

pub type ProjectionError {
  InvalidProductionSnapshot
}

pub type FormalProjection {
  FormalProjection(
    next_mutation_id: String,
    pending_mutation_ids: List(String),
    confirmed_mutation_ids: List(String),
    allocated_mutation_ids: List(String),
    checkpoint: String,
  )
}

pub fn project(
  queue: opto_sync_client.Queue,
) -> Result(FormalProjection, ProjectionError) {
  let mutations = opto_sync_client.all_mutations(queue)
  let pending_mutation_ids =
    mutations
    |> list.filter(fn(mutation) {
      mutation.status == opto_sync_client.Pending
    })
    |> list.map(fn(mutation) { int.to_string(mutation.mutation_id) })
  let confirmed_mutation_ids =
    mutations
    |> list.filter(fn(mutation) {
      mutation.status == opto_sync_client.Confirmed
    })
    |> list.map(fn(mutation) { int.to_string(mutation.mutation_id) })
  let next_id = list.length(mutations) + 1
  Ok(FormalProjection(
    next_mutation_id: int.to_string(next_id),
    pending_mutation_ids:,
    confirmed_mutation_ids:,
    allocated_mutation_ids: allocated_ids(1, next_id, []),
    checkpoint: opto_sync_client.checkpoint(queue),
  ))
}

fn find_outcome(outcomes: List(KnownOutcome), id: Int) {
  outcomes
  |> list.find(fn(entry) {
    let KnownOutcome(entry_id, _) = entry
    entry_id == id
  })
  |> case {
    Ok(KnownOutcome(_, outcome)) -> Some(outcome)
    Error(_) -> None
  }
}

fn encode_outcome(entry: KnownOutcome) -> json.Json {
  let KnownOutcome(id, outcome) = entry
  json.object([
    #("id", tagged_int(int.to_string(id))),
    #(
      "status",
      json.string(case outcome {
        AppliedOutcome -> "applied"
        RejectedOutcome -> "rejected"
      }),
    ),
  ])
}

fn tagged_int(value: String) -> json.Json {
  json.object([#("#bigint", json.string(value))])
}

fn tagged_int_list(values: List(String)) -> json.Json {
  json.array(values, tagged_int)
}

fn allocated_ids(
  current: Int,
  before: Int,
  reversed: List(String),
) -> List(String) {
  case current >= before {
    True -> list.reverse(reversed)
    False ->
      allocated_ids(current + 1, before, [int.to_string(current), ..reversed])
  }
}
