/// Envelope validation for Gleam (mirror of the shared cross-language
/// contract).
///
/// The source of truth is
/// `opto-sync-clients/schema/opto-sync-envelope.schema.json`; this validator
/// MUST accept/reject exactly the shared fixture corpus in `schema/fixtures/`
/// (enforced by `test/opto_sync_schema_test.gleam`), keeping it in lockstep
/// with the TypeScript (zod), Dart, and Rust validators.
///
/// The decoders are strict where `gleam/dynamic/decode` is lenient by default:
/// an unknown property is an error rather than a silently dropped field, since
/// a typo'd key that is quietly ignored is a column that never syncs.
///
/// ```gleam
/// let assert Ok(envelope) = opto_sync_schema.parse_envelope(blob)
/// use record <- list.each(envelope.records)
/// opto_sync_client.enqueue_upsert(queue, record.table_name, record.record_id, ...)
/// ```
import gleam/dict.{type Dict}
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string

/// The only envelope version this validator accepts, so a decoded `Envelope`
/// does not carry the field.
pub const format_version = 1

const max_source_length = 200

const max_record_id_length = 512

const max_digit_timestamp_length = 20

const max_identifier_length = 63

const envelope_keys = ["formatVersion", "source", "records"]

const record_keys = ["table", "recordId", "operation", "baseRevision", "payload"]

/// Absent in the file means `Upsert`.
pub type Operation {
  Upsert
  Delete
}

/// One validated record. `payload` is left as decoded dynamic values so an
/// application can run its own decoder over the columns it knows about; the
/// envelope contract only owns the timestamp keys.
pub type Record {
  Record(
    table_name: String,
    record_id: String,
    operation: Operation,
    base_revision: Option(String),
    payload: Dict(String, Dynamic),
  )
}

/// A validated ingest envelope. `records` is always non-empty.
pub type Envelope {
  Envelope(source: Option(String), records: List(Record))
}

/// Why an envelope was refused.
pub type ValidationError {
  /// The input is not valid JSON.
  InvalidJson
  /// The document parsed but violates the envelope contract. Every issue
  /// carries the path of the offending value.
  Invalid(issues: List(decode.DecodeError))
}

/// Validate an envelope from its JSON text.
pub fn parse_envelope(envelope_json: String) -> Result(Envelope, ValidationError) {
  case json.parse(envelope_json, envelope_decoder()) {
    Ok(envelope) -> Ok(envelope)
    Error(json.UnableToDecode(issues)) -> Error(Invalid(issues))
    Error(_) -> Error(InvalidJson)
  }
}

/// `parse_envelope` for callers that already hold decoded dynamic data.
pub fn validate_envelope(value: Dynamic) -> Result(Envelope, ValidationError) {
  case decode.run(value, envelope_decoder()) {
    Ok(envelope) -> Ok(envelope)
    Error(issues) -> Error(Invalid(issues))
  }
}

/// The envelope decoder itself, for composing into a larger document.
pub fn envelope_decoder() -> decode.Decoder(Envelope) {
  use fields <- decode.then(decode.dict(decode.string, decode.dynamic))
  use <- reject_unknown_keys(fields, envelope_keys, zero_envelope())
  use _ <- decode.field("formatVersion", format_version_decoder())
  use source <- decode.optional_field("source", None, source_decoder())
  use records <- decode.field("records", records_decoder())
  decode.success(Envelope(source:, records:))
}

fn zero_envelope() -> Envelope {
  Envelope(source: None, records: [])
}

fn zero_record() -> Record {
  Record(
    table_name: "",
    record_id: "",
    operation: Upsert,
    base_revision: None,
    payload: dict.new(),
  )
}

/// Strictness: `gleam/dynamic/decode` ignores properties nobody asked for, and
/// this contract does not.
fn reject_unknown_keys(
  fields: Dict(String, Dynamic),
  allowed: List(String),
  zero: a,
  next: fn() -> decode.Decoder(a),
) -> decode.Decoder(a) {
  let unknown =
    fields
    |> dict.keys
    |> list.filter(fn(key) { !list.contains(allowed, key) })
    |> list.sort(string.compare)
  case unknown {
    [] -> next()
    [key, ..] -> decode.failure(zero, expected: "no unknown property " <> key)
  }
}

fn format_version_decoder() -> decode.Decoder(Int) {
  use value <- decode.then(decode.int)
  case value == format_version {
    True -> decode.success(value)
    False ->
      decode.failure(format_version, expected: "envelope format version 1")
  }
}

fn source_decoder() -> decode.Decoder(Option(String)) {
  use value <- decode.then(decode.string)
  case code_point_length(value) <= max_source_length {
    True -> decode.success(Some(value))
    False ->
      decode.failure(None, expected: "a string of at most 200 characters")
  }
}

fn records_decoder() -> decode.Decoder(List(Record)) {
  use records <- decode.then(decode.list(record_decoder()))
  case records {
    [] -> decode.failure([], expected: "a non-empty array of records")
    _ -> decode.success(records)
  }
}

fn record_decoder() -> decode.Decoder(Record) {
  use fields <- decode.then(decode.dict(decode.string, decode.dynamic))
  use <- reject_unknown_keys(fields, record_keys, zero_record())
  use table_name <- decode.field("table", identifier_decoder())
  use record_id <- decode.field("recordId", record_id_decoder())
  use operation <- decode.optional_field(
    "operation",
    Upsert,
    operation_decoder(),
  )
  use base_revision <- decode.optional_field(
    "baseRevision",
    None,
    base_revision_decoder(),
  )
  use payload <- decode.field("payload", payload_decoder(operation))
  decode.success(Record(
    table_name:,
    record_id:,
    operation:,
    base_revision:,
    payload:,
  ))
}

fn identifier_decoder() -> decode.Decoder(String) {
  use value <- decode.then(decode.string)
  case is_identifier(value) {
    True -> decode.success(value)
    False -> decode.failure("", expected: "a SQL-safe table identifier")
  }
}

fn record_id_decoder() -> decode.Decoder(String) {
  use value <- decode.then(decode.string)
  let length = code_point_length(value)
  case length >= 1 && length <= max_record_id_length {
    True -> decode.success(value)
    False ->
      decode.failure("", expected: "a string of 1..512 characters")
  }
}

fn operation_decoder() -> decode.Decoder(Operation) {
  use value <- decode.then(decode.string)
  case value {
    "upsert" -> decode.success(Upsert)
    "delete" -> decode.success(Delete)
    _ -> decode.failure(Upsert, expected: "upsert or delete")
  }
}

fn base_revision_decoder() -> decode.Decoder(Option(String)) {
  use value <- decode.then(decode.string)
  case is_canonical_decimal(value) {
    True -> decode.success(Some(value))
    False -> decode.failure(None, expected: "a canonical decimal string")
  }
}

/// A delete carries no document; an upsert must carry the timestamp that keeps
/// last-write-wins from being decided by ingest order. `createdAt`/`syncedAt`
/// are optional, and deliberately not required: `createdAt` is not a default
/// first-write-wins key.
fn payload_decoder(operation: Operation) -> decode.Decoder(Dict(String, Dynamic)) {
  use payload <- decode.then(decode.dict(decode.string, decode.dynamic))
  case operation {
    Delete ->
      case dict.is_empty(payload) {
        True -> decode.success(payload)
        False ->
          decode.failure(
            dict.new(),
            expected: "an empty payload on a delete record",
          )
      }
    Upsert -> {
      use _ <- decode.field("updatedAt", timestamp_decoder())
      use _ <- decode.optional_field(
        "createdAt",
        None,
        decode.map(timestamp_decoder(), Some),
      )
      use _ <- decode.optional_field(
        "syncedAt",
        None,
        decode.map(timestamp_decoder(), Some),
      )
      decode.success(payload)
    }
  }
}

/// One timestamp FORMAT per key across all replicas: an epoch integer, a
/// pure-digit string, or a fixed-width ISO-8601 UTC stamp (optionally carrying
/// HLC counter/node suffixes after the `Z`). Mixing epoch and ISO-8601 for one
/// key compares lexicographically and is not chronologically meaningful.
type Timestamp {
  EpochTimestamp(Int)
  TextTimestamp(String)
}

fn timestamp_decoder() -> decode.Decoder(Timestamp) {
  decode.one_of(epoch_timestamp_decoder(), or: [text_timestamp_decoder()])
}

fn epoch_timestamp_decoder() -> decode.Decoder(Timestamp) {
  use value <- decode.then(decode.int)
  case value >= 0 {
    True -> decode.success(EpochTimestamp(value))
    False ->
      decode.failure(EpochTimestamp(0), expected: "a non-negative epoch integer")
  }
}

fn text_timestamp_decoder() -> decode.Decoder(Timestamp) {
  use value <- decode.then(decode.string)
  case is_digit_timestamp(value) || is_iso8601_hlc(value) {
    True -> decode.success(TextTimestamp(value))
    False ->
      decode.failure(
        TextTimestamp(""),
        expected: "a digit string or fixed-width ISO-8601 UTC/HLC timestamp",
      )
  }
}

/// Character rules, checked over code points because that is what JSON Schema
/// `pattern` and `maxLength` count.
fn code_points(value: String) -> List(Int) {
  value
  |> string.to_utf_codepoints
  |> list.map(string.utf_codepoint_to_int)
}

fn code_point_length(value: String) -> Int {
  value |> string.to_utf_codepoints |> list.length
}

fn is_digit(code_point: Int) -> Bool {
  code_point >= 0x30 && code_point <= 0x39
}

fn is_letter(code_point: Int) -> Bool {
  { code_point >= 0x41 && code_point <= 0x5A }
  || { code_point >= 0x61 && code_point <= 0x7A }
}

/// `^[A-Za-z_][A-Za-z0-9_]{0,62}$` — a SQL-safe table identifier.
fn is_identifier(value: String) -> Bool {
  case code_points(value) {
    [] -> False
    [first, ..rest] ->
      { is_letter(first) || first == 0x5F }
      && list.length(rest) < max_identifier_length
      && list.all(rest, fn(point) {
        is_letter(point) || is_digit(point) || point == 0x5F
      })
  }
}

/// `^(?:0|[1-9][0-9]*)$` — a canonical decimal with no leading zero.
fn is_canonical_decimal(value: String) -> Bool {
  case code_points(value) {
    [] -> False
    [0x30] -> True
    [first, ..rest] ->
      is_digit(first) && first != 0x30 && list.all(rest, is_digit)
  }
}

/// `^[0-9]+$` with `maxLength: 20`.
fn is_digit_timestamp(value: String) -> Bool {
  let points = code_points(value)
  let length = list.length(points)
  length >= 1 && length <= max_digit_timestamp_length && list.all(points, is_digit)
}

/// `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$`
///
/// Fixed width up to the `Z` so that string comparison is chronological, which
/// is what the merge core's last-write-wins actually does with these values.
fn is_iso8601_hlc(value: String) -> Bool {
  case match_prefix(code_points(value), code_points("0000-00-00T00:00:00")) {
    Error(_) -> False
    Ok(rest) ->
      case skip_fraction(rest) {
        Error(_) -> False
        // 0x5A is `Z`; anything else means a local or offset timestamp, which
        // is not comparable against the rest of the fleet.
        Ok([0x5A, ..suffix]) -> is_hlc_suffix(suffix)
        Ok(_) -> False
      }
  }
}

/// Match a fixed shape, where `0` in the shape means "any digit" and every
/// other code point is a literal. Returns whatever follows the shape.
fn match_prefix(points: List(Int), shape: List(Int)) -> Result(List(Int), Nil) {
  case shape, points {
    [], rest -> Ok(rest)
    [0x30, ..shape_rest], [point, ..rest] ->
      case is_digit(point) {
        True -> match_prefix(rest, shape_rest)
        False -> Error(Nil)
      }
    [literal, ..shape_rest], [point, ..rest] if point == literal ->
      match_prefix(rest, shape_rest)
    _, _ -> Error(Nil)
  }
}

/// `(\.\d{1,9})?` — optional sub-second precision, up to nanoseconds.
fn skip_fraction(points: List(Int)) -> Result(List(Int), Nil) {
  case points {
    // 0x2E is `.`
    [0x2E, ..rest] -> {
      let digits = list.take_while(rest, is_digit)
      case list.length(digits) {
        length if length >= 1 && length <= 9 -> Ok(list.drop(rest, length))
        _ -> Error(Nil)
      }
    }
    _ -> Ok(points)
  }
}

/// `(-[0-9A-Za-z._~-]+)*` — HLC counter/node suffixes. Because `-` is itself in
/// the character class, repeated groups collapse to: nothing at all, or a
/// leading `-` followed by at least one more character from the class.
fn is_hlc_suffix(points: List(Int)) -> Bool {
  case points {
    [] -> True
    // 0x2D is `-`
    [0x2D, _, ..] -> list.all(points, is_suffix_point)
    _ -> False
  }
}

fn is_suffix_point(code_point: Int) -> Bool {
  is_letter(code_point)
  || is_digit(code_point)
  // `.`, `_`, `~`, `-`
  || code_point == 0x2E
  || code_point == 0x5F
  || code_point == 0x7E
  || code_point == 0x2D
}
