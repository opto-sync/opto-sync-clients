## 0.2.0

- Route headless drains through the formally modeled single-flight lifecycle.
- Coalesce duplicate native invocations and reject callback replacement while
  an existing callback owns the execution permit.
- Add exhaustive mobile/desktop lifecycle verification and runtime conformance
  checks for wake, acquire, cancel, release, close, and process-abort paths.

## 0.1.3

- Make the headless Dart dispatcher a top-level entrypoint so Android and iOS
  engines can resolve it after process death and tree shaking.
- Bound Android dispatcher startup separately from drain execution so an
  unresolvable entrypoint retries promptly instead of occupying a worker slot.
- Accept Flutter's signed, nonzero callback handles while rejecting the zero
  sentinel before callback-cache lookup.

## 0.1.2

- Align the public periodic cadence with WorkManager's 15-minute floor.
- Bound Android retries to five executions and propagate scheduler cancellation.
- Persist Android callback handles before initialization returns.
- Scope iOS cancellation to Opto Sync task identifiers and harden engine teardown.
- Route iOS one-shot commit wakes through the registered network-bound processing task.
- Upgrade to WorkManager 2.10.5 while preserving the Android API 21 minimum.
- Align its compile toolchain with WorkManager's API 35 / AGP 8.6 floor.
- Add fixed, privacy-safe Android scheduler and worker lifecycle diagnostics.
- Initialize headless engines through Flutter's shared injected loader.

## 0.1.1

- Add native Kotlin, Java, Swift, and Objective-C compile gates.
- Test the Flutter scheduling surface and headless callback registration.
