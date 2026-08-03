#!/usr/bin/env python3
"""Fail fast when mobile background-safety invariants drift.

The native build workflow proves that Swift, Objective-C, Kotlin, and Java
compile. These checks cover policy properties that a compiler cannot see:
bounded retries, durable callback registration, package-scoped cancellation,
and a dependency version that still supports the declared Android minSdk.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import NoReturn


ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file():
        fail(f"missing {relative}")
    return path.read_text(encoding="utf-8")


def fail(message: str) -> NoReturn:
    print(f"mobile-background-contracts: {message}", file=sys.stderr)
    raise SystemExit(1)


def require(text: str, relative: str, markers: tuple[str, ...]) -> None:
    for marker in markers:
        if marker not in text:
            fail(f"{relative} is missing {marker!r}")


def require_before(text: str, relative: str, first: str, second: str) -> None:
    first_at = text.find(first)
    second_at = text.find(second)
    if first_at < 0 or second_at < 0 or first_at >= second_at:
        fail(f"{relative} must keep {first!r} before {second!r}")


def main() -> int:
    dart_path = "clients/flutter_background/lib/opto_sync_flutter_background.dart"
    kotlin_plugin_path = (
        "clients/flutter_background/android/src/main/kotlin/dev/optosync/"
        "background/OptoSyncBackgroundPlugin.kt"
    )
    kotlin_worker_path = (
        "clients/flutter_background/android/src/main/kotlin/dev/optosync/"
        "background/OptoSyncWorker.kt"
    )
    java_worker_path = (
        "clients/flutter_background/android/src/main/java/dev/optosync/"
        "background/OptoSyncWorkerJava.java"
    )
    swift_path = (
        "clients/flutter_background/ios/Classes/OptoSyncBackgroundPlugin.swift"
    )

    dart = read(dart_path)
    kotlin_plugin = read(kotlin_plugin_path)
    kotlin_worker = read(kotlin_worker_path)
    java_worker = read(java_worker_path)
    swift = read(swift_path)

    require(
        dart,
        dart_path,
        (
            "minimumPeriodicFrequency",
            "frequency.compareTo(minimumPeriodicFrequency) < 0",
            "on Exception",
            "@pragma('vm:entry-point')",
            "Future<void> optoSyncBackgroundDispatcher() async",
            "PluginUtilities.getCallbackHandle(\n      optoSyncBackgroundDispatcher,",
            "rawHandle is! int || rawHandle <= 0",
        ),
    )
    require(
        kotlin_plugin,
        kotlin_plugin_path,
        (
            ".commit()",
            "ensureInitialized(result)",
            "ExistingWorkPolicy.KEEP",
            'result.error("SCHEDULE_FAILED"',
            'Log.i(LOG_TAG, "expedited background work submitted")',
        ),
    )
    require(
        kotlin_worker,
        kotlin_worker_path,
        (
            "MAX_ATTEMPTS",
            "TimeoutCancellationException",
            "throw cancelled",
            "runAttemptCount < MAX_ATTEMPTS - 1",
            "engine.destroy()",
            "FlutterInjector.instance().flutterLoader()",
            'Log.w(LOG_TAG, "background worker failed before completion")',
            "DISPATCHER_READY_TIMEOUT_MILLIS",
            'Log.w(LOG_TAG, "background Dart dispatcher did not become ready")',
        ),
    )
    require(
        java_worker,
        java_worker_path,
        (
            "MAX_ATTEMPTS",
            "addCancellationListener",
            "if (isStopped()) return",
            "removeCallbacks",
            "getRunAttemptCount() < MAX_ATTEMPTS - 1",
            "if (completer.set(result)) tearDown()",
            "FlutterInjector.instance().flutterLoader()",
            'Log.w(LOG_TAG, "Java worker failed before completion")',
            "DISPATCHER_READY_TIMEOUT_MILLIS",
            "Java worker background Dart dispatcher did not become ready",
        ),
    )
    require(
        swift,
        swift_path,
        (
            "NSLock()",
            "guard engine.run(",
            "cancel(taskRequestWithIdentifier: Self.refreshTaskIdentifier)",
            "cancel(taskRequestWithIdentifier: Self.processingTaskIdentifier)",
            "Thread.isMainThread",
            'code: "SCHEDULE_FAILED"',
            "BGProcessingTaskRequest(identifier: processingTaskIdentifier)",
            "request.requiresNetworkConnectivity = true",
            "request.requiresExternalPower = false",
            "didAttemptTaskRegistration",
        ),
    )

    if ".apply()" in kotlin_plugin:
        fail("Android callback handles must be committed before initialize returns")
    if "static Future<void> setupBackgroundChannel" in dart:
        fail("the headless dispatcher must remain a top-level Dart entrypoint")
    require_before(
        kotlin_plugin,
        kotlin_plugin_path,
        ".putLong(KEY_DISPATCHER_HANDLE, dispatcher)",
        ".commit()",
    )
    require_before(
        kotlin_worker,
        kotlin_worker_path,
        "if (callbackHandle == 0L || dispatcherHandle == 0L)",
        "FlutterEngine(applicationContext)",
    )
    if "FlutterLoader()" in kotlin_worker or "new FlutterLoader()" in java_worker:
        fail("background workers must share FlutterEngine's injected loader")
    require_before(
        java_worker,
        java_worker_path,
        "if (callbackHandle == 0L || dispatcherHandle == 0L)",
        "startDrain(context, callbackHandle, dispatcherHandle, completer)",
    )
    if kotlin_worker.count("Result.retry()") != 1:
        fail("Kotlin retries must all flow through the bounded retryOrFail helper")
    if java_worker.count("Result.retry()") != 1:
        fail("Java retries must all flow through the bounded retryOrFail helper")
    if "const val MAX_ATTEMPTS = 5" not in kotlin_worker:
        fail("Kotlin worker must retain the audited five-attempt ceiling")
    if "private static final int MAX_ATTEMPTS = 5" not in java_worker:
        fail("Java worker must retain the audited five-attempt ceiling")
    require_before(swift, swift_path, "finished = true", "engine.destroyContext()")
    require_before(
        swift,
        swift_path,
        "guard !didAttemptTaskRegistration",
        "BGTaskScheduler.shared.register(",
    )
    require_before(
        swift,
        swift_path,
        'case "scheduleExpedited":',
        "try Self.scheduleProcessing()",
    )
    if "cancelAllTaskRequests" in swift:
        fail("iOS cancelAll must not cancel host-app or other-plugin BGTasks")

    flutter_test_path = (
        "clients/flutter_background/test/opto_sync_flutter_background_test.dart"
    )
    flutter_test = read(flutter_test_path)
    require(
        flutter_test,
        flutter_test_path,
        (
            "accepts and forwards the exact platform floor",
            "does not hide programmer Errors",
            "validates malformed callback arguments",
            "restores and invokes the registered drain",
            "dispatcher handle restores the top-level engine entrypoint",
            "surfaces an explicit cancellation failure",
        ),
    )

    gradle = read("clients/flutter_background/android/build.gradle")
    build_gate = read("scripts/build-mobile-native.py")
    match = re.search(r"work-runtime-ktx:(\d+\.\d+\.\d+)", gradle)
    if not match:
        fail("could not resolve the plugin WorkManager version")
    work_version = match.group(1)
    if f"work-runtime-ktx:{work_version}" not in build_gate:
        fail("the native compile gate and plugin use different WorkManager versions")
    if tuple(map(int, work_version.split("."))) >= (2, 11, 0):
        fail("WorkManager 2.11+ requires minSdk 23; this plugin declares minSdk 21")
    compile_sdk_match = re.search(r"compileSdk\s*=\s*(\d+)", gradle)
    agp_match = re.search(
        r"com\.android\.tools\.build:gradle:(\d+\.\d+\.\d+)", gradle
    )
    min_sdk_match = re.search(r"minSdk\s*=\s*(\d+)", gradle)
    if not compile_sdk_match or int(compile_sdk_match.group(1)) < 35:
        fail("WorkManager 2.10.x must compile against Android API 35+")
    if not agp_match or tuple(map(int, agp_match.group(1).split("."))) < (8, 6, 0):
        fail("Android API 35 requires Android Gradle Plugin 8.6+")
    if not min_sdk_match or int(min_sdk_match.group(1)) != 21:
        fail("the plugin must retain its audited Android minSdk 21 contract")

    version_patterns = {
        "clients/flutter_background/pubspec.yaml": r"^version:\s*([^\s]+)$",
        "clients/flutter_background/android/build.gradle": r"^version\s*=\s*'([^']+)'$",
        "clients/flutter_background/ios/opto_sync_flutter_background.podspec": (
            r"^\s*s\.version\s*=\s*'([^']+)'$"
        ),
    }
    versions: dict[str, str] = {}
    for relative, pattern in version_patterns.items():
        match = re.search(pattern, read(relative), re.MULTILINE)
        if not match:
            fail(f"could not resolve package version from {relative}")
        versions[relative] = match.group(1)
    if len(set(versions.values())) != 1:
        fail(f"Flutter/Android/iOS package versions disagree: {versions}")
    plugin_version = next(iter(versions.values()))

    forbidden = (
        "accessToken",
        "refreshToken",
        "service_role",
        "Authorization: Bearer",
    )
    for relative, text in (
        (dart_path, dart),
        (kotlin_plugin_path, kotlin_plugin),
        (kotlin_worker_path, kotlin_worker),
        (java_worker_path, java_worker),
        (swift_path, swift),
    ):
        for marker in forbidden:
            if marker in text:
                fail(f"{relative} embeds forbidden credential material {marker!r}")

    # Android diagnostics must remain fixed event names. Logging callback
    # error objects, platform messages, or details could persist credentials
    # or record data from a host application's drain implementation.
    forbidden_log_values = (
        "Log.w(LOG_TAG, error",
        "Log.e(LOG_TAG, error",
        "Log.w(LOG_TAG, message",
        "Log.e(LOG_TAG, message",
        "Log.w(LOG_TAG, details",
        "Log.e(LOG_TAG, details",
    )
    for relative, text in (
        (kotlin_worker_path, kotlin_worker),
        (java_worker_path, java_worker),
    ):
        for marker in forbidden_log_values:
            if marker in text:
                fail(f"{relative} logs sensitive callback failure material")

    print(
        "mobile background contracts passed: durable registration, bounded "
        "retries, privacy-safe Android diagnostics, scoped iOS cancellation, "
        "safe Flutter fallback, and "
        f"plugin {plugin_version} with WorkManager {work_version}, API "
        f"{compile_sdk_match.group(1)} compile, and minSdk 21 compatibility"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
