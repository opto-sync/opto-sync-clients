# BEAM Ecosystem Bindings (Erlang, Elixir, Gleam)

The BEAM bindings will utilize a Native Implemented Function (NIF).

For maximum safety and developer experience within the Elixir/Erlang ecosystem, the NIF will be constructed using [Rustler](https://github.com/rusterlium/rustler). This allows us to leverage our already-tested `syncer-rs` Rust bindings and expose them safely to the BEAM, ensuring that the Erlang VM cannot crash due to segfaults in the C core (since Rust will act as the safe boundary).

## Architecture
1. **Host NIF (`syncer_nif`)**: A Rustler crate that calls `syncer-rs`.
2. **Ecto Custom Type**: In Elixir, the ORM plugin will provide an `Ecto.Type` behavior. The `cast/1`, `dump/1`, and `load/1` callbacks will route JSONB merges through the Rustler NIF.
3. **Yielding/Dirty NIFs**: Given that the C parsing with `yyjson` is extraordinarily fast, standard NIF execution is generally safe. If extremely massive JSON payloads are anticipated, the NIF can be marked as a "Dirty NIF (CPU-bound)" to prevent blocking the BEAM scheduler.
