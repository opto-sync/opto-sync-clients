//// Envelope validation for the shared ingest schema.
////
//// The single source of truth for the envelope shape is
//// `opto-sync-clients/schema/opto-sync-envelope.schema.json`; this validator
//// MUST accept/reject exactly the shared fixture corpus in `schema/fixtures/`,
//// the same corpus the TypeScript (zod), Dart, and Rust validators are held
//// to. `test/opto_sync_ingest_test.gleam` walks that directory rather than
//// restating the cases, so a fixture added for any one language binds all four.
////
//// The patterns are hand-rolled rather than delegated to `gleam_regexp`. They
//// are five fixed, simple shapes, and adding a dependency to match `[0-9]{13}`
//// would not be a fair trade — the same call the Rust validator makes.

import gleam/dict.{type Dict}
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string

pub type Operation {
  Upsert
  Delete
}

pub type IngestRecord {
  IngestRecord(
    table: String,
    record_id: String,
    operation: Operation,
    base_revision: Option(String),
    payload: Dict(String, Dynamic),
  )
}

pub type IngestEnvelope {
  IngestEnvelope(source: Option(String), records: List(IngestRecord))
}

/// Carries every issue, not just the first, so a malformed export can be fixed
/// in one pass.
pub type ValidationError {
  ValidationError(issues: List(String))
}

// --- dynamic accessors -------------------------------------------------------

fn as_object(data: Dynamic) -> Result(Dict(String, Dynamic), Nil) {
  decode.run(data, decode.dict(decode.string, decode.dynamic))
  |> result.replace_error(Nil)
}

fn as_string(data: Dynamic) -> Result(String, Nil) {
  decode.run(data, decode.string) |> result.replace_error(Nil)
}

fn as_int(data: Dynamic) -> Result(Int, Nil) {
  decode.run(data, decode.int) |> result.replace_error(Nil)
}

fn as_list(data: Dynamic) -> Result(List(Dynamic), Nil) {
  decode.run(data, decode.list(decode.dynamic)) |> result.replace_error(Nil)
}

// --- pattern predicates ------------------------------------------------------

fn is_digit(c: String) -> Bool {
  case c {
    "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" -> True
    _ -> False
  }
}

fn is_lower_hex(c: String) -> Bool {
  is_digit(c)
  || case c {
    "a" | "b" | "c" | "d" | "e" | "f" -> True
    _ -> False
  }
}

fn is_alpha(c: String) -> Bool {
  string.lowercase(c) != string.uppercase(c) && string.byte_size(c) == 1
}

fn all_chars(value: String, predicate: fn(String) -> Bool) -> Bool {
  value |> string.to_graphemes |> list.all(predicate)
}

/// `^[A-Za-z_][A-Za-z0-9_]{0,62}$` — SQL-safe table identifier.
fn is_identifier(value: String) -> Bool {
  case string.to_graphemes(value) {
    [] -> False
    [first, ..rest] ->
      { is_alpha(first) || first == "_" }
      && list.length(rest) <= 62
      && list.all(rest, fn(c) { is_alpha(c) || is_digit(c) || c == "_" })
  }
}

/// `^[0-9]{1,20}$` — pure-digit epoch string.
fn is_digits(value: String) -> Bool {
  let length = string.length(value)
  length >= 1 && length <= 20 && all_chars(value, is_digit)
}

/// `^(?:0|[1-9][0-9]*)$` — canonical decimal, no leading zeros.
fn is_decimal_string(value: String) -> Bool {
  case string.to_graphemes(value) {
    [] -> False
    ["0"] -> True
    ["0", ..] -> False
    chars -> list.all(chars, is_digit)
  }
}

/// `^[0-9]{13}-[0-9a-f]{4}-[^-]{1,128}$` — native HLC, as emitted by the ts,
/// dart, and rust clients' `formatHlc`.
///
/// This is not redundant with `is_iso8601`: `1753876800123-0001-devA.t1`
/// matches neither that pattern nor `is_digits`, so without this check the
/// validator rejects the timestamps the clients actually produce.
fn is_native_hlc(value: String) -> Bool {
  // A nodeId may not contain "-" (the clock constructor rejects it), so an
  // HLC splits into exactly three segments.
  case string.split(value, "-") {
    [millis, counter, node] ->
      string.length(millis) == 13
      && all_chars(millis, is_digit)
      && string.length(counter) == 4
      && all_chars(counter, is_lower_hex)
      && string.length(node) >= 1
      && string.length(node) <= 128
    _ -> False
  }
}

/// Compares a grapheme list against a shape, where "d" means any digit and
/// every other character must match exactly.
fn matches_shape(chars: List(String), shape: String) -> Bool {
  let expected = string.to_graphemes(shape)
  list.length(chars) == list.length(expected)
  && list.zip(chars, expected)
  |> list.all(fn(pair) {
    let #(actual, want) = pair
    case want {
      "d" -> is_digit(actual)
      _ -> actual == want
    }
  })
}

fn is_suffix_char(c: String) -> Bool {
  is_alpha(c) || is_digit(c) || c == "." || c == "_" || c == "~" || c == "-"
}

/// `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$`
fn is_iso8601(value: String) -> Bool {
  let #(head, rest) = list.split(string.to_graphemes(value), 19)
  case matches_shape(head, "dddd-dd-ddTdd:dd:dd") {
    False -> False
    True -> {
      let rest = case rest {
        [".", ..tail] -> {
          let fraction = list.take_while(tail, is_digit)
          let count = list.length(fraction)
          case count >= 1 && count <= 9 {
            True -> Ok(list.drop(tail, count))
            False -> Error(Nil)
          }
        }
        other -> Ok(other)
      }
      case rest {
        Error(Nil) -> False
        Ok(["Z"]) -> True
        Ok(["Z", "-", ..suffix]) ->
          suffix != [] && list.all(suffix, is_suffix_char)
        Ok(_) -> False
      }
    }
  }
}

fn is_timestamp(data: Dynamic) -> Bool {
  case as_int(data) {
    Ok(value) -> value >= 0
    Error(Nil) ->
      case as_string(data) {
        Ok(value) ->
          is_digits(value) || is_native_hlc(value) || is_iso8601(value)
        Error(Nil) -> False
      }
  }
}

// --- validation --------------------------------------------------------------

const envelope_keys = ["formatVersion", "source", "records"]

const record_keys = [
  "table",
  "recordId",
  "operation",
  "baseRevision",
  "payload",
]

fn unknown_keys(
  fields: Dict(String, Dynamic),
  known: List(String),
  where: String,
) -> List(String) {
  fields
  |> dict.keys
  |> list.filter(fn(key) { !list.contains(known, key) })
  |> list.map(fn(key) { where <> "." <> key <> ": unrecognized key" })
}

/// Validate a decoded JSON envelope.
pub fn validate_envelope(
  data: Dynamic,
) -> Result(IngestEnvelope, ValidationError) {
  case as_object(data) {
    Error(Nil) -> Error(ValidationError(["<root>: expected an object"]))
    Ok(fields) -> {
      let key_issues = unknown_keys(fields, envelope_keys, "<root>")

      let version_issues = case dict.get(fields, "formatVersion") {
        Error(Nil) -> ["<root>.formatVersion: required"]
        Ok(value) ->
          case as_int(value) {
            Ok(1) -> []
            _ -> ["<root>.formatVersion: must be 1"]
          }
      }

      let #(source, source_issues) = case dict.get(fields, "source") {
        Error(Nil) -> #(None, [])
        Ok(value) ->
          case as_string(value) {
            Ok(text) ->
              case string.length(text) <= 200 {
                True -> #(Some(text), [])
                False -> #(None, [
                  "<root>.source: must be a string of at most 200 characters",
                ])
              }
            Error(Nil) -> #(None, [
              "<root>.source: must be a string of at most 200 characters",
            ])
          }
      }

      let #(records, record_issues) = case dict.get(fields, "records") {
        Error(Nil) -> #([], ["<root>.records: required"])
        Ok(value) ->
          case as_list(value) {
            Error(Nil) -> #([], ["<root>.records: must be an array"])
            Ok([]) -> #([], [
              "<root>.records: must contain at least one record",
            ])
            Ok(items) -> {
              let results =
                list.index_map(items, fn(item, index) {
                  validate_record(item, index)
                })
              let parsed =
                list.filter_map(results, fn(entry) {
                  case entry {
                    Ok(record) -> Ok(record)
                    Error(_) -> Error(Nil)
                  }
                })
              let issues =
                list.flat_map(results, fn(entry) {
                  case entry {
                    Ok(_) -> []
                    Error(found) -> found
                  }
                })
              #(parsed, issues)
            }
          }
      }

      let issues =
        list.flatten([
          key_issues,
          version_issues,
          source_issues,
          record_issues,
        ])
      case issues {
        [] -> Ok(IngestEnvelope(source: source, records: records))
        _ -> Error(ValidationError(issues))
      }
    }
  }
}

fn validate_record(
  data: Dynamic,
  index: Int,
) -> Result(IngestRecord, List(String)) {
  let where = "records." <> string.inspect(index)
  case as_object(data) {
    Error(Nil) -> Error([where <> ": expected an object"])
    Ok(fields) -> {
      let key_issues = unknown_keys(fields, record_keys, where)

      let #(table, table_issues) = case dict.get(fields, "table") {
        Error(Nil) -> #("", [where <> ".table: required"])
        Ok(value) ->
          case as_string(value) {
            Ok(text) ->
              case is_identifier(text) {
                True -> #(text, [])
                False -> #("", [
                  where <> ".table: not a SQL-safe identifier",
                ])
              }
            Error(Nil) -> #("", [where <> ".table: not a SQL-safe identifier"])
          }
      }

      let #(record_id, record_id_issues) = case dict.get(fields, "recordId") {
        Error(Nil) -> #("", [where <> ".recordId: required"])
        Ok(value) ->
          case as_string(value) {
            Ok(text) -> {
              let length = string.length(text)
              case length >= 1 && length <= 512 {
                True -> #(text, [])
                False -> #("", [
                  where <> ".recordId: must be 1..512 characters",
                ])
              }
            }
            Error(Nil) -> #("", [
              where <> ".recordId: must be 1..512 characters",
            ])
          }
      }

      let #(operation, operation_issues) = case dict.get(fields, "operation") {
        Error(Nil) -> #(Upsert, [])
        Ok(value) ->
          case as_string(value) {
            Ok("upsert") -> #(Upsert, [])
            Ok("delete") -> #(Delete, [])
            _ -> #(Upsert, [
              where <> ".operation: must be \"upsert\" or \"delete\"",
            ])
          }
      }

      let #(base_revision, base_revision_issues) = case
        dict.get(fields, "baseRevision")
      {
        Error(Nil) -> #(None, [])
        Ok(value) ->
          case as_string(value) {
            Ok(text) ->
              case is_decimal_string(text) {
                True -> #(Some(text), [])
                False -> #(None, [
                  where <> ".baseRevision: must be a decimal string",
                ])
              }
            Error(Nil) -> #(None, [
              where <> ".baseRevision: must be a decimal string",
            ])
          }
      }

      let #(payload, payload_issues) = case dict.get(fields, "payload") {
        Error(Nil) -> #(dict.new(), [where <> ".payload: required"])
        Ok(value) ->
          case as_object(value) {
            Error(Nil) -> #(dict.new(), [
              where <> ".payload: must be an object",
            ])
            Ok(map) -> #(map, validate_payload(map, operation, where))
          }
      }

      let issues =
        list.flatten([
          key_issues,
          table_issues,
          record_id_issues,
          operation_issues,
          base_revision_issues,
          payload_issues,
        ])
      case issues {
        [] ->
          Ok(IngestRecord(
            table: table,
            record_id: record_id,
            operation: operation,
            base_revision: base_revision,
            payload: payload,
          ))
        _ -> Error(issues)
      }
    }
  }
}

fn validate_payload(
  payload: Dict(String, Dynamic),
  operation: Operation,
  where: String,
) -> List(String) {
  case operation {
    Delete ->
      case dict.size(payload) {
        0 -> []
        _ -> [where <> ".payload: a delete record must carry an empty payload"]
      }
    Upsert -> {
      let updated_at_issues = case dict.get(payload, "updatedAt") {
        Error(Nil) -> [
          where <> ".payload.updatedAt: required timestamp is missing",
        ]
        Ok(value) ->
          case is_timestamp(value) {
            True -> []
            False -> [where <> ".payload.updatedAt: invalid timestamp"]
          }
      }
      let optional_issues =
        list.flat_map(["createdAt", "syncedAt"], fn(key) {
          case dict.get(payload, key) {
            Error(Nil) -> []
            Ok(value) ->
              case is_timestamp(value) {
                True -> []
                False -> [where <> ".payload." <> key <> ": invalid timestamp"]
              }
          }
        })
      list.append(updated_at_issues, optional_issues)
    }
  }
}

/// Validate an envelope supplied as JSON text.
pub fn parse_envelope(text: String) -> Result(IngestEnvelope, ValidationError) {
  case json.parse(text, decode.dynamic) {
    Error(_) -> Error(ValidationError(["<root>: invalid JSON"]))
    Ok(data) -> validate_envelope(data)
  }
}
