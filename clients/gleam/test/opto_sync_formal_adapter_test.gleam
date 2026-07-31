import gleam/string
import gleeunit/should
import opto_sync_formal_adapter as adapter
import opto_sync_formal_projection as projection

pub fn projection_json_uses_production_queue_state_test() {
  let state = projection.initial_state()
  let #(state, first) = projection.enqueue(state)
  let #(state, _) = projection.server_outcome(state, first, True)
  let state = projection.acknowledge(state, first, True)

  projection.observe(state)
  |> should.equal(
    Ok(projection.FormalProjection(
      next_mutation_id: "2",
      pending_mutation_ids: [],
      confirmed_mutation_ids: ["1"],
      allocated_mutation_ids: ["1"],
      checkpoint: "0",
    )),
  )
  let encoded = adapter.projection_json(state)
  encoded |> string.contains("\"knownOutcomes\"") |> should.be_true
  encoded |> string.contains("\"resetPhase\":\"idle\"") |> should.be_true
}

pub fn reply_json_preserves_duplicate_origin_test() {
  let reply = projection.Duplicate(1, 1, 1, projection.RejectedOutcome)

  let encoded = adapter.reply_json(reply)
  encoded |> string.contains("\"status\":\"duplicate\"") |> should.be_true
  encoded
  |> string.contains("\"originalStatus\":\"rejected\"")
  |> should.be_true
}

pub fn malformed_response_uses_production_validator_test() {
  adapter.mismatched_response_rejected(1, 2, 1, 1)
  |> should.be_true
}
