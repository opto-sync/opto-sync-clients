//// Envelope validation for the shared ingest schema.
////
//// `schema/opto-sync-envelope.schema.json` and its fixture corpus are the
//// executable contract. Additional providers are veto-only gates so they
//// cannot coerce data before the canonical `gleam_json`/dynamic decoder
//// returns an `IngestEnvelope`.

import gleam/dict.{type Dict}
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/float
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string

const max_safe_timestamp_integer = 9_007_199_254_740_991

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

pub type ValidationError {
  ValidationError(issues: List(String))
}

/// Additional validation-library integration. A provider returns no issues on
/// success and one or more normalized messages on failure.
pub type ValidationProvider {
  ValidationProvider(
    name: String,
    validate: fn(Dynamic) -> Result(Nil, List(String)),
  )
}

pub type ProviderAuditResult {
  ProviderAuditResult(
    provider: String,
    canonical_accepted: Bool,
    provider_accepted: Bool,
    drift: Bool,
    provider_issues: List(String),
  )
}

/// Named adapter for JSON Schema validators/decoders.
pub fn json_schema_provider(
  validate: fn(Dynamic) -> Result(Nil, List(String)),
) -> ValidationProvider {
  ValidationProvider("json_schema", validate)
}

/// Named adapter for `gleam_regexp` or a domain validation pipeline.
pub fn regexp_provider(
  validate: fn(Dynamic) -> Result(Nil, List(String)),
) -> ValidationProvider {
  ValidationProvider("gleam_regexp", validate)
}

/// Generic adapter for another Gleam or Erlang validation library.
pub fn validation_provider(
  name: String,
  validate: fn(Dynamic) -> Result(Nil, List(String)),
) -> ValidationProvider {
  ValidationProvider(name, validate)
}

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

fn as_float(data: Dynamic) -> Result(Float, Nil) {
  decode.run(data, decode.float) |> result.replace_error(Nil)
}

fn as_list(data: Dynamic) -> Result(List(Dynamic), Nil) {
  decode.run(data, decode.list(decode.dynamic)) |> result.replace_error(Nil)
}

fn codepoint_length(value: String) -> Int {
  value |> string.to_utf_codepoints |> list.length
}

fn is_digit(character: String) -> Bool {
  case character {
    "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" -> True
    _ -> False
  }
}

fn is_lower_hex(character: String) -> Bool {
  is_digit(character)
  || case character {
    "a" | "b" | "c" | "d" | "e" | "f" -> True
    _ -> False
  }
}

fn is_alpha(character: String) -> Bool {
  string.lowercase(character) != string.uppercase(character)
  && string.byte_size(character) == 1
}

fn all_chars(value: String, predicate: fn(String) -> Bool) -> Bool {
  value |> string.to_graphemes |> list.all(predicate)
}

fn is_identifier(value: String) -> Bool {
  case string.to_graphemes(value) {
    [] -> False
    [first, ..rest] ->
      { is_alpha(first) || first == "_" }
      && list.length(rest) <= 62
      && list.all(rest, fn(character) {
        is_alpha(character) || is_digit(character) || character == "_"
      })
  }
}

fn is_digits(value: String) -> Bool {
  let length = string.length(value)
  length >= 1 && length <= 20 && all_chars(value, is_digit)
}

fn is_decimal_string(value: String) -> Bool {
  case string.to_graphemes(value) {
    [] -> False
    ["0"] -> True
    ["0", ..] -> False
    characters -> list.all(characters, is_digit)
  }
}

fn is_native_hlc(value: String) -> Bool {
  case string.split(value, "-") {
    [millis, counter, node] ->
      string.length(millis) == 13
      && all_chars(millis, is_digit)
      && string.length(counter) == 4
      && all_chars(counter, is_lower_hex)
      && codepoint_length(node) >= 1
      && codepoint_length(node) <= 128
    _ -> False
  }
}

fn matches_shape(characters: List(String), shape: String) -> Bool {
  let expected = string.to_graphemes(shape)
  list.length(characters) == list.length(expected)
  && list.zip(characters, expected)
  |> list.all(fn(pair) {
    let #(actual, wanted) = pair
    case wanted {
      "d" -> is_digit(actual)
      _ -> actual == wanted
    }
  })
}

fn is_suffix_char(character: String) -> Bool {
  is_alpha(character)
  || is_digit(character)
  || character == "."
  || character == "_"
  || character == "~"
  || character == "-"
}

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
    Ok(value) -> value >= 0 && value <= max_safe_timestamp_integer
    Error(Nil) ->
      case as_float(data) {
        Ok(value) ->
          value >=. 0.0
          && value <=. 9_007_199_254_740_991.0
          && float.floor(value) == value
        Error(Nil) ->
          case as_string(data) {
            Ok(value) ->
              is_digits(value) || is_native_hlc(value) || is_iso8601(value)
            Error(Nil) -> False
          }
      }
  }
}

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

fn provider_issues(
  data: Dynamic,
  providers: List(ValidationProvider),
) -> List(String) {
  list.flat_map(providers, fn(provider) {
    let ValidationProvider(name, validate) = provider
    case validate(data) {
      Ok(Nil) -> []
      Error([]) -> [
        "provider[" <> name <> "]: validation rejected the envelope",
      ]
      Error(issues) ->
        list.map(issues, fn(issue) { "provider[" <> name <> "]: " <> issue })
    }
  })
}

/// Validate a decoded JSON envelope with no additional providers.
pub fn validate_envelope(
  data: Dynamic,
) -> Result(IngestEnvelope, ValidationError) {
  validate_envelope_with(data, [])
}

/// Validate a decoded envelope with additional veto-only provider gates.
pub fn validate_envelope_with(
  data: Dynamic,
  providers: List(ValidationProvider),
) -> Result(IngestEnvelope, ValidationError) {
  let extra_issues = provider_issues(data, providers)
  case validate_canonical(data) {
    Ok(envelope) ->
      case extra_issues {
        [] -> Ok(envelope)
        _ -> Error(ValidationError(extra_issues))
      }
    Error(ValidationError(canonical_issues)) ->
      Error(ValidationError(list.append(canonical_issues, extra_issues)))
  }
}

fn validate_canonical(
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
              case codepoint_length(text) <= 200 {
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
              let length = codepoint_length(text)
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

/// Validate JSON text with no additional providers.
pub fn parse_envelope(text: String) -> Result(IngestEnvelope, ValidationError) {
  parse_envelope_with(text, [])
}

/// Validate JSON text with additional provider gates.
pub fn parse_envelope_with(
  text: String,
  providers: List(ValidationProvider),
) -> Result(IngestEnvelope, ValidationError) {
  case json.parse(text, decode.dynamic) {
    Error(_) -> Error(ValidationError(["<root>: invalid JSON"]))
    Ok(data) -> validate_envelope_with(data, providers)
  }
}

/// Compare a provider's acceptance decision with the canonical contract.
pub fn audit_provider(
  data: Dynamic,
  provider: ValidationProvider,
) -> ProviderAuditResult {
  let ValidationProvider(name, validate) = provider
  let canonical_accepted = result.is_ok(validate_canonical(data))
  let provider_result = validate(data)
  let #(provider_accepted, provider_issues) = case provider_result {
    Ok(Nil) -> #(True, [])
    Error(issues) -> #(False, issues)
  }
  ProviderAuditResult(
    provider: name,
    canonical_accepted: canonical_accepted,
    provider_accepted: provider_accepted,
    drift: canonical_accepted != provider_accepted,
    provider_issues: provider_issues,
  )
}
