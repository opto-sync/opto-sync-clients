/// Non-published entry point for the repository-local ITF conformance adapter.
/// The Erlang FFI owns process/file I/O; all protocol state transitions and
/// canonical observations are delegated to production Gleam modules.
@external(erlang, "opto_sync_formal_replay_ffi", "main")
pub fn main() -> Nil
