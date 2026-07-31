import gleam/option.{None}
import gleeunit
import gleeunit/should
import opto_sync_client
import opto_sync_formal_projection

pub fn main() {
  gleeunit.main()
}

fn queue_with_two_pending() {
  let assert Ok(queue) = opto_sync_client.new("formal-gleam-device")
  let assert Ok(#(queue, _)) =
    opto_sync_client.enqueue_upsert(
      queue,
      "docs",
      "record-1",
      "{\"id\":\"record-1\",\"value\":\"1\"}",
      None,
      False,
    )
  let assert Ok(#(queue, _)) =
    opto_sync_client.enqueue_delete(queue, "docs", "record-2", None)
  queue
}

pub fn projection_tracks_production_queue_state_test() {
  let queue = queue_with_two_pending()

  opto_sync_formal_projection.project(queue)
  |> should.equal(
    Ok(opto_sync_formal_projection.FormalProjection(
      next_mutation_id: "3",
      pending_mutation_ids: ["1", "2"],
      confirmed_mutation_ids: [],
      allocated_mutation_ids: ["1", "2"],
      checkpoint: "0",
    )),
  )
}

pub fn projection_preserves_allocated_ids_after_compaction_test() {
  let queue = queue_with_two_pending()
  let assert Ok(request) = opto_sync_client.build_push_request(queue, 1)
  let response =
    opto_sync_client.PushResponse(1, "formal-gleam-device", "1", "9", [
      opto_sync_client.MutationResult(
        "1",
        opto_sync_client.Applied,
        None,
        Some("9"),
        Some("1"),
      ),
    ])
  let assert Ok(queue) = opto_sync_client.acknowledge(queue, request, response)
  let assert Ok(queue) = opto_sync_client.set_checkpoint(queue, "9")
  let queue = opto_sync_client.compact_confirmed(queue)

  opto_sync_formal_projection.project(queue)
  |> should.equal(
    Ok(opto_sync_formal_projection.FormalProjection(
      next_mutation_id: "3",
      pending_mutation_ids: ["2"],
      confirmed_mutation_ids: [],
      allocated_mutation_ids: ["1", "2"],
      checkpoint: "9",
    )),
  )
}

pub fn rejected_acknowledgement_does_not_change_projection_test() {
  let queue = queue_with_two_pending()
  let let_before = opto_sync_formal_projection.project(queue)
  let snapshot_before = opto_sync_client.encode_queue(queue)
  let assert Ok(request) = opto_sync_client.build_push_request(queue, 1)
  let forged_response =
    opto_sync_client.PushResponse(1, "formal-gleam-device", "2", "2", [
      opto_sync_client.MutationResult(
        "2",
        opto_sync_client.Applied,
        None,
        Some("2"),
        Some("2"),
      ),
    ])

  opto_sync_client.acknowledge(queue, request, forged_response)
  |> should.equal(Error(opto_sync_client.InvalidAcknowledgement))
  opto_sync_formal_projection.project(queue)
  |> should.equal(let_before)
  opto_sync_client.encode_queue(queue)
  |> should.equal(snapshot_before)
}

pub fn projection_is_stable_across_snapshot_restore_test() {
  let queue = queue_with_two_pending()
  let before = opto_sync_formal_projection.project(queue)
  let assert Ok(restored) =
    queue
    |> opto_sync_client.encode_queue
    |> opto_sync_client.decode_queue

  opto_sync_formal_projection.project(restored)
  |> should.equal(before)
}
