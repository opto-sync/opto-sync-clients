import gleam/int
import gleam/json
import gleam/option.{None}
import opto_sync_client
import opto_sync_formal_projection as projection

pub fn projection_json(state: projection.State) -> String {
  projection.encode_projection_json(state)
}

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

/// Exercise the production acknowledgement validator against the exact modeled
/// immutable request. Earlier mutations are allocated and validly acknowledged
/// first so `request_id = 2` really produces a request for mutation 2 rather
/// than accidentally retesting mutation 1 in a fresh queue.
pub fn mismatched_response_rejected(
  request_id: Int,
  response_id: Int,
  watermark: Int,
  checkpoint: Int,
) -> Bool {
  let assert Ok(queue) = opto_sync_client.new("gleam-formal-adapter")
  let queue = prepare_request(queue, 1, request_id)
  let assert Ok(request) = opto_sync_client.build_push_request(queue, 1)
  let response =
    opto_sync_client.PushResponse(
      protocol_version: 1,
      client_id: "gleam-formal-adapter",
      last_mutation_id: int.to_string(watermark),
      checkpoint: int.to_string(checkpoint),
      results: [
        opto_sync_client.MutationResult(
          mutation_id: int.to_string(response_id),
          status: opto_sync_client.Applied,
          original_status: None,
          checkpoint: None,
          revision: None,
        ),
      ],
    )
  case opto_sync_client.acknowledge(queue, request, response) {
    Error(opto_sync_client.InvalidAcknowledgement) -> True
    _ -> False
  }
}

fn prepare_request(
  queue: opto_sync_client.Queue,
  current_id: Int,
  request_id: Int,
) -> opto_sync_client.Queue {
  let assert Ok(#(queue, _)) =
    opto_sync_client.enqueue_upsert(
      queue,
      "formal_records",
      int.to_string(current_id),
      "{}",
      None,
      False,
    )

  case current_id < request_id {
    False -> queue
    True -> {
      let assert Ok(request) = opto_sync_client.build_push_request(queue, 1)
      let response =
        opto_sync_client.PushResponse(
          protocol_version: 1,
          client_id: "gleam-formal-adapter",
          last_mutation_id: int.to_string(current_id),
          checkpoint: int.to_string(current_id),
          results: [
            opto_sync_client.MutationResult(
              mutation_id: int.to_string(current_id),
              status: opto_sync_client.Applied,
              original_status: None,
              checkpoint: None,
              revision: None,
            ),
          ],
        )
      let assert Ok(queue) =
        opto_sync_client.acknowledge(queue, request, response)
      prepare_request(queue, current_id + 1, request_id)
    }
  }
}

fn bigint_json(value: Int) -> json.Json {
  json.object([#("#bigint", json.string(int.to_string(value)))])
}

fn outcome_name(outcome: projection.Outcome) -> String {
  case outcome {
    projection.AppliedOutcome -> "applied"
    projection.RejectedOutcome -> "rejected"
  }
}