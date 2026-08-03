import gleam/list
import gleam/string

pub type CapabilityError {
  InvalidCapability(String)
  DuplicateCapability(String)
  MissingRequiredCapability(String)
  NonCanonicalOrder(List(String), List(String))
}

pub fn stream_adapter_protocol() -> String {
  "fm.adapter.stream.v1"
}

pub fn stream_adapter_protocol_version() -> Int {
  1
}

/// Returns the canonical V1 wire registry.
pub fn capability_registry_v1() -> List(String) {
  [
    "reset",
    "apply",
    "observe",
    "settle",
    "snapshot",
    "restore",
    "fault",
    "close",
  ]
}

/// Returns the mandatory V1 capability set in registry order.
pub fn required_capabilities_v1() -> List(String) {
  ["reset", "apply", "observe", "close"]
}

fn optional_capabilities_v1() -> List(String) {
  ["settle", "snapshot", "restore", "fault"]
}

/// Validates an unordered producer set and returns canonical wire order.
pub fn canonicalize_capability_set_v1(
  values: List(String),
) -> Result(List(String), CapabilityError) {
  case validate_values(values, []) {
    Error(error) -> Error(error)
    Ok(Nil) ->
      case validate_required(required_capabilities_v1(), values) {
        Error(error) -> Error(error)
        Ok(Nil) -> Ok(select_registry(capability_registry_v1(), values))
      }
  }
}

/// Validates an incoming wire sequence without silently reordering it.
pub fn validate_capability_sequence_v1(
  values: List(String),
) -> Result(List(String), CapabilityError) {
  case canonicalize_capability_set_v1(values) {
    Error(error) -> Error(error)
    Ok(canonical) ->
      case values == canonical {
        True -> Ok(canonical)
        False -> Error(NonCanonicalOrder(values, canonical))
      }
  }
}

/// Encodes a validated sequence as exact compact JSON array text.
pub fn capability_array_json_v1(
  values: List(String),
) -> Result(String, CapabilityError) {
  case validate_capability_sequence_v1(values) {
    Error(error) -> Error(error)
    Ok(canonical) ->
      canonical
      |> list.map(quote)
      |> string.join(",")
      |> fn(body) { Ok("[" <> body <> "]") }
  }
}

/// Enumerates all 16 valid arrays. Ordering is deterministic but not semantic.
pub fn all_canonical_capability_sequences_v1() -> List(List(String)) {
  optional_capabilities_v1()
  |> subsets
  |> list.map(fn(optional) {
    let assert Ok(canonical) =
      canonicalize_capability_set_v1(list.append(
        required_capabilities_v1(),
        optional,
      ))
    canonical
  })
}

fn validate_values(
  values: List(String),
  seen: List(String),
) -> Result(Nil, CapabilityError) {
  case values {
    [] -> Ok(Nil)
    [value, ..rest] ->
      case value == "hello" {
        True -> Error(InvalidCapability(value))
        False ->
          case contains(capability_registry_v1(), value) {
            False -> Error(InvalidCapability(value))
            True ->
              case contains(seen, value) {
                True -> Error(DuplicateCapability(value))
                False -> validate_values(rest, [value, ..seen])
              }
          }
      }
  }
}

fn validate_required(
  required: List(String),
  values: List(String),
) -> Result(Nil, CapabilityError) {
  case required {
    [] -> Ok(Nil)
    [capability, ..rest] ->
      case contains(values, capability) {
        True -> validate_required(rest, values)
        False -> Error(MissingRequiredCapability(capability))
      }
  }
}

fn select_registry(
  registry: List(String),
  values: List(String),
) -> List(String) {
  case registry {
    [] -> []
    [capability, ..rest] ->
      case contains(values, capability) {
        True -> [capability, ..select_registry(rest, values)]
        False -> select_registry(rest, values)
      }
  }
}

fn contains(values: List(String), target: String) -> Bool {
  case values {
    [] -> False
    [value, ..rest] ->
      case value == target {
        True -> True
        False -> contains(rest, target)
      }
  }
}

fn subsets(values: List(String)) -> List(List(String)) {
  case values {
    [] -> [[]]
    [value, ..rest] -> {
      let without = subsets(rest)
      let with = list.map(without, fn(subset) { [value, ..subset] })
      list.append(without, with)
    }
  }
}

fn quote(value: String) -> String {
  "\"" <> value <> "\""
}
