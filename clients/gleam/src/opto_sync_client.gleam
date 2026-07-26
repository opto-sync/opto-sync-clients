/// Transport-neutral opto-sync protocol v1 queue for Gleam.
///
/// Store the returned `Queue` in the same database transaction as an
/// optimistic application write. The queue deliberately performs no HTTP or
/// database I/O, so applications can pair it with their BEAM persistence and
/// transport libraries without hidden retry behaviour.
import gleam/dynamic/decode
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import opto_sync

const max_postgres_bigint = 9_223_372_036_854_775_807

pub type ProtocolError {
  EmptyClientId
  InvalidLimit
  InvalidQueueLimit
  InvalidPayload
  InvalidSnapshot
  QueueFull
  PayloadTooLarge
  MutationIdExhausted
  WrongClient
  InvalidAcknowledgement
  WatermarkAhead
}

pub type Operation {
  Upsert(payload_json: String, resurrect: Bool)
  Delete
}

pub type LocalStatus {
  Pending
  Confirmed
}

pub type Mutation {
  Mutation(
    mutation_id: Int,
    operation: Operation,
    table_name: String,
    record_id: String,
    base_revision: Option(String),
    status: LocalStatus,
  )
}

pub type PushMutation {
  PushMutation(
    mutation_id: String,
    operation: Operation,
    table_name: String,
    record_id: String,
    base_revision: Option(String),
  )
}

pub type PushRequest {
  PushRequest(
    protocol_version: Int,
    client_id: String,
    mutations: List(PushMutation),
  )
}

pub type ResultStatus {
  Applied
  Duplicate
  Rejected
}

pub type MutationResult {
  MutationResult(
    mutation_id: String,
    status: ResultStatus,
    original_status: Option(ResultStatus),
    checkpoint: Option(String),
    revision: Option(String),
  )
}

pub type PushResponse {
  PushResponse(
    protocol_version: Int,
    client_id: String,
    last_mutation_id: String,
    checkpoint: String,
    results: List(MutationResult),
  )
}

pub opaque type Queue {
  Queue(
    client_id: String,
    next_mutation_id: Int,
    checkpoint: Int,
    mutations: List(Mutation),
    max_pending_mutations: Int,
    max_queued_payload_bytes: Int,
  )
}

/// Construct a bounded queue with production defaults.
pub fn new(client_id: String) -> Result(Queue, ProtocolError) {
  new_with_limits(client_id, 10_000, 255 * 1024)
}

/// Construct a queue with explicit resource limits.
pub fn new_with_limits(
  client_id: String,
  max_pending_mutations: Int,
  max_queued_payload_bytes: Int,
) -> Result(Queue, ProtocolError) {
  case client_id, max_pending_mutations, max_queued_payload_bytes {
    "", _, _ -> Error(EmptyClientId)
    _, pending, _ if pending <= 0 -> Error(InvalidQueueLimit)
    _, _, bytes if bytes <= 0 -> Error(InvalidQueueLimit)
    _, _, _ ->
      Ok(Queue(
        client_id:,
        next_mutation_id: 1,
        checkpoint: 0,
        mutations: [],
        max_pending_mutations:,
        max_queued_payload_bytes:,
      ))
  }
}

/// Add an upsert. The JSON is kept byte-for-byte for an immutable retry.
pub fn enqueue_upsert(
  queue: Queue,
  table_name: String,
  record_id: String,
  payload_json: String,
  base_revision: Option(String),
  resurrect: Bool,
) -> Result(#(Queue, Mutation), ProtocolError) {
  enqueue(
    queue,
    table_name,
    record_id,
    Upsert(payload_json:, resurrect:),
    base_revision,
  )
}

/// Add a tombstone mutation.
pub fn enqueue_delete(
  queue: Queue,
  table_name: String,
  record_id: String,
  base_revision: Option(String),
) -> Result(#(Queue, Mutation), ProtocolError) {
  enqueue(queue, table_name, record_id, Delete, base_revision)
}

fn enqueue(
  queue: Queue,
  table_name: String,
  record_id: String,
  operation: Operation,
  base_revision: Option(String),
) -> Result(#(Queue, Mutation), ProtocolError) {
  let Queue(
    client_id,
    next_mutation_id,
    checkpoint,
    mutations,
    max_pending_mutations,
    max_queued_payload_bytes,
  ) = queue
  let pending_count =
    mutations
    |> list.filter(fn(mutation) { mutation.status == Pending })
    |> list.length
  let payload_too_large = case operation {
    Upsert(payload_json, _) ->
      string.byte_size(payload_json) > max_queued_payload_bytes
    Delete -> False
  }
  let invalid_payload = case operation {
    Upsert(payload_json, _) -> !payload_is_object(payload_json)
    Delete -> False
  }

  case
    pending_count >= max_pending_mutations,
    payload_too_large,
    invalid_payload,
    next_mutation_id > max_postgres_bigint
  {
    True, _, _, _ -> Error(QueueFull)
    _, True, _, _ -> Error(PayloadTooLarge)
    _, _, True, _ -> Error(InvalidPayload)
    _, _, _, True -> Error(MutationIdExhausted)
    _, _, _, _ -> {
      let mutation =
        Mutation(
          mutation_id: next_mutation_id,
          operation:,
          table_name:,
          record_id:,
          base_revision:,
          status: Pending,
        )
      Ok(#(
        Queue(
          client_id:,
          next_mutation_id: next_mutation_id + 1,
          checkpoint:,
          mutations: list.append(mutations, [mutation]),
          max_pending_mutations:,
          max_queued_payload_bytes:,
        ),
        mutation,
      ))
    }
  }
}

fn payload_is_object(payload_json: String) -> Bool {
  case json.parse(payload_json, decode.dict(decode.string, decode.dynamic)) {
    Ok(_) -> True
    Error(_) -> False
  }
}

/// Build an immutable, insertion-ordered push batch.
pub fn build_push_request(
  queue: Queue,
  limit: Int,
) -> Result(PushRequest, ProtocolError) {
  let Queue(client_id, _, _, mutations, _, _) = queue
  case limit >= 1 && limit <= 100 {
    False -> Error(InvalidLimit)
    True -> {
      let batch =
        mutations
        |> list.filter(fn(mutation) { mutation.status == Pending })
        |> list.take(limit)
        |> list.map(fn(mutation) {
          PushMutation(
            mutation_id: int.to_string(mutation.mutation_id),
            operation: mutation.operation,
            table_name: mutation.table_name,
            record_id: mutation.record_id,
            base_revision: mutation.base_revision,
          )
        })
      Ok(PushRequest(protocol_version: 1, client_id:, mutations: batch))
    }
  }
}

/// Encode the exact protocol v1 wire envelope. Upsert payloads were validated
/// as JSON objects at enqueue time and are embedded without a lossy dynamic
/// conversion, preserving an immutable retry body.
pub fn encode_push_request(request: PushRequest) -> String {
  let PushRequest(protocol_version, client_id, mutations) = request
  "{"
  <> encode_key("protocolVersion")
  <> ":"
  <> int.to_string(protocol_version)
  <> ","
  <> encode_key("clientId")
  <> ":"
  <> encode_string(client_id)
  <> ","
  <> encode_key("mutations")
  <> ":["
  <> string.join(list.map(mutations, encode_push_mutation), ",")
  <> "]}"
}

fn encode_push_mutation(mutation: PushMutation) -> String {
  let PushMutation(mutation_id, operation, table_name, record_id, base_revision) =
    mutation
  let common = [
    encode_key("mutationId") <> ":" <> encode_string(mutation_id),
    encode_key("operation")
      <> ":"
      <> encode_string(case operation {
      Upsert(_, _) -> "upsert"
      Delete -> "delete"
    }),
    encode_key("table") <> ":" <> encode_string(table_name),
    encode_key("recordId") <> ":" <> encode_string(record_id),
  ]
  let with_base = case base_revision {
    Some(revision) ->
      list.append(common, [
        encode_key("baseRevision") <> ":" <> encode_string(revision),
      ])
    None -> common
  }
  let fields = case operation {
    Delete -> with_base
    Upsert(payload_json, resurrect) -> {
      let fields =
        list.append(with_base, [encode_key("payload") <> ":" <> payload_json])
      case resurrect {
        True -> list.append(fields, [encode_key("resurrect") <> ":true"])
        False -> fields
      }
    }
  }
  "{" <> string.join(fields, ",") <> "}"
}

fn encode_key(value: String) -> String {
  encode_string(value)
}

fn encode_string(value: String) -> String {
  json.string(value)
  |> json.to_string
}

/// Decode a server push response into typed data. Unknown statuses, missing
/// fields, and wrong JSON types are rejected before queue state can change.
pub fn decode_push_response(
  response_json: String,
) -> Result(PushResponse, ProtocolError) {
  case json.parse(response_json, push_response_decoder()) {
    Ok(response) -> Ok(response)
    Error(_) -> Error(InvalidAcknowledgement)
  }
}

fn push_response_decoder() -> decode.Decoder(PushResponse) {
  use protocol_version <- decode.field("protocolVersion", decode.int)
  use client_id <- decode.field("clientId", decode.string)
  use last_mutation_id <- decode.field("lastMutationId", decode.string)
  use checkpoint <- decode.field("checkpoint", decode.string)
  use results <- decode.field("results", decode.list(mutation_result_decoder()))
  decode.success(PushResponse(
    protocol_version:,
    client_id:,
    last_mutation_id:,
    checkpoint:,
    results:,
  ))
}

fn mutation_result_decoder() -> decode.Decoder(MutationResult) {
  use mutation_id <- decode.field("mutationId", decode.string)
  use status <- decode.field("status", result_status_decoder())
  use original_status <- decode.optional_field(
    "originalStatus",
    None,
    decode.optional(result_status_decoder()),
  )
  use checkpoint <- decode.optional_field(
    "checkpoint",
    None,
    decode.optional(decode.string),
  )
  use revision <- decode.optional_field(
    "revision",
    None,
    decode.optional(decode.string),
  )
  case status, original_status {
    Duplicate, Some(Applied)
    | Duplicate, Some(Rejected)
    | Applied, None
    | Rejected, None
    ->
      decode.success(MutationResult(
        mutation_id:,
        status:,
        original_status:,
        checkpoint:,
        revision:,
      ))
    _, _ ->
      decode.failure(
        MutationResult(
          mutation_id:,
          status:,
          original_status:,
          checkpoint:,
          revision:,
        ),
        expected: "duplicate provenance",
      )
  }
}

fn result_status_decoder() -> decode.Decoder(ResultStatus) {
  use value <- decode.then(decode.string)
  case value {
    "applied" -> decode.success(Applied)
    "duplicate" -> decode.success(Duplicate)
    "rejected" -> decode.success(Rejected)
    _ -> decode.failure(Applied, expected: "protocol result status")
  }
}

/// Validate that a response covers exactly the immutable request, then mark
/// those rows confirmed. A push checkpoint never advances the pull cursor:
/// doing so could skip concurrent changes that have not been pulled yet.
pub fn acknowledge(
  queue: Queue,
  request: PushRequest,
  response: PushResponse,
) -> Result(Queue, ProtocolError) {
  let Queue(
    client_id,
    next_mutation_id,
    current_checkpoint,
    mutations,
    max_pending_mutations,
    max_queued_payload_bytes,
  ) = queue

  let PushRequest(_, _, requested) = request
  case build_push_request(queue, list.length(requested)) {
    Ok(expected_request) if expected_request == request ->
      case response.client_id == client_id {
        False -> Error(WrongClient)
        True ->
          case validate_response(request, response) {
            Error(error) -> Error(error)
            Ok(#(confirmed_ids, mutation_watermark)) ->
              case mutation_watermark > next_mutation_id - 1 {
                True -> Error(WatermarkAhead)
                False -> {
                  let updated =
                    mutations
                    |> list.map(fn(mutation) {
                      case list.contains(confirmed_ids, mutation.mutation_id) {
                        True -> Mutation(..mutation, status: Confirmed)
                        False -> mutation
                      }
                    })
                  Ok(Queue(
                    client_id:,
                    next_mutation_id:,
                    checkpoint: current_checkpoint,
                    mutations: updated,
                    max_pending_mutations:,
                    max_queued_payload_bytes:,
                  ))
                }
              }
          }
      }
    _ -> Error(InvalidAcknowledgement)
  }
}

fn validate_response(
  request: PushRequest,
  response: PushResponse,
) -> Result(#(List(Int), Int), ProtocolError) {
  let PushRequest(request_version, request_client, requested) = request
  let PushResponse(
    response_version,
    response_client,
    last_mutation_id,
    checkpoint,
    results,
  ) = response

  case
    request_version == 1,
    response_version == 1,
    request_client == response_client,
    list.length(requested) == list.length(results),
    requested,
    parse_decimal(checkpoint)
  {
    True, True, True, True, [_first, ..], Ok(_parsed_checkpoint) ->
      case
        ids_match(requested, results),
        list.last(requested),
        parse_decimal(last_mutation_id)
      {
        Ok(ids), Ok(last), Ok(parsed_last)
          if last.mutation_id == last_mutation_id
          && parsed_last <= max_postgres_bigint
        -> Ok(#(ids, parsed_last))
        _, _, _ -> Error(InvalidAcknowledgement)
      }
    _, _, _, _, _, _ -> Error(InvalidAcknowledgement)
  }
}

/// Advance the pull cursor only after all changes through this checkpoint have
/// been durably applied in the same transaction.
pub fn set_checkpoint(
  queue: Queue,
  checkpoint: String,
) -> Result(Queue, ProtocolError) {
  case parse_decimal(checkpoint) {
    Error(_) -> Error(InvalidAcknowledgement)
    Ok(parsed_checkpoint) -> {
      let Queue(
        client_id,
        next_mutation_id,
        current_checkpoint,
        mutations,
        max_pending_mutations,
        max_queued_payload_bytes,
      ) = queue
      Ok(Queue(
        client_id:,
        next_mutation_id:,
        checkpoint: int.max(current_checkpoint, parsed_checkpoint),
        mutations:,
        max_pending_mutations:,
        max_queued_payload_bytes:,
      ))
    }
  }
}

fn ids_match(
  mutations: List(PushMutation),
  results: List(MutationResult),
) -> Result(List(Int), Nil) {
  case mutations, results {
    [], [] -> Ok([])
    [mutation, ..mutations], [result, ..results] ->
      case
        mutation.mutation_id == result.mutation_id,
        parse_positive_decimal(mutation.mutation_id),
        valid_optional_decimal(result.checkpoint, False),
        valid_optional_decimal(result.revision, True),
        ids_match(mutations, results)
      {
        True, Ok(id), True, True, Ok(ids) -> Ok([id, ..ids])
        _, _, _, _, _ -> Error(Nil)
      }
    _, _ -> Error(Nil)
  }
}

fn valid_optional_decimal(value: Option(String), positive: Bool) -> Bool {
  case value {
    None -> True
    Some(value) ->
      case positive {
        True -> parse_positive_decimal(value) |> result_is_ok
        False -> parse_decimal(value) |> result_is_ok
      }
  }
}

fn result_is_ok(value: Result(a, e)) -> Bool {
  case value {
    Ok(_) -> True
    Error(_) -> False
  }
}

fn parse_decimal(value: String) -> Result(Int, Nil) {
  case int.parse(value) {
    Ok(number) ->
      case
        number >= 0,
        int.to_string(number) == value,
        number <= max_postgres_bigint
      {
        True, True, True -> Ok(number)
        _, _, _ -> Error(Nil)
      }
    _ -> Error(Nil)
  }
}

fn parse_positive_decimal(value: String) -> Result(Int, Nil) {
  case parse_decimal(value) {
    Ok(number) if number > 0 -> Ok(number)
    _ -> Error(Nil)
  }
}

/// Remove confirmed rows after their optimistic state is durably committed.
pub fn compact_confirmed(queue: Queue) -> Queue {
  let Queue(
    client_id,
    next_mutation_id,
    checkpoint,
    mutations,
    max_pending_mutations,
    max_queued_payload_bytes,
  ) = queue
  Queue(
    client_id:,
    next_mutation_id:,
    checkpoint:,
    mutations: list.filter(mutations, fn(mutation) {
      mutation.status == Pending
    }),
    max_pending_mutations:,
    max_queued_payload_bytes:,
  )
}

pub fn pending(queue: Queue) -> List(Mutation) {
  let Queue(_, _, _, mutations, _, _) = queue
  list.filter(mutations, fn(mutation) { mutation.status == Pending })
}

pub fn all_mutations(queue: Queue) -> List(Mutation) {
  let Queue(_, _, _, mutations, _, _) = queue
  mutations
}

pub fn checkpoint(queue: Queue) -> String {
  let Queue(_, _, checkpoint, _, _, _) = queue
  int.to_string(checkpoint)
}

pub fn client_id(queue: Queue) -> String {
  let Queue(client_id, _, _, _, _, _) = queue
  client_id
}

/// Serialize all durable protocol state. Payload JSON is encoded as a string,
/// not parsed and re-emitted, so an ambiguous retry is byte-identical after a
/// process restart.
pub fn encode_queue(queue: Queue) -> String {
  let Queue(
    client_id,
    next_mutation_id,
    checkpoint,
    mutations,
    max_pending_mutations,
    max_queued_payload_bytes,
  ) = queue
  json.object([
    #("version", json.int(1)),
    #("clientId", json.string(client_id)),
    #("nextMutationId", json.string(int.to_string(next_mutation_id))),
    #("checkpoint", json.string(int.to_string(checkpoint))),
    #("mutations", json.array(mutations, of: encode_snapshot_mutation)),
    #("maxPendingMutations", json.int(max_pending_mutations)),
    #("maxQueuedPayloadBytes", json.int(max_queued_payload_bytes)),
  ])
  |> json.to_string
}

fn encode_snapshot_mutation(mutation: Mutation) -> json.Json {
  let #(operation, payload_json, resurrect) = case mutation.operation {
    Upsert(payload_json, resurrect) -> #(
      "upsert",
      Some(payload_json),
      resurrect,
    )
    Delete -> #("delete", None, False)
  }
  json.object([
    #("mutationId", json.string(int.to_string(mutation.mutation_id))),
    #("operation", json.string(operation)),
    #("table", json.string(mutation.table_name)),
    #("recordId", json.string(mutation.record_id)),
    #("payloadJson", json.nullable(payload_json, of: json.string)),
    #("baseRevision", json.nullable(mutation.base_revision, of: json.string)),
    #("resurrect", json.bool(resurrect)),
    #(
      "status",
      json.string(case mutation.status {
        Pending -> "pending"
        Confirmed -> "confirmed"
      }),
    ),
  ])
}

/// Restore a versioned queue snapshot, rejecting malformed, reordered,
/// over-limit, noncanonical, or internally inconsistent state.
pub fn decode_queue(snapshot_json: String) -> Result(Queue, ProtocolError) {
  case json.parse(snapshot_json, queue_snapshot_decoder()) {
    Error(_) -> Error(InvalidSnapshot)
    Ok(#(
      client_id,
      next_mutation_id,
      checkpoint,
      mutations,
      max_pending_mutations,
      max_queued_payload_bytes,
    )) ->
      case
        client_id == "",
        parse_positive_decimal(next_mutation_id),
        parse_decimal(checkpoint),
        max_pending_mutations > 0,
        max_queued_payload_bytes > 0
      {
        False, Ok(next), Ok(checkpoint), True, True
          if next <= max_postgres_bigint + 1
        ->
          validate_restored_queue(
            client_id,
            next,
            checkpoint,
            mutations,
            max_pending_mutations,
            max_queued_payload_bytes,
          )
        _, _, _, _, _ -> Error(InvalidSnapshot)
      }
  }
}

fn queue_snapshot_decoder() -> decode.Decoder(
  #(String, String, String, List(Mutation), Int, Int),
) {
  use version <- decode.field("version", decode.int)
  use client_id <- decode.field("clientId", decode.string)
  use next_mutation_id <- decode.field("nextMutationId", decode.string)
  use checkpoint <- decode.field("checkpoint", decode.string)
  use mutations <- decode.field(
    "mutations",
    decode.list(snapshot_mutation_decoder()),
  )
  use max_pending_mutations <- decode.field("maxPendingMutations", decode.int)
  use max_queued_payload_bytes <- decode.field(
    "maxQueuedPayloadBytes",
    decode.int,
  )
  case version {
    1 ->
      decode.success(#(
        client_id,
        next_mutation_id,
        checkpoint,
        mutations,
        max_pending_mutations,
        max_queued_payload_bytes,
      ))
    _ ->
      decode.failure(
        #("", "", "", [], 0, 0),
        expected: "queue snapshot version 1",
      )
  }
}

fn snapshot_mutation_decoder() -> decode.Decoder(Mutation) {
  use mutation_id <- decode.field("mutationId", decimal_decoder(True))
  use operation <- snapshot_operation_decoder()
  use table_name <- decode.field("table", decode.string)
  use record_id <- decode.field("recordId", decode.string)
  use base_revision <- decode.optional_field(
    "baseRevision",
    None,
    decode.optional(decode.string),
  )
  use status <- decode.field("status", local_status_decoder())
  decode.success(Mutation(
    mutation_id:,
    operation:,
    table_name:,
    record_id:,
    base_revision:,
    status:,
  ))
}

fn snapshot_operation_decoder(
  next: fn(Operation) -> decode.Decoder(a),
) -> decode.Decoder(a) {
  use operation <- decode.field("operation", decode.string)
  case operation {
    "delete" -> next(Delete)
    "upsert" -> {
      use payload_json <- decode.field("payloadJson", decode.string)
      use resurrect <- decode.optional_field("resurrect", False, decode.bool)
      next(Upsert(payload_json:, resurrect:))
    }
    _ ->
      decode.failure(Delete, expected: "snapshot operation upsert or delete")
      |> decode.then(next)
  }
}

fn local_status_decoder() -> decode.Decoder(LocalStatus) {
  use value <- decode.then(decode.string)
  case value {
    "pending" -> decode.success(Pending)
    "confirmed" -> decode.success(Confirmed)
    _ -> decode.failure(Pending, expected: "pending or confirmed")
  }
}

fn decimal_decoder(positive: Bool) -> decode.Decoder(Int) {
  use value <- decode.then(decode.string)
  let parsed = case positive {
    True -> parse_positive_decimal(value)
    False -> parse_decimal(value)
  }
  case parsed {
    Ok(value) -> decode.success(value)
    Error(_) -> decode.failure(0, expected: "canonical decimal string")
  }
}

fn validate_restored_queue(
  client_id: String,
  next_mutation_id: Int,
  checkpoint: Int,
  mutations: List(Mutation),
  max_pending_mutations: Int,
  max_queued_payload_bytes: Int,
) -> Result(Queue, ProtocolError) {
  let pending_count =
    mutations
    |> list.filter(fn(mutation) { mutation.status == Pending })
    |> list.length
  case
    pending_count <= max_pending_mutations,
    validate_restored_mutations(
      mutations,
      0,
      next_mutation_id,
      max_queued_payload_bytes,
    )
  {
    True, True ->
      Ok(Queue(
        client_id:,
        next_mutation_id:,
        checkpoint:,
        mutations:,
        max_pending_mutations:,
        max_queued_payload_bytes:,
      ))
    _, _ -> Error(InvalidSnapshot)
  }
}

fn validate_restored_mutations(
  mutations: List(Mutation),
  prior_id: Int,
  next_mutation_id: Int,
  max_payload_bytes: Int,
) -> Bool {
  case mutations {
    [] -> True
    [mutation, ..rest] -> {
      let valid_operation = case mutation.operation {
        Delete -> True
        Upsert(payload_json, _) ->
          string.byte_size(payload_json) <= max_payload_bytes
          && payload_is_object(payload_json)
      }
      mutation.mutation_id > prior_id
      && mutation.mutation_id < next_mutation_id
      && valid_operation
      && validate_restored_mutations(
        rest,
        mutation.mutation_id,
        next_mutation_id,
        max_payload_bytes,
      )
    }
  }
}

/// Reconcile two JSON records through the same native C engine as every other
/// SDK. This is separate from queue state so callers control transaction
/// boundaries.
pub fn reconcile(
  local_json: String,
  remote_json: String,
) -> Result(String, opto_sync.MergeError) {
  opto_sync.merge(local_json, remote_json)
}
