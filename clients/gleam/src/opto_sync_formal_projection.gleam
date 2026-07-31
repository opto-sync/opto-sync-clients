/// Canonical, content-free projection of production Gleam queue state for
/// formal trace replay.
///
/// This module deliberately derives its observation from the real public queue
/// and snapshot surfaces instead of maintaining a second queue implementation.
/// It does not claim persistence or reset semantics by itself; those belong to
/// the store used by the eventual JSON-lines/ITF adapter.
import gleam/dynamic/decode
import gleam/int
import gleam/json
import gleam/list
import opto_sync_client

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

/// Observe only protocol state that is stable across storage implementations.
pub fn project(
  queue: opto_sync_client.Queue,
) -> Result(FormalProjection, ProjectionError) {
  case
    json.parse(opto_sync_client.encode_queue(queue), next_mutation_id_decoder())
  {
    Error(_) -> Error(InvalidProductionSnapshot)
    Ok(next_mutation_id) ->
      case parse_positive_canonical_decimal(next_mutation_id) {
        Error(_) -> Error(InvalidProductionSnapshot)
        Ok(next_id) -> {
          let mutations = opto_sync_client.all_mutations(queue)
          let pending_mutation_ids =
            mutations
            |> list.filter(fn(mutation) {
              mutation.status == opto_sync_client.Pending
            })
            |> list.map(mutation_id)
          let confirmed_mutation_ids =
            mutations
            |> list.filter(fn(mutation) {
              mutation.status == opto_sync_client.Confirmed
            })
            |> list.map(mutation_id)

          Ok(FormalProjection(
            next_mutation_id:,
            pending_mutation_ids:,
            confirmed_mutation_ids:,
            allocated_mutation_ids: allocated_ids(1, next_id, []),
            checkpoint: opto_sync_client.checkpoint(queue),
          ))
        }
      }
  }
}

fn next_mutation_id_decoder() -> decode.Decoder(String) {
  use next_mutation_id <- decode.field("nextMutationId", decode.string)
  decode.success(next_mutation_id)
}

fn mutation_id(mutation: opto_sync_client.Mutation) -> String {
  int.to_string(mutation.mutation_id)
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

fn parse_positive_canonical_decimal(value: String) -> Result(Int, Nil) {
  case int.parse(value) {
    Ok(number) if number > 0 ->
      case int.to_string(number) == value {
        True -> Ok(number)
        False -> Error(Nil)
      }
    _ -> Error(Nil)
  }
}
