# Dart and Flutter clean-room Zed target

`scripts/stage-dart-target.py` assembles a source-only target outside the Git
checkout. The target contains only `clients/dart`, the exact `syncer.c` gitlink
source, the Dart FFI binding, the WASM binding, the shared schema fixtures, and
the extracted-artifact validator. It contains no other SDK, Git metadata,
plaintext environment, generated dependency directory, or second core.

The target records the client and core commits plus SHA-256 identities for the
client pubspec, binding pubspec, and committed binding lock. The Dart client is
a library and intentionally does not commit a generated `pubspec.lock`; clean
consumers resolve it from the recorded pubspec while the binding lock remains
immutable. `release-set.json` keeps `publicationEnabled` false.

The clean-room matrix packs the staged tree twice and requires byte-identical
archives. The same archive is then extracted without Git metadata on Linux,
macOS, and Windows. Each runner builds the bundled C core, runs its C test,
resolves the Dart package, checks formatting and analysis, and runs the full
native FFI/SQLite suite. The Linux job additionally installs a pinned
Playwright test dependency and runs real Chromium against Dart-compiled
JavaScript, syncer.c WASM, and IndexedDB restart/rollback/checkpoint behavior.

Flutter is an explicit consumer rather than an inferred Dart synonym. Linux
builds a blank Android application and macOS builds a blank iOS simulator
application against the extracted package. Neither compile is release, device,
signing, or store evidence.

Unsupported browser/native use fails through typed `UnsupportedError`
diagnostics that direct callers to `WasmSyncer`; it never silently swaps in a
different reconciliation engine.
