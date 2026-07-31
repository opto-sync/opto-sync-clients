import gleam/json
import gleam_community/maths/bigint.{type BigInt}
import opto_sync_formal_projection as projection

/// Render only the canonical abstract protocol projection. The adapter never
/// serializes private BEAM terms or implementation-specific storage layout.
pub fn projection_json(state: projection.State) -> String {
  state
  |> projection.observe
  |> projection.encode_projection_json
  |> json.to_string
}

/// Render the production reply value using the same tagged-bigint vocabulary as
/// the shared ITF projection. This lets the BEAM adapter check wire semantics
/// without teaching the Erlang harness the representation of Gleam custom types.
pub fn reply_json(reply: projection.Reply) -> String {
  let encoded = case reply {
    projection.Applied(mutation_id, watermark, checkpoint) ->
      json.object([
        #("status", json.string("applied")),
        #("mutationId", bigint_json(mutation_id)),
        #("watermark", bigint_json(watermark)),
        #("checkpoint", bigint_json(checkpoint)),
      ])

    projection.Rejected(mutation_id, watermark, checkpoint) ->
      json.object([
        #("status", json.string("rejected")),
        #("mutationId", bigint_json(mutation_id)),
        #("watermark", bigint_json(watermark)),
        #("checkpoint", bigint_json(checkpoint)),
      ])

    projection.Duplicate(mutation_id, watermark, checkpoint, original) ->
      json.object([
        #("status", json.string("duplicate")),
        #("mutationId", bigint_json(mutation_id)),
        #("watermark", bigint_json(watermark)),
        #("checkpoint", bigint_json(checkpoint)),
        #("originalStatus", json.string(outcome_name(original))),
      ])
  }

  json.to_string(encoded)
}

/// Exercise the production request/response validator at the malformed-response
/// boundary. The Erlang harness supplies only scalar model values; all protocol
/// record construction and validation remain in Gleam production code.
pub fn mismatched_response_rejected(
  request_id: BigInt,
  response_id: BigInt,
  watermark: BigInt,
  checkpoint: BigInt,
) -> Bool {
  let request =
    projection.PushRequest(
      protocol_version: 1,
      client_id: "gleam-formal-adapter",
      mutation_ids: [request_id],
    )
  let response =
    projection.PushResponse(
      protocol_version: 1,
      client_id: "gleam-formal-adapter",
      last_mutation_id: watermark,
      checkpoint: checkpoint,
      result: projection.Applied(response_id, watermark, checkpoint),
    )

  case projection.validate_response(request, response) {
    Error(projection.ResponseDoesNotMatchRequest) -> True
    _ -> False
  }
}

fn bigint_json(value: BigInt) -> json.Json {
  json.object([#("#bigint", json.string(bigint.to_string(value)))])
}

fn outcome_name(outcome: projection.Outcome) -> String {
  case outcome {
    projection.AppliedOutcome -> "applied"
    projection.RejectedOutcome -> "rejected"
  }
}
