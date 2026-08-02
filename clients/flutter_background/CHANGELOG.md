## 0.1.2

- Align the public periodic cadence with WorkManager's 15-minute floor.
- Bound Android retries to five executions and propagate scheduler cancellation.
- Persist Android callback handles before initialization returns.
- Scope iOS cancellation to Opto Sync task identifiers and harden engine teardown.
- Route iOS one-shot commit wakes through the registered network-bound processing task.
- Upgrade to WorkManager 2.10.5 while preserving the Android API 21 minimum.
- Align its compile toolchain with WorkManager's API 35 / AGP 8.6 floor.

## 0.1.1

- Add native Kotlin, Java, Swift, and Objective-C compile gates.
- Test the Flutter scheduling surface and headless callback registration.
