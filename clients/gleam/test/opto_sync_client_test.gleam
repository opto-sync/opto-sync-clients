import gleam/list
import gleam/option.{None, Some}
import gleeunit
import gleeunit/should
import opto_sync_client

pub fn main() {
  gleeunit.main()
}

fn queue() {
  let assert Ok(queue) = opto_sync_client.new("gleam-device")
  queue
}

fn with_two_pending() {
  let assert Ok(#(queue, _)) =
    opto_sync_client.enqueue_upsert(
      queue(),
      "tasks",
      "a",
      "{\"title\":\"one\"}",
      None,
      False,
    )
  let assert Ok(#(queue, _)) =
    opto_sync_client.enqueue_delete(queue, "tasks", "b", Some("7"))
  queue
}

pub fn rejects_empty_client_test() {
  opto_sync_client.new("")
  |> should.equal(Error(opto_sync_client.EmptyClientId))
}

pub fn allocates_stable_contiguous_ids_test() {
  let queue = with_two_pending()
  let assert Ok(opto_sync_client.PushRequest(1, "gleam-device", mutations)) =
    opto_sync_client.build_push_request(queue, 100)
  mutations
  |> should.equal([
    opto_sync_client.PushMutation(
      "1",
      opto_sync_client.Upsert("{\"title\":\"one\"}", False),
      "tasks",
      "a",
      None,
    ),
    opto_sync_client.PushMutation(
      "2",
      opto_sync_client.Delete,
      "tasks",
      "b",
      Some("7"),
    ),
  ])
}

pub fn batch_limit_is_bounded_test() {
  opto_sync_client.build_push_request(with_two_pending(), 0)
  |> should.equal(Error(opto_sync_client.InvalidLimit))
  opto_sync_client.build_push_request(with_two_pending(), 101)
  |> should.equal(Error(opto_sync_client.InvalidLimit))
}

pub fn queue_and_payload_limits_are_enforced_test() {
  let assert Ok(queue) = opto_sync_client.new_with_limits("bounded", 1, 2)
  let assert Ok(#(queue, _)) =
    opto_sync_client.enqueue_delete(queue, "tasks", "a", None)
  opto_sync_client.enqueue_delete(queue, "tasks", "b", None)
  |> should.equal(Error(opto_sync_client.QueueFull))

  let assert Ok(queue) = opto_sync_client.new_with_limits("payload", 2, 2)
  opto_sync_client.enqueue_upsert(queue, "tasks", "a", "{} ", None, False)
  |> should.equal(Error(opto_sync_client.PayloadTooLarge))

  opto_sync_client.enqueue_upsert(queue, "tasks", "a", "[]", None, False)
  |> should.equal(Error(opto_sync_client.InvalidPayload))
}

pub fn protocol_wire_format_round_trips_test() {
  let queue = with_two_pending()
  let assert Ok(request) = opto_sync_client.build_push_request(queue, 100)
  request
  |> opto_sync_client.encode_push_request
  |> should.equal(
    "{\"protocolVersion\":1,\"clientId\":\"gleam-device\",\"mutations\":[{\"mutationId\":\"1\",\"operation\":\"upsert\",\"table\":\"tasks\",\"recordId\":\"a\",\"payload\":{\"title\":\"one\"}},{\"mutationId\":\"2\",\"operation\":\"delete\",\"table\":\"tasks\",\"recordId\":\"b\",\"baseRevision\":\"7\"}]}",
  )
  opto_sync_client.decode_push_response(
    "{\"protocolVersion\":1,\"clientId\":\"gleam-device\",\"lastMutationId\":\"2\",\"checkpoint\":\"9\",\"results\":[{\"mutationId\":\"1\",\"status\":\"applied\",\"checkpoint\":\"8\",\"revision\":\"3\"},{\"mutationId\":\"2\",\"status\":\"duplicate\",\"originalStatus\":\"applied\"}]}",
  )
  |> should.equal(
    Ok(
      opto_sync_client.PushResponse(1, "gleam-device", "2", "9", [
        opto_sync_client.MutationResult(
          "1",
          opto_sync_client.Applied,
          None,
          Some("8"),
          Some("3"),
        ),
        opto_sync_client.MutationResult(
          "2",
          opto_sync_client.Duplicate,
          Some(opto_sync_client.Applied),
          None,
          None,
        ),
      ]),
    ),
  )
}

pub fn malformed_response_is_rejected_before_state_changes_test() {
  opto_sync_client.decode_push_response(
    "{\"protocolVersion\":1,\"clientId\":\"x\",\"lastMutationId\":\"1\",\"checkpoint\":\"1\",\"results\":[{\"mutationId\":\"1\",\"status\":\"invented\"}]}",
  )
  |> should.equal(Error(opto_sync_client.InvalidAcknowledgement))
}

pub fn queue_snapshot_preserves_the_exact_retry_body_test() {
  let assert Ok(queue) = opto_sync_client.new("restart-device")
  let assert Ok(#(queue, _)) =
    opto_sync_client.enqueue_upsert(
      queue,
      "tasks",
      "spaced",
      "{ \"title\" : \"exact bytes\" }",
      None,
      False,
    )
  let assert Ok(before) = opto_sync_client.build_push_request(queue, 100)
  let before = opto_sync_client.encode_push_request(before)
  let snapshot = opto_sync_client.encode_queue(queue)
  let assert Ok(restored) = opto_sync_client.decode_queue(snapshot)
  let assert Ok(after) = opto_sync_client.build_push_request(restored, 100)
  opto_sync_client.encode_push_request(after)
  |> should.equal(before)
  opto_sync_client.encode_queue(restored)
  |> should.equal(snapshot)
}

pub fn inconsistent_queue_snapshot_is_rejected_test() {
  // mutation 1 cannot exist when the next allocatable id is also 1.
  opto_sync_client.decode_queue(
    "{\"version\":1,\"clientId\":\"x\",\"nextMutationId\":\"1\",\"checkpoint\":\"0\",\"mutations\":[{\"mutationId\":\"1\",\"operation\":\"delete\",\"table\":\"tasks\",\"recordId\":\"a\",\"payloadJson\":null,\"baseRevision\":null,\"resurrect\":false,\"status\":\"pending\"}],\"maxPendingMutations\":10,\"maxQueuedPayloadBytes\":100}",
  )
  |> should.equal(Error(opto_sync_client.InvalidSnapshot))
  opto_sync_client.decode_queue(
    "{\"version\":2,\"clientId\":\"x\",\"nextMutationId\":\"1\",\"checkpoint\":\"0\",\"mutations\":[],\"maxPendingMutations\":10,\"maxQueuedPayloadBytes\":100}",
  )
  |> should.equal(Error(opto_sync_client.InvalidSnapshot))
}

pub fn exact_acknowledgement_confirms_and_compacts_test() {
  let queue = with_two_pending()
  let assert Ok(request) = opto_sync_client.build_push_request(queue, 100)
  let response =
    opto_sync_client.PushResponse(1, "gleam-device", "2", "2", [
      opto_sync_client.MutationResult(
        "1",
        opto_sync_client.Applied,
        None,
        Some("1"),
        Some("1"),
      ),
      opto_sync_client.MutationResult(
        "2",
        opto_sync_client.Rejected,
        None,
        Some("2"),
        None,
      ),
    ])
  let assert Ok(queue) = opto_sync_client.acknowledge(queue, request, response)
  opto_sync_client.pending(queue)
  |> should.equal([])
  opto_sync_client.checkpoint(queue)
  |> should.equal("0")
  let assert Ok(queue) = opto_sync_client.set_checkpoint(queue, "2")
  opto_sync_client.checkpoint(queue)
  |> should.equal("2")
  queue
  |> opto_sync_client.compact_confirmed
  |> opto_sync_client.all_mutations
  |> should.equal([])
}

pub fn wrong_client_and_over_ack_are_rejected_test() {
  let queue = with_two_pending()
  let assert Ok(request) = opto_sync_client.build_push_request(queue, 1)
  let wrong_client =
    opto_sync_client.PushResponse(1, "other", "1", "1", [
      opto_sync_client.MutationResult(
        "1",
        opto_sync_client.Applied,
        None,
        None,
        None,
      ),
    ])
  opto_sync_client.acknowledge(queue, request, wrong_client)
  |> should.equal(Error(opto_sync_client.WrongClient))

  let assert Ok(request) = opto_sync_client.build_push_request(queue, 1)
  let over_ack =
    opto_sync_client.PushResponse(1, "gleam-device", "2", "2", [
      opto_sync_client.MutationResult(
        "2",
        opto_sync_client.Applied,
        None,
        None,
        None,
      ),
    ])
  opto_sync_client.acknowledge(queue, request, over_ack)
  |> should.equal(Error(opto_sync_client.InvalidAcknowledgement))
}

pub fn noncanonical_decimal_is_rejected_test() {
  let queue = with_two_pending()
  let assert Ok(request) = opto_sync_client.build_push_request(queue, 1)
  let response =
    opto_sync_client.PushResponse(1, "gleam-device", "01", "1", [
      opto_sync_client.MutationResult(
        "1",
        opto_sync_client.Applied,
        None,
        None,
        None,
      ),
    ])
  opto_sync_client.acknowledge(queue, request, response)
  |> should.equal(Error(opto_sync_client.InvalidAcknowledgement))
}

pub fn forged_request_payload_is_rejected_before_confirmation_test() {
  let queue = with_two_pending()
  let forged =
    opto_sync_client.PushRequest(1, "gleam-device", [
      opto_sync_client.PushMutation(
        "1",
        opto_sync_client.Upsert("{\"title\":\"not the queued bytes\"}", False),
        "tasks",
        "a",
        None,
      ),
    ])
  let response =
    opto_sync_client.PushResponse(1, "gleam-device", "1", "1", [
      opto_sync_client.MutationResult(
        "1",
        opto_sync_client.Applied,
        None,
        Some("1"),
        Some("1"),
      ),
    ])
  opto_sync_client.acknowledge(queue, forged, response)
  |> should.equal(Error(opto_sync_client.InvalidAcknowledgement))
  queue
  |> opto_sync_client.pending
  |> list.length
  |> should.equal(2)
}

pub fn reconcile_uses_native_core_test() {
  opto_sync_client.reconcile(
    "{\"title\":\"local\",\"updatedAt\":200}",
    "{\"title\":\"remote\",\"updatedAt\":100}",
  )
  |> should.equal(Ok("{\"title\":\"local\",\"updatedAt\":200}"))
}

pub fn pending_rows_remain_in_order_test() {
  with_two_pending()
  |> opto_sync_client.pending
  |> list.map(fn(mutation) { mutation.mutation_id })
  |> should.equal([1, 2])
}
