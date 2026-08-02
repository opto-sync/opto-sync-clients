//// The Gleam validator against the shared cross-language fixture corpus.
////
//// This walks `schema/fixtures/` rather than restating the cases inline, which
//// is the whole point of the corpus: a fixture added for TypeScript, Dart, or
//// Rust binds this validator too, and a validator that drifts from the shared
//// schema fails here instead of at a consumer.

import gleam/dict
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import gleeunit
import gleeunit/should
import opto_sync_ingest.{Delete, Upsert, ValidationError}

pub fn main() {
  gleeunit.main()
}

@external(erlang, "opto_sync_ingest_fixtures_ffi", "list_fixtures")
fn list_fixtures(kind: String) -> List(#(String, String))

fn fixture(kind: String, name: String) -> String {
  let assert Ok(#(_, contents)) =
    list_fixtures(kind)
    |> list.find(fn(entry) { entry.0 == name })
  contents
}

pub fn accepts_every_shared_valid_fixture_test() {
  let fixtures = list_fixtures("valid")
  should.be_true(fixtures != [])

  list.each(fixtures, fn(entry) {
    let #(name, contents) = entry
    case opto_sync_ingest.parse_envelope(contents) {
      Ok(envelope) ->
        case envelope.records {
          [] -> panic as { name <> ": parsed but produced no records" }
          _ -> Nil
        }
      Error(ValidationError(issues)) ->
        panic as {
          name
          <> ": should have been accepted, got "
          <> string.join(issues, "; ")
        }
    }
  })
}

pub fn rejects_every_shared_invalid_fixture_test() {
  let fixtures = list_fixtures("invalid")
  should.be_true(fixtures != [])

  list.each(fixtures, fn(entry) {
    let #(name, contents) = entry
    case opto_sync_ingest.parse_envelope(contents) {
      Ok(_) -> panic as { name <> ": should have been rejected" }
      Error(ValidationError([])) ->
        panic as { name <> ": rejected without reporting an issue" }
      Error(ValidationError(_)) -> Nil
    }
  })
}

pub fn accepts_the_hlc_the_clients_emit_test() {
  // The regression that motivated this module: the shared schema had no branch
  // for the native HLC format, so every client rejected its own stamped
  // timestamps.
  let assert Ok(envelope) =
    opto_sync_ingest.parse_envelope(fixture(
      "valid",
      "hlc-native-timestamps.json",
    ))
  let assert [record] = envelope.records
  should.equal(record.table, "notes")
  should.equal(record.operation, Upsert)
  should.equal(dict.has_key(record.payload, "updatedAt"), True)
}

pub fn parses_the_fields_downstream_consumers_read_test() {
  let assert Ok(envelope) =
    opto_sync_ingest.parse_envelope(fixture("valid", "nested-keyed-arrays.json"))
  let assert [upsert, delete] = envelope.records

  should.equal(upsert.table, "documents")
  should.equal(upsert.record_id, "doc-9")
  should.equal(upsert.operation, Upsert)
  should.equal(upsert.base_revision, Some("41"))
  // The payload passes through intact — ingest has no direct-to-database
  // shortcut, so whatever is here is what reaches the merge core.
  should.equal(dict.has_key(upsert.payload, "sections"), True)

  should.equal(delete.operation, Delete)
  should.equal(dict.size(delete.payload), 0)
}

pub fn operation_defaults_to_upsert_when_absent_test() {
  let assert Ok(envelope) =
    opto_sync_ingest.parse_envelope(fixture("valid", "basic-upsert.json"))
  let assert [record] = envelope.records
  should.equal(record.operation, Upsert)
  should.equal(envelope.source, Some("unit-fixture"))
}

pub fn source_is_optional_test() {
  let assert Ok(envelope) =
    opto_sync_ingest.parse_envelope(fixture("valid", "hlc-timestamps.json"))
  should.equal(envelope.source, None)
}

pub fn reports_every_issue_not_merely_the_first_test() {
  // Two independently broken records: a malformed envelope should be fixable
  // in one pass rather than one error at a time.
  let text =
    "{\"formatVersion\":1,\"records\":["
    <> "{\"table\":\"bad table\",\"recordId\":\"\",\"payload\":{}},"
    <> "{\"table\":\"todos\",\"recordId\":\"t2\",\"payload\":{\"updatedAt\":\"nope\"}}"
    <> "]}"
  let assert Error(ValidationError(issues)) =
    opto_sync_ingest.parse_envelope(text)
  should.be_true(list.length(issues) >= 3)
  should.be_true(
    list.any(issues, fn(issue) { string.contains(issue, "records.0.table") }),
  )
  should.be_true(
    list.any(issues, fn(issue) {
      string.contains(issue, "records.1.payload.updatedAt")
    }),
  )
}

pub fn invalid_json_is_an_error_not_a_crash_test() {
  let assert Error(ValidationError(issues)) =
    opto_sync_ingest.parse_envelope("{ not json")
  should.be_true(list.any(issues, fn(i) { string.contains(i, "invalid JSON") }))
}

pub fn unknown_top_level_keys_are_rejected_test() {
  let text =
    "{\"formatVersion\":1,\"surprise\":true,\"records\":["
    <> "{\"table\":\"todos\",\"recordId\":\"t1\","
    <> "\"payload\":{\"updatedAt\":\"1753876800123\"}}]}"
  let assert Error(ValidationError(issues)) =
    opto_sync_ingest.parse_envelope(text)
  should.be_true(list.any(issues, fn(i) { string.contains(i, "surprise") }))
}
