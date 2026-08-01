//// The Gleam validator against the SHARED cross-language fixture corpus.
////
//// `schema/fixtures/` is the same directory the TypeScript, Dart, and Rust
//// suites read. It is located by walking up from the package rather than
//// copied, so a fixture added for one language immediately binds all four.

import gleam/dict
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import gleeunit/should
import opto_sync_schema.{Delete, Invalid, InvalidJson, Upsert}

@external(erlang, "opto_sync_schema_test_ffi", "cwd")
fn cwd() -> String

@external(erlang, "opto_sync_schema_test_ffi", "parent")
fn parent(path: String) -> String

@external(erlang, "opto_sync_schema_test_ffi", "is_directory")
fn is_directory(path: String) -> Bool

@external(erlang, "opto_sync_schema_test_ffi", "list_directory")
fn list_directory(path: String) -> Result(List(String), Nil)

@external(erlang, "opto_sync_schema_test_ffi", "read_file")
fn read_file(path: String) -> Result(String, Nil)

fn fixtures() -> String {
  walk_up(cwd(), 12)
}

fn walk_up(directory: String, remaining: Int) -> String {
  let candidate = directory <> "/schema/fixtures"
  case is_directory(candidate), remaining {
    True, _ -> candidate
    False, 0 -> panic as "could not locate schema/fixtures above the test cwd"
    False, _ -> {
      let above = parent(directory)
      case above == directory {
        True -> panic as "could not locate schema/fixtures above the filesystem root"
        False -> walk_up(above, remaining - 1)
      }
    }
  }
}

/// Fixture contents keyed by file name, sorted so a failure names the same
/// file in every language.
fn json_fixtures(subdirectory: String) -> List(#(String, String)) {
  let directory = fixtures() <> "/" <> subdirectory
  let assert Ok(names) = list_directory(directory)
  names
  |> list.filter(string.ends_with(_, ".json"))
  |> list.map(fn(name) {
    let assert Ok(contents) = read_file(directory <> "/" <> name)
    #(name, contents)
  })
}

pub fn accepts_every_shared_valid_fixture_test() {
  let files = json_fixtures("valid")
  { list.length(files) >= 3 } |> should.be_true
  use #(name, contents) <- list.each(files)
  case opto_sync_schema.parse_envelope(contents) {
    Ok(envelope) -> { envelope.records != [] } |> should.be_true
    Error(error) ->
      panic as { name <> " must parse: " <> string.inspect(error) }
  }
}

pub fn rejects_every_shared_invalid_fixture_test() {
  let files = json_fixtures("invalid")
  { list.length(files) >= 4 } |> should.be_true
  use #(name, contents) <- list.each(files)
  case opto_sync_schema.parse_envelope(contents) {
    Error(Invalid(issues)) -> { issues != [] } |> should.be_true
    other -> panic as { name <> " must be rejected: " <> string.inspect(other) }
  }
}

/// Every valid fixture decodes to the same records the other clients see.
pub fn decodes_the_nested_keyed_array_fixture_test() {
  let assert Ok(contents) =
    read_file(fixtures() <> "/valid/nested-keyed-arrays.json")
  let assert Ok(envelope) = opto_sync_schema.parse_envelope(contents)
  envelope.source |> should.equal(None)

  let assert [first, second] = envelope.records
  first.table_name |> should.equal("documents")
  first.record_id |> should.equal("doc-9")
  first.operation |> should.equal(Upsert)
  first.base_revision |> should.equal(Some("41"))
  second.record_id |> should.equal("doc-10")
  second.operation |> should.equal(Delete)
}

// --------------------------------------------------------------------------
// Targeted rejection rules
// --------------------------------------------------------------------------

fn envelope_with(record_json: String) -> String {
  "{\"formatVersion\":1,\"records\":[" <> record_json <> "]}"
}

fn upsert_with(payload_json: String) -> String {
  "{\"table\":\"todos\",\"recordId\":\"todo-1\",\"payload\":"
  <> payload_json
  <> "}"
}

fn upsert_with_updated_at(timestamp_json: String) -> String {
  envelope_with(upsert_with("{\"updatedAt\":" <> timestamp_json <> "}"))
}

fn should_reject(envelope_json: String) -> Nil {
  case opto_sync_schema.parse_envelope(envelope_json) {
    Error(Invalid(_)) -> Nil
    other -> panic as { "must be rejected: " <> string.inspect(other) }
  }
}

fn should_accept(envelope_json: String) -> Nil {
  opto_sync_schema.parse_envelope(envelope_json) |> should.be_ok
  Nil
}

pub fn accepts_a_minimal_upsert_test() {
  let assert Ok(envelope) =
    opto_sync_schema.parse_envelope(
      "{\"formatVersion\":1,\"source\":\"unit-fixture\",\"records\":["
      <> upsert_with("{\"updatedAt\":\"2026-07-30T12:00:00Z\",\"t\":\"milk\"}")
      <> "]}",
    )
  envelope.source |> should.equal(Some("unit-fixture"))
  let assert [record] = envelope.records
  record.table_name |> should.equal("todos")
  record.record_id |> should.equal("todo-1")
  // Absent means upsert.
  record.operation |> should.equal(Upsert)
  record.base_revision |> should.equal(None)
  // The payload is the application's document; only timestamps are validated.
  dict.has_key(record.payload, "t") |> should.be_true
}

pub fn rejects_an_explicit_null_for_an_optional_field_test() {
  // DELIBERATE, and a place the two reference validators disagree: the JSON
  // Schema and the zod client reject `null` for an optional field (absent and
  // null are different things), while the Dart client's `!= null` guards treat
  // null as absent and accept all four of these. Following the schema keeps a
  // null a producer wrote by accident from becoming a value nobody validated.
  should_reject(
    "{\"formatVersion\":1,\"source\":null,\"records\":["
    <> upsert_with("{\"updatedAt\":1}")
    <> "]}",
  )
  should_reject(
    envelope_with(
      "{\"table\":\"todos\",\"recordId\":\"t\",\"operation\":null,\"payload\":{\"updatedAt\":1}}",
    ),
  )
  should_reject(
    envelope_with(
      "{\"table\":\"todos\",\"recordId\":\"t\",\"baseRevision\":null,\"payload\":{\"updatedAt\":1}}",
    ),
  )
  should_reject(
    envelope_with(upsert_with("{\"updatedAt\":1,\"createdAt\":null}")),
  )
}

pub fn rejects_a_table_identifier_that_is_not_sql_safe_test() {
  should_reject(
    envelope_with(
      "{\"table\":\"todos; DROP TABLE users\",\"recordId\":\"t\",\"payload\":{\"updatedAt\":1}}",
    ),
  )
  should_reject(
    envelope_with("{\"table\":\"\",\"recordId\":\"t\",\"payload\":{\"updatedAt\":1}}"),
  )
  should_reject(
    envelope_with(
      "{\"table\":\"9lives\",\"recordId\":\"t\",\"payload\":{\"updatedAt\":1}}",
    ),
  )
  should_reject(
    envelope_with(
      "{\"table\":\"dash-ed\",\"recordId\":\"t\",\"payload\":{\"updatedAt\":1}}",
    ),
  )
  // A leading underscore is legal in the envelope contract.
  should_accept(
    envelope_with(
      "{\"table\":\"_private\",\"recordId\":\"t\",\"payload\":{\"updatedAt\":1}}",
    ),
  )
}

pub fn rejects_a_delete_that_carries_a_payload_test() {
  should_reject(
    envelope_with(
      "{\"table\":\"todos\",\"recordId\":\"t\",\"operation\":\"delete\","
      <> "\"payload\":{\"updatedAt\":\"2026-07-30T12:00:00Z\",\"title\":\"stale\"}}",
    ),
  )
  // A delete needs no updatedAt: the tombstone is the write.
  should_accept(
    envelope_with(
      "{\"table\":\"todos\",\"recordId\":\"t\",\"operation\":\"delete\",\"payload\":{}}",
    ),
  )
}

pub fn rejects_an_upsert_without_updated_at_test() {
  // Without it, last-write-wins is decided by ingest order.
  should_reject(envelope_with(upsert_with("{\"title\":\"no timestamp\"}")))
  should_reject(envelope_with(upsert_with("{}")))
}

pub fn rejects_an_invalid_optional_timestamp_test() {
  should_reject(
    envelope_with(upsert_with("{\"updatedAt\":1,\"createdAt\":\"yesterday\"}")),
  )
  should_reject(
    envelope_with(upsert_with("{\"updatedAt\":1,\"syncedAt\":-1}")),
  )
  should_accept(
    envelope_with(upsert_with(
      "{\"updatedAt\":1,\"createdAt\":\"2026-01-02T03:04:05Z\",\"syncedAt\":\"1753876800123\"}",
    )),
  )
}

pub fn rejects_a_format_version_other_than_one_test() {
  should_reject(
    "{\"formatVersion\":2,\"records\":["
    <> upsert_with("{\"updatedAt\":1}")
    <> "]}",
  )
  // A stringly-typed version is a different file format, not this one.
  should_reject(
    "{\"formatVersion\":\"1\",\"records\":["
    <> upsert_with("{\"updatedAt\":1}")
    <> "]}",
  )
  should_reject("{\"records\":[" <> upsert_with("{\"updatedAt\":1}") <> "]}")
  // DELIBERATE: `1.0` is a float, not the integer literal 1, and this validator
  // applies that rule uniformly — the same reason it rejects a `1.0` timestamp.
  // Both reference validators accept it here (zod because `JSON.parse`
  // collapses `1.0` to `1`, Dart because `1.0 == 1` is numeric equality), yet
  // Dart still rejects `"updatedAt": 1.0` because that check is a type test.
  should_reject(
    "{\"formatVersion\":1.0,\"records\":["
    <> upsert_with("{\"updatedAt\":1}")
    <> "]}",
  )
}

pub fn rejects_an_empty_records_array_test() {
  should_reject("{\"formatVersion\":1,\"records\":[]}")
  should_reject("{\"formatVersion\":1}")
  should_reject("{\"formatVersion\":1,\"records\":{}}")
}

pub fn rejects_unknown_properties_test() {
  // Strict on purpose: a typo'd key that is silently dropped is a field that
  // never syncs, discovered months later.
  should_reject(
    "{\"formatVersion\":1,\"recordsCount\":1,\"records\":["
    <> upsert_with("{\"updatedAt\":1}")
    <> "]}",
  )
  should_reject(
    envelope_with(
      "{\"table\":\"todos\",\"recordId\":\"t\",\"tabel\":\"todos\",\"payload\":{\"updatedAt\":1}}",
    ),
  )
  // ...but the payload is free-form beyond its timestamps.
  should_accept(
    envelope_with(upsert_with(
      "{\"updatedAt\":1,\"anything\":{\"nested\":[1,2,3]}}",
    )),
  )
}

pub fn rejects_a_non_canonical_base_revision_test() {
  use revision <- list.each(["\"041\"", "\"\"", "\"-1\"", "\"1.0\"", "41"])
  should_reject(
    envelope_with(
      "{\"table\":\"todos\",\"recordId\":\"t\",\"baseRevision\":"
      <> revision
      <> ",\"payload\":{\"updatedAt\":1}}",
    ),
  )
}

pub fn accepts_a_canonical_base_revision_test() {
  use revision <- list.each(["\"0\"", "\"41\"", "\"9007199254740993\""])
  should_accept(
    envelope_with(
      "{\"table\":\"todos\",\"recordId\":\"t\",\"baseRevision\":"
      <> revision
      <> ",\"payload\":{\"updatedAt\":1}}",
    ),
  )
}

pub fn rejects_a_record_id_outside_one_to_512_characters_test() {
  should_reject(
    envelope_with("{\"table\":\"todos\",\"recordId\":\"\",\"payload\":{\"updatedAt\":1}}"),
  )
  should_reject(
    envelope_with(
      "{\"table\":\"todos\",\"recordId\":\""
      <> string.repeat("x", 513)
      <> "\",\"payload\":{\"updatedAt\":1}}",
    ),
  )
  should_accept(
    envelope_with(
      "{\"table\":\"todos\",\"recordId\":\""
      <> string.repeat("x", 512)
      <> "\",\"payload\":{\"updatedAt\":1}}",
    ),
  )
}

pub fn rejects_an_operation_that_is_not_upsert_or_delete_test() {
  should_reject(
    envelope_with(
      "{\"table\":\"todos\",\"recordId\":\"t\",\"operation\":\"drop\",\"payload\":{\"updatedAt\":1}}",
    ),
  )
}

pub fn rejects_a_source_label_over_two_hundred_characters_test() {
  should_reject(
    "{\"formatVersion\":1,\"source\":\""
    <> string.repeat("s", 201)
    <> "\",\"records\":["
    <> upsert_with("{\"updatedAt\":1}")
    <> "]}",
  )
  should_accept(
    "{\"formatVersion\":1,\"source\":\""
    <> string.repeat("s", 200)
    <> "\",\"records\":["
    <> upsert_with("{\"updatedAt\":1}")
    <> "]}",
  )
}

pub fn rejects_documents_that_are_not_envelopes_test() {
  opto_sync_schema.parse_envelope("{not json")
  |> should.equal(Error(InvalidJson))
  should_reject("[]")
  should_reject("42")
  should_reject("{\"formatVersion\":1,\"records\":[42]}")
}

// --------------------------------------------------------------------------
// The timestamp union
// --------------------------------------------------------------------------

pub fn accepts_every_timestamp_format_of_the_union_test() {
  use timestamp <- list.each([
    // epoch integers, any scale
    "0",
    "1753876800123",
    "1753876800123456789",
    // pure-digit strings
    "\"0\"",
    "\"1753876800123\"",
    // fixed-width ISO-8601 UTC, with optional sub-second precision
    "\"2026-07-30T12:00:00Z\"",
    "\"2026-07-30T12:00:00.1Z\"",
    "\"2026-07-30T12:00:00.000000001Z\"",
    // ...and with HLC counter/node suffixes after the Z
    "\"2026-07-30T12:00:00.000000001Z-0001-a1b2c3d4\"",
    "\"2026-07-30T12:00:00Z-0001-node.id_v1~2\"",
  ])
  should_accept(upsert_with_updated_at(timestamp))
}

pub fn rejects_timestamps_outside_the_union_test() {
  use timestamp <- list.each([
    "-1",
    "1.5",
    // A float is a different scale, not an epoch integer.
    "1.0",
    "true",
    "null",
    "[1]",
    "{}",
    "\"\"",
    "\"123456789012345678901\"",
    "\"12a3\"",
    // Not fixed width, or not UTC.
    "\"2026-07-30T12:00:00\"",
    "\"2026-07-30T12:00:00+01:00\"",
    "\"2026-7-30T12:00:00Z\"",
    "\"2026-07-30T12:00:00.Z\"",
    "\"2026-07-30T12:00:00.1234567890Z\"",
    "\"2026-07-30T12:00:00Z-\"",
    "\"2026-07-30T12:00:00Z0001\"",
    "\"2026-07-30T12:00:00Z-node id\"",
    // The native millisecond HLC the clock emits is NOT in the envelope union:
    // it is neither fixed-width ISO-8601 nor pure digits. Mixing formats for
    // one key compares lexicographically and is not chronologically
    // meaningful.
    "\"1721822400000-0000-gleam1\"",
  ])
  should_reject(upsert_with_updated_at(timestamp))
}
