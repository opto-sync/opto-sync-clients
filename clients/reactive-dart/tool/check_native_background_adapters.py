#!/usr/bin/env python3
"""Static contract checks for the reference mobile background adapters."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED = {
    "native/flutter/opto_sync_background_entry.dart": (
        "@pragma('vm:entry-point')",
        "WidgetsFlutterBinding.ensureInitialized()",
        "MethodChannel(_channelName)",
        "runner.runOnce()",
        "runner.cancel(",
        "invokeMethod<void>('ready')",
    ),
    "native/ios/swift/OptoSyncBackgroundScheduler.swift": (
        "BGTaskScheduler.shared.register",
        "BGProcessingTaskRequest",
        "requiresNetworkConnectivity = true",
        "expirationHandler",
        "optoSyncBackgroundMain",
        "call.method == \"ready\"",
        "runOnce",
        "NSLock()",
        "setTaskCompleted",
    ),
    "native/ios/objective-c/OptoSyncBackgroundScheduler.h": (
        "OptoSyncBackgroundScheduler",
        "registerTask",
        "scheduleAfter",
    ),
    "native/ios/objective-c/OptoSyncBackgroundScheduler.m": (
        "registerForTaskWithIdentifier",
        "BGProcessingTaskRequest",
        "requiresNetworkConnectivity = YES",
        "expirationHandler",
        "runWithEntrypoint:@\"optoSyncBackgroundMain\"",
        "isEqualToString:@\"ready\"",
        "@synchronized (task)",
        "setTaskCompletedWithSuccess",
    ),
    "native/android/kotlin/OptoSyncWorker.kt": (
        "CoroutineWorker",
        "withTimeout",
        "Dispatchers.Main.immediate",
        "CancellationException",
        "enqueueUniqueWork",
        "ExistingWorkPolicy.KEEP",
        "NetworkType.CONNECTED",
        "optoSyncBackgroundMain",
        'call.method != "ready"',
        "AtomicBoolean",
        "runOnce",
        "cancel",
    ),
    "native/android/java/OptoSyncWorker.java": (
        "ListenableWorker",
        "CallbackToFutureAdapter",
        "Handler(Looper.getMainLooper())",
        "postDelayed",
        "enqueueUniqueWork",
        "ExistingWorkPolicy.KEEP",
        "NetworkType.CONNECTED",
        "optoSyncBackgroundMain",
        '"ready".equals(call.method)',
        "AtomicBoolean",
        "runOnce",
        "onStopped",
        "cancel",
    ),
}

FORBIDDEN = (
    "accessToken",
    "refreshToken",
    "service_role",
    "SUPABASE_SERVICE_ROLE",
    "Authorization: Bearer",
)


def fail(message: str) -> None:
    print(f"mobile-background-adapters: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    for relative, needles in REQUIRED.items():
        path = ROOT / relative
        if not path.is_file():
            fail(f"missing {relative}")
        text = path.read_text(encoding="utf-8")
        for needle in needles:
            if needle not in text:
                fail(f"{relative} is missing required contract marker {needle!r}")
        for forbidden in FORBIDDEN:
            if forbidden in text:
                fail(f"{relative} embeds forbidden credential material {forbidden!r}")

    kotlin = (ROOT / "native/android/kotlin/OptoSyncWorker.kt").read_text(
        encoding="utf-8"
    )
    java = (ROOT / "native/android/java/OptoSyncWorker.java").read_text(
        encoding="utf-8"
    )
    if "Result.retry()" not in kotlin or "Result.retry()" not in java:
        fail("both Android adapters must distinguish retryable worker failure")
    if "MAX_ATTEMPTS" not in kotlin or "MAX_ATTEMPTS" not in java:
        fail("Android retry loops must be bounded")
    if "throw cancelled" not in kotlin:
        fail("Kotlin cancellation must propagate rather than become retryable failure")

    swift = (ROOT / "native/ios/swift/OptoSyncBackgroundScheduler.swift").read_text(
        encoding="utf-8"
    )
    objc = (
        ROOT / "native/ios/objective-c/OptoSyncBackgroundScheduler.m"
    ).read_text(encoding="utf-8")
    for text, language in ((swift, "Swift"), (objc, "Objective-C")):
        if "requiresExternalPower" not in text:
            fail(f"{language} adapter must declare its power constraint")
        if "destroyContext" not in text:
            fail(f"{language} adapter must tear down the bounded Flutter engine")
        if "setMethodCallHandler" not in text:
            fail(f"{language} adapter must wait for the Dart readiness handshake")

    print(
        "mobile background adapters passed: readiness handshake, cooperative "
        "cancellation, bounded completion, Flutter entrypoint, Swift/Objective-C "
        "BGTaskScheduler, Kotlin/Java WorkManager"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
