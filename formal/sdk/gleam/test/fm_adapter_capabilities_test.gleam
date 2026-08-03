import fm_adapter_capabilities as capabilities
import gleam/list
import gleam/string
import gleeunit/should

pub fn registry_and_required_values_test() {
  capabilities.stream_adapter_protocol()
  |> should.equal("fm.adapter.stream.v1")
  capabilities.stream_adapter_protocol_version() |> should.equal(1)
  capabilities.capability_registry_v1()
  |> should.equal([
    "reset",
    "apply",
    "observe",
    "settle",
    "snapshot",
    "restore",
    "fault",
    "close",
  ])
  capabilities.required_capabilities_v1()
  |> should.equal(["reset", "apply", "observe", "close"])
}

pub fn every_canonical_subset_round_trips_test() {
  let sequences = capabilities.all_canonical_capability_sequences_v1()
  list.length(sequences) |> should.equal(16)
  assert_sequences(sequences)
}

pub fn every_malformed_capability_class_is_rejected_test() {
  capabilities.canonicalize_capability_set_v1([
    "reset",
    "apply",
    "observe",
    "observe",
    "close",
  ])
  |> should.equal(Error(capabilities.DuplicateCapability("observe")))

  capabilities.canonicalize_capability_set_v1([
    "reset",
    "observe",
    "close",
  ])
  |> should.equal(Error(capabilities.MissingRequiredCapability("apply")))

  capabilities.canonicalize_capability_set_v1([
    "reset",
    "apply",
    "observe",
    "hello",
    "close",
  ])
  |> should.equal(Error(capabilities.InvalidCapability("hello")))

  capabilities.canonicalize_capability_set_v1([
    "reset",
    "apply",
    "observe",
    "teleport",
    "close",
  ])
  |> should.equal(Error(capabilities.InvalidCapability("teleport")))

  let received = [
    "reset",
    "apply",
    "observe",
    "snapshot",
    "settle",
    "close",
  ]
  let canonical = [
    "reset",
    "apply",
    "observe",
    "settle",
    "snapshot",
    "close",
  ]
  capabilities.validate_capability_sequence_v1(received)
  |> should.equal(Error(capabilities.NonCanonicalOrder(received, canonical)))
}

fn assert_sequences(sequences: List(List(String))) -> Nil {
  case sequences {
    [] -> Nil
    [sequence, ..rest] -> {
      capabilities.canonicalize_capability_set_v1(list.reverse(sequence))
      |> should.equal(Ok(sequence))
      capabilities.validate_capability_sequence_v1(sequence)
      |> should.equal(Ok(sequence))
      capabilities.capability_array_json_v1(sequence)
      |> should.equal(Ok(expected_json(sequence)))
      assert_sequences(rest)
    }
  }
}

fn expected_json(values: List(String)) -> String {
  let body =
    values
    |> list.map(fn(value) { "\"" <> value <> "\"" })
    |> string.join(",")
  "[" <> body <> "]"
}
