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
        "runOnce",
        "cancel",
    ),
    "native/ios/swift/OptoSyncBackgroundScheduler.swift": (
        "BGTaskScheduler.shared.register",
        "BGProcessingTaskRequest",
        "requiresNetworkConnectivity = true",
        "expirationHandler",
        "optoSyncBackgroundMain",
        "runOnce",
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
        "setTaskCompletedWithSuccess",
    ),
    "native/android/kotlin/OptoSyncWorker.kt": (
        "CoroutineWorker",
        "withTimeout",
        "enqueueUniqueWork",
        "ExistingWorkPolicy.KEEP",
        "NetworkType.CONNECTED",
        "optoSyncBackgroundMain",
        "runOnce",
        "cancel",
    ),
    "native/android/java/OptoSyncWorker.java": (
        "ListenableWorker",
        "CallbackToFutureAdapter",
        "enqueueUniqueWork",
        "ExistingWorkPolicy.KEEP",
        "NetworkType.CONNECTED",
        "optoSyncBackgroundMain",
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

    print(
        "mobile background adapters passed: Flutter entrypoint, Swift/Objective-C "
        "BGTaskScheduler, Kotlin/Java WorkManager"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
