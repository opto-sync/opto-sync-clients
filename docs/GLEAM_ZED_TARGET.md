# Gleam and BEAM clean-room Zed target

`scripts/stage-gleam-target.py` assembles only the Gleam client, the Gleam
binding, the BEAM/Rustler NIF, the Rust binding that statically compiles the C
core, the shared schema fixtures, and immutable release metadata. All relative
paths resolve inside the extracted target.

The release set records the exact client/core commits and SHA-256 identities
for the client and binding Gleam manifests, Mix lock, and NIF Cargo lock. A
validator rejects path escape, generated build state, other client roots,
unrecognized identities, and a second Zed core. Publication remains disabled.

The clean-room matrix double-packs the target and sends the same archive to
Linux and macOS. Each runner builds the Rustler NIF, requires the blank Elixir
consumer to report core `0.2.1`, downloads the locked Gleam dependencies, and
runs formatting and the complete Gleam suite against the bundled BEAM ebin.

NIF load failure remains explicit: the Gleam FFI raises the tagged
`opto_sync_nif_not_loaded` diagnostic and names `OPTO_SYNC_BEAM_EBIN` as the
reviewed recovery path. No fallback engine is selected.
