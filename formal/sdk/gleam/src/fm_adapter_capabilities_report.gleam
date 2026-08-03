import fm_adapter_capabilities as capabilities
import gleam/int
import gleam/io

pub fn main() {
  let assert Ok(registry_json) =
    capabilities.capability_array_json_v1(
      capabilities.capability_registry_v1(),
    )
  let assert Ok(required_json) =
    capabilities.capability_array_json_v1(
      capabilities.required_capabilities_v1(),
    )

  io.println("protocol\t" <> capabilities.stream_adapter_protocol())
  io.println(
    "protocolVersion\t"
    <> int.to_string(capabilities.stream_adapter_protocol_version()),
  )
  io.println("registry\t" <> registry_json)
  io.println("required\t" <> required_json)
  print_sequences(capabilities.all_canonical_capability_sequences_v1())
}

fn print_sequences(sequences: List(List(String))) -> Nil {
  case sequences {
    [] -> Nil
    [sequence, ..rest] -> {
      let assert Ok(encoded) =
        capabilities.capability_array_json_v1(sequence)
      io.println("sequence\t" <> encoded)
      print_sequences(rest)
    }
  }
}
