# opto-sync-connectivity

UI-agnostic connectivity, total-offline mode, and post-commit save signals for native Rust, server-side Rust, and WebAssembly clients.

The crate intentionally separates four states:

- `Unknown`: no trustworthy observation yet.
- `Offline`: no usable path, or total-offline mode is active.
- `Link`: a path exists, but end-to-end internet/server reachability is not verified.
- `Internet`: a bounded probe or trusted platform validator confirmed reachability.

No banners, snackbars, dialogs, or other UI are included. Callers subscribe to values and choose how to present them.

## Native and server-side Rust

```rust
use opto_sync_connectivity::{
    ConnectivityState, ConnectivityWatcher, SaveMetadata, SaveOperation,
    SaveSignals,
};
use std::time::Duration;

let watcher = ConnectivityWatcher::default();
let signals = SaveSignals::new(watcher.clone());

// Keep subscription guards alive for as long as delivery is wanted.
let _connectivity = watcher.subscribe(true, |next, previous| {
    tracing::debug!(?previous, ?next, "connectivity changed");
});
let _online_save = signals.on_online_save(|event| {
    // Send this metadata to the application's event bus, toast controller,
    // logger, or telemetry sink. The library itself does not render UI.
    println!("saved {} while internet was verified", event.record_id);
});
signals.set_wake_hint(Some(|| {
    // Wake the existing opto-sync drain; this remains only a hint.
    wake_sync_loop();
}));

// A native/server probe chooses the canonical result. A failed application
// endpoint check normally means Link, not necessarily Offline.
let _probe = watcher.spawn_probe(Duration::from_secs(15), || {
    if application_health_probe() {
        ConnectivityState::Internet
    } else if operating_system_reports_a_path() {
        ConnectivityState::Link
    } else {
        ConnectivityState::Offline
    }
})?;

let queue_id = signals
    .after_durable_save(
        SaveMetadata::new("documents", "doc-1", SaveOperation::Upsert),
        || async { durable_queue_write().await },
        |id| id.to_string(),
    )
    .await?;

signals.set_total_offline(true);  // probes and wake hints are suppressed
signals.set_total_offline(false); // restores the latest automatic observation
```

A hook panic is caught when the binary uses unwinding panics. It does not turn an already committed queue write into an error.

## Rust WebAssembly

Enable the `wasm` feature and retain the browser adapter for the page lifetime:

```toml
opto-sync-connectivity = { path = "../rust-connectivity", features = ["wasm"] }
```

```rust
use opto_sync_connectivity::{ConnectivityWatcher, SaveSignals};
use opto_sync_connectivity::wasm::BrowserConnectivityWatcher;

let watcher = ConnectivityWatcher::default();
let browser = BrowserConnectivityWatcher::new(watcher.clone())?;
let signals = SaveSignals::new(watcher);

// Browser online/offline events establish Link or Offline. After an actual
// same-origin health request succeeds, promote the state to Internet.
browser.record_probe_result(health_request_succeeded);
```

`navigator.onLine` is treated as a link hint, not proof of internet access.

## Leptos and Dioxus

The crate has no framework dependency. Bind the same watcher to either framework's signal setter and retain the returned subscription in component-owned state:

```rust
let subscription = watcher.subscribe(true, move |next, _previous| {
    set_connectivity_signal(next);
});
```

For Leptos, call the setter for an `RwSignal`/write signal and drop `subscription` from owner cleanup. For Dioxus, update a component `Signal` and retain/drop the subscription with the component lifecycle. SSR and native desktop builds can use the native probe runner; browser-hydrated builds can use `wasm::BrowserConnectivityWatcher`.

The framework decides whether the event becomes a toast, status icon, log line, or no visible UI at all.
