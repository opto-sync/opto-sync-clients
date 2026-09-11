## 1.2.0

- Make sync-loop stop/offline intent generation-safe so late timers and cycle
  settlements cannot overwrite newer state.
- Add a cancellable timer factory for deterministic scheduler refinement.

## 1.1.0

- Add the privacy-bounded `ores.otel.log` bridge record shared by the Dart,
  Rust, and TypeScript clients.

## 1.0.0

- Initial version.
