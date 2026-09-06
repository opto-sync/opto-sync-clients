# Three physical crates

- `app-shared`: serializable DTOs, state schema, pure reducer. Builds for native
  and WASM. No UI, storage, HTTP, or server imports.
- `app-client`: WASM only. Leptos and Dioxus each use native signals and a context
  dispatcher. No external state library is required. The async `refresh` seam
  accepts a host worker/service callback returning a complete `LocalViewReply`.
  Generation/request fences reject stale results after refresh or session reset.
- `app-server`: native Axum/Maud/SQLx sample, using SQLite in memory. `/api/users`
  returns authoritative DTOs; `/users` renders a fragment for MASH; `/` supplies
  the HTMX markup and a normal link. Serve your reviewed HTMX asset through the
  host pipeline to activate the progressive-enhancement button.

The sample server is read-only and binds to `127.0.0.1:3100`. It demonstrates the
server boundary; production protocol push/pull, authentication, durable queues,
and worker bootstrapping are supplied by the host's existing opto-sync setup.
Do not hydrate offline UI directly from `/api/users`: the data owner must first
replay pending mutations using `localView`.

```sh
cargo run -p app-server
cargo test --locked
cargo check --locked -p app-client --features leptos-ui --target wasm32-unknown-unknown
cargo check --locked -p app-client --features dioxus-ui --target wasm32-unknown-unknown
python3 ../../scripts/check-state-boundaries.py
```

These are compiled library components for a host SPA; use its normal Leptos
mount or Dioxus launch root and bundler-specific worker entry. The feature flags
choose the UI framework; they never switch a file between server and client
roles. Building `app-client` natively is a compile error. CI checks dependencies
so adding a server/database path to the client or shared crate fails review.

Use Leptos `Dispatcher::provide()` under the app owner, then `Users` or other
components consume context. In Dioxus call `use_dispatcher()` at the root;
children consume the same context. `refresh` is the thunk pattern. A Leptos
Action or Dioxus coroutine can own the surrounding loading/error UI instead,
while still dispatching synchronous actions with the same request fence.

See [CLIENT_STATE.md](../../docs/CLIENT_STATE.md) for worker protocol ownership,
Flutter/mobile execution, MASH use, the optional portable store, and test scope.
