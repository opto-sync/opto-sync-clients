import gleam/string
import gleeunit/should
import gleam_community/maths/bigint
import opto_sync_formal_adapter as adapter
import opto_sync_formal_projection as projection

pub fn projection_json_round_trips_test() {
  let state = projection.initial_state()
  let #(state, first) = projection.enqueue(state)
  let #(state, _) = projection.server_outcome(state, first, True)
  let state = projection.acknowledge(state, first, True)

  adapter.projection_json(state)
  |> projection.decode_projection_json
  |> should.equal(Ok(projection.observe(state)))
}

pub fn reply_json_preserves_duplicate_origin_test() {
  let one = bigint.from_int(1)
  let reply =
    projection.Duplicate(
      one,
      one,
      one,
      projection.RejectedOutcome,
    )

  let encoded = adapter.reply_json(reply)
  encoded |> string.contains("\"status\":\"duplicate\"") |> should.be_true
  encoded
  |> string.contains("\"originalStatus\":\"rejected\"")
  |> should.be_true
}

pub fn malformed_response_uses_production_validator_test() {
  adapter.mismatched_response_rejected(
    bigint.from_int(1),
    bigint.from_int(2),
    bigint.from_int(1),
    bigint.from_int(1),
  )
  |> should.be_true
}
