# opto-sync-state

Optional synchronous state contract for native Rust and WASM, with no runtime
dependencies by default. Application DTOs and reducers live in the application's
shared crate. This crate does not provide persistence, reconciliation, a queue,
a renderer, or an async runtime.

```rust
use opto_sync_state::StateStore;
let store = StateStore::new(0, |state, amount| state + amount);
let subscription = store.select(|state| *state, |count| println!("{count}"))?;
store.dispatch(1)?;
drop(subscription);
# Ok::<(), opto_sync_state::StoreError>(())
```

`begin_effect(key)` fences late results after another request, reset, or
disposal. `project_local_view` consumes an application callback that calls the
existing sync client's rebased local view. Keep pure CPU work off the UI thread
and send owned DTOs back; the store is intentionally `!Send`/`!Sync`.

For Leptos or Dioxus apps, prefer the [native-signal examples](../../examples/state-workspace)
unless the common portable store is useful. Enable `leptos` or `dioxus` only when
using `leptos::store_selector` or `dioxus::use_store_selector` with this store.
Both expose read-only framework signals and release subscriptions with the UI
owner. The core supports Rust 1.88; optional framework integrations and examples
are checked with Rust 1.97 and their locked dependency graph.

Read the [state and worker guide](../../docs/CLIENT_STATE.md) for immutable state,
effect errors, scoped ownership, durability, Flutter/TS parity, and worker design.

```sh
cargo test --locked --no-default-features
cargo test --locked --all-features
cargo check --locked --all-features --target wasm32-unknown-unknown
```
