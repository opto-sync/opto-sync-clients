#!/usr/bin/env python3
"""Compile every mobile background-sync native source with a real toolchain.

`clients/reactive-dart/tool/check_native_background_adapters.py` proves the
adapters *say* the right things. This proves they *compile*: the Kotlin, Java,
Swift, and Objective-C sources under `clients/flutter_background` and
`clients/reactive-dart/native` are handed to a genuine Android (Gradle/AGP/KGP)
or Xcode (swiftc/clang) toolchain.

The plugin's Android and iOS sources cannot be built standalone -- they need the
Flutter embedding and `Flutter.framework`, which only exist inside a Flutter host
app. So both subcommands scaffold a throwaway app with `flutter create`, depend
on the plugin *by path* exactly like a downstream consumer, and build it. No
device, emulator, simulator, or signing identity is involved.

    python3 scripts/build-mobile-native.py android [--workspace DIR] [--keep]
    python3 scripts/build-mobile-native.py ios     [--workspace DIR] [--keep]
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "clients" / "flutter_background"
REFERENCE = ROOT / "clients" / "reactive-dart" / "native"

# Keep in step with clients/flutter_background/android/build.gradle: the
# reference adapters in clients/reactive-dart/native are plain source files with
# no build file of their own, so the gate supplies their compile dependencies.
WORK_RUNTIME = "androidx.work:work-runtime-ktx:2.9.1"
CONCURRENT_FUTURES = "androidx.concurrent:concurrent-futures:1.2.0"

# iOS deployment target and Swift language mode declared by the podspec.
IOS_MIN_VERSION = "13.0"
SWIFT_VERSION = "5"


def annotate(title: str, message: str) -> None:
    """Emit a GitHub Actions error annotation, mirroring the sibling gates."""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        flat = message.replace("\n", "%0A")
        print(f"::error title={title}::{flat}", flush=True)


def fail(title: str, message: str) -> "NoReturn":  # type: ignore[valid-type]
    annotate(title, message)
    print(f"build-mobile-native: {title}: {message}", file=sys.stderr, flush=True)
    raise SystemExit(1)


def step(message: str) -> None:
    print(f"\n=== {message} ===", flush=True)


def run(command: list[str], *, cwd: Path, title: str) -> None:
    print(f"$ {' '.join(command)}  (cwd={cwd})", flush=True)
    result = subprocess.run(command, cwd=cwd)
    if result.returncode != 0:
        fail(title, f"`{' '.join(command)}` exited {result.returncode}")


def capture(command: list[str], *, title: str) -> str:
    try:
        return subprocess.check_output(command, text=True, stderr=subprocess.STDOUT)
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        output = getattr(error, "output", str(error))
        fail(title, f"`{' '.join(command)}` failed: {output}")


def flutter() -> str:
    binary = os.environ.get("FLUTTER_BIN") or shutil.which("flutter")
    if not binary:
        fail(
            "Flutter SDK missing",
            "`flutter` is not on PATH; install it or set FLUTTER_BIN",
        )
    return binary


def only(paths: list[Path], *, what: str, title: str) -> Path:
    if not paths:
        fail(title, f"the build produced no {what}")
    return sorted(paths)[0]


def scaffold(workspace: Path, name: str, platforms: str) -> Path:
    """Create a throwaway Flutter host app; returns its directory."""
    app = workspace / name
    if app.exists():
        shutil.rmtree(app)
    workspace.mkdir(parents=True, exist_ok=True)
    run(
        [
            flutter(),
            "create",
            "--template=app",
            f"--platforms={platforms}",
            "--org=dev.optosync",
            f"--project-name={name}",
            name,
        ],
        cwd=workspace,
        title="flutter create failed",
    )
    return app


def depend_on_plugin(app: Path) -> None:
    """Add the plugin as a path dependency, as a downstream app would."""
    pubspec = app / "pubspec.yaml"
    lines = pubspec.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines):
        if line.rstrip() == "dependencies:":
            lines.insert(index + 1, f"    path: {PLUGIN}")
            lines.insert(index + 1, "  opto_sync_flutter_background:")
            break
    else:
        fail(
            "scaffold app is malformed",
            f"no `dependencies:` block in {pubspec}",
        )
    pubspec.write_text("\n".join(lines) + "\n", encoding="utf-8")
    run([flutter(), "pub", "get"], cwd=app, title="plugin path dependency failed")

    resolved = app / ".flutter-plugins-dependencies"
    if "opto_sync_flutter_background" not in resolved.read_text(encoding="utf-8"):
        fail(
            "plugin did not register",
            "the host app resolved without opto_sync_flutter_background; "
            "check the `flutter: plugin:` block in clients/flutter_background/pubspec.yaml",
        )


def dex_bytes(apk: Path) -> bytes:
    with zipfile.ZipFile(apk) as archive:
        names = [n for n in archive.namelist() if n.endswith(".dex")]
        if not names:
            fail("APK has no dex", f"{apk} contains no classes*.dex")
        return b"".join(archive.read(name) for name in names)


def require_dex_types(apk: Path, classes: dict[str, str]) -> None:
    """Assert each class really reached the shipped dex.

    A missing source set is silent -- nothing else references these workers, so
    Gradle would happily produce a green build with the sources never compiled.
    The dex is the only layout-independent proof that they were.
    """
    payload = dex_bytes(apk)
    for fqn, why in classes.items():
        descriptor = "L" + fqn.replace(".", "/") + ";"
        if descriptor.encode("utf-8") not in payload:
            fail(
                "native source was not compiled",
                f"{fqn} is absent from {apk.name}: {why}",
            )
        print(f"  compiled and dexed: {fqn}", flush=True)


def build_apk(app: Path, *, flavor: str | None = None) -> Path:
    command = [flutter(), "build", "apk", "--debug"]
    if flavor:
        command += ["--flavor", flavor]
    run(command, cwd=app, title="Android build failed")
    apks = list((app / "build" / "app" / "outputs" / "flutter-apk").glob("*debug.apk"))
    if flavor:
        apks = [apk for apk in apks if flavor in apk.name]
    return only(apks, what="debug APK", title="Android build produced no APK")


def add_reference_flavors(app: Path) -> None:
    """Give the reference adapters one build variant each.

    Both `clients/reactive-dart/native/android/{kotlin,java}/OptoSyncWorker`
    declare the same fully qualified name, so they can only be compiled in
    mutually exclusive variants -- and never alongside the plugin, which also
    ships a `dev.optosync.background.OptoSyncWorker`.
    """
    module = app / "android" / "app"
    for flavor, language, source in (
        ("refkotlin", "kotlin", REFERENCE / "android/kotlin/OptoSyncWorker.kt"),
        ("refjava", "java", REFERENCE / "android/java/OptoSyncWorker.java"),
    ):
        if not source.is_file():
            fail("reference adapter missing", f"{source} does not exist")
        package = module / "src" / flavor / language / "dev" / "optosync" / "background"
        package.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, package / source.name)

    kts = module / "build.gradle.kts"
    groovy = module / "build.gradle"
    if kts.is_file():
        kts.write_text(
            kts.read_text(encoding="utf-8")
            + f"""
// --- opto-sync native compile gate ---
android {{
    flavorDimensions += "adapter"
    productFlavors {{
        create("refkotlin") {{ dimension = "adapter" }}
        create("refjava") {{ dimension = "adapter" }}
    }}
}}

dependencies {{
    implementation("{WORK_RUNTIME}")
    implementation("{CONCURRENT_FUTURES}")
}}
""",
            encoding="utf-8",
        )
    elif groovy.is_file():
        groovy.write_text(
            groovy.read_text(encoding="utf-8")
            + f"""
// --- opto-sync native compile gate ---
android {{
    flavorDimensions 'adapter'
    productFlavors {{
        refkotlin {{ dimension 'adapter' }}
        refjava {{ dimension 'adapter' }}
    }}
}}

dependencies {{
    implementation '{WORK_RUNTIME}'
    implementation '{CONCURRENT_FUTURES}'
}}
""",
            encoding="utf-8",
        )
    else:
        fail("scaffold app is malformed", f"no app build file under {module}")


def android(workspace: Path) -> None:
    step("plugin host app: Kotlin plugin + Kotlin worker + plain-Java worker")
    app = scaffold(workspace, "opto_sync_plugin_gate", "android")
    depend_on_plugin(app)
    apk = build_apk(app)
    require_dex_types(
        apk,
        {
            "dev.optosync.background.OptoSyncBackgroundPlugin": (
                "the Kotlin method-channel plugin did not compile into the app"
            ),
            "dev.optosync.background.OptoSyncWorker": (
                "the Kotlin CoroutineWorker did not compile into the app"
            ),
            "dev.optosync.background.OptoSyncWorkerJava": (
                "the plain-Java ListenableWorker did not compile into the app; "
                "clients/flutter_background/android/build.gradle must keep "
                "src/main/java in the main source set"
            ),
        },
    )

    step("reference adapters: clients/reactive-dart/native/android")
    reference_app = scaffold(workspace, "opto_sync_reference_gate", "android")
    add_reference_flavors(reference_app)
    for flavor, language in (("refkotlin", "Kotlin"), ("refjava", "Java")):
        print(f"\n-- {language} reference WorkManager adapter --", flush=True)
        variant = build_apk(reference_app, flavor=flavor)
        require_dex_types(
            variant,
            {
                "dev.optosync.background.OptoSyncWorker": (
                    f"the {language} reference adapter did not compile"
                )
            },
        )

    print(
        "\nandroid native build gate passed: Kotlin plugin, Kotlin worker, "
        "plain-Java worker, and both reference WorkManager adapters compiled",
        flush=True,
    )


def compile_reference_ios(app: Path) -> None:
    """Compile the reference iOS adapters against the app's Flutter.framework.

    They are standalone reference sources with no podspec, and the Swift and
    Objective-C variants declare the same class name, so they cannot share a
    target. Compiling each to an object file exercises the whole front end.
    """
    frameworks = list((app / "build" / "ios").glob("*/Flutter.framework"))
    search_path = only(
        frameworks, what="Flutter.framework", title="Flutter.framework missing"
    ).parent
    sdk = capture(
        ["xcrun", "--sdk", "iphoneos", "--show-sdk-path"], title="iOS SDK missing"
    ).strip()
    objects = app / "build" / "reference-objects"
    objects.mkdir(parents=True, exist_ok=True)

    swift_source = REFERENCE / "ios/swift/OptoSyncBackgroundScheduler.swift"
    objc_source = REFERENCE / "ios/objective-c/OptoSyncBackgroundScheduler.m"
    for source in (swift_source, objc_source):
        if not source.is_file():
            fail("reference adapter missing", f"{source} does not exist")

    swift_object = objects / "OptoSyncBackgroundScheduler.swift.o"
    run(
        [
            "xcrun", "--sdk", "iphoneos", "swiftc", "-c",
            "-target", f"arm64-apple-ios{IOS_MIN_VERSION}",
            "-sdk", sdk,
            "-swift-version", SWIFT_VERSION,
            "-module-name", "OptoSyncBackgroundReference",
            "-F", str(search_path),
            "-o", str(swift_object),
            str(swift_source),
        ],
        cwd=app,
        title="Swift reference adapter failed to compile",
    )

    objc_object = objects / "OptoSyncBackgroundScheduler.m.o"
    run(
        [
            "xcrun", "--sdk", "iphoneos", "clang", "-c",
            "-arch", "arm64",
            "-isysroot", sdk,
            f"-mios-version-min={IOS_MIN_VERSION}",
            "-fobjc-arc",
            "-Werror=objc-method-access",
            "-F", str(search_path),
            "-I", str(objc_source.parent),
            "-o", str(objc_object),
            str(objc_source),
        ],
        cwd=app,
        title="Objective-C reference adapter failed to compile",
    )

    for produced in (swift_object, objc_object):
        if not produced.is_file():
            fail("reference adapter produced no object", str(produced))
        print(f"  compiled: {produced.name}", flush=True)


def ios(workspace: Path) -> None:
    step("plugin host app: Swift plugin + Objective-C bridge")
    app = scaffold(workspace, "opto_sync_plugin_gate", "ios")
    depend_on_plugin(app)
    run(
        [flutter(), "build", "ios", "--debug", "--no-codesign"],
        cwd=app,
        title="iOS build failed",
    )

    framework = only(
        list((app / "build" / "ios").glob("*/*/opto_sync_flutter_background.framework"))
        + list((app / "build" / "ios").glob("*/opto_sync_flutter_background.framework")),
        what="plugin framework",
        title="iOS build produced no plugin framework",
    )

    # The Objective-C bridge is only useful if the podspec ships its header
    # publicly -- that is the import the README tells ObjC hosts to write.
    public_header = framework / "Headers" / "OptoSyncBackgroundBridge.h"
    if not public_header.is_file():
        fail(
            "Objective-C header is not public",
            "OptoSyncBackgroundBridge.h is missing from the built framework's "
            "Headers; #import <opto_sync_flutter_background/OptoSyncBackgroundBridge.h> "
            "would not resolve for host apps",
        )

    # The generated Swift header is the contract the bridge compiles against.
    generated = framework / "Headers" / "opto_sync_flutter_background-Swift.h"
    if not generated.is_file():
        fail(
            "Swift interop header missing",
            f"{generated} was not generated; the Objective-C bridge has nothing to import",
        )
    if "+ (void)registerTasks;" not in generated.read_text(encoding="utf-8"):
        fail(
            "Swift entry point is not exposed to Objective-C",
            "opto_sync_flutter_background-Swift.h does not declare "
            "+ (void)registerTasks; keep @objc on "
            "OptoSyncBackgroundPlugin.registerTasks()",
        )

    # Proof the .m itself was compiled and linked, not merely present on disk.
    symbols = capture(
        ["nm", str(framework / "opto_sync_flutter_background")],
        title="could not read the plugin framework",
    )
    for symbol in (
        "_OBJC_CLASS_$_OptoSyncBackgroundBridge",
        "+[OptoSyncBackgroundBridge registerTasks]",
    ):
        if symbol not in symbols:
            fail(
                "Objective-C bridge was not compiled",
                f"{symbol} is absent from the built framework; check "
                "s.source_files in clients/flutter_background/ios/"
                "opto_sync_flutter_background.podspec",
            )
        print(f"  linked: {symbol}", flush=True)

    step("reference adapters: clients/reactive-dart/native/ios")
    compile_reference_ios(app)

    print(
        "\nios native build gate passed: Swift plugin, Objective-C bridge and its "
        "generated-header interop, and both reference BGTaskScheduler adapters compiled",
        flush=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("platform", choices=("android", "ios"))
    parser.add_argument(
        "--workspace",
        type=Path,
        help="directory for the throwaway host apps (default: a temp directory)",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="keep a temporary workspace instead of deleting it",
    )
    arguments = parser.parse_args()

    if arguments.platform == "ios" and sys.platform != "darwin":
        fail("iOS gate needs macOS", f"cannot run Xcode on {sys.platform}")
    if not PLUGIN.is_dir():
        fail("plugin missing", f"{PLUGIN} does not exist")

    workspace = arguments.workspace
    temporary = workspace is None
    if temporary:
        workspace = Path(tempfile.mkdtemp(prefix="opto-sync-native-"))
    workspace = workspace.resolve()
    print(f"workspace: {workspace}", flush=True)

    try:
        (android if arguments.platform == "android" else ios)(workspace)
    finally:
        if temporary and not arguments.keep:
            shutil.rmtree(workspace, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
