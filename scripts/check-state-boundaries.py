#!/usr/bin/env python3
"""Keep the three example crates physically separate, including target deps."""
import pathlib
import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKSPACE = ROOT / "examples/state-workspace"


def dependencies(manifest):
    yield from manifest.get("dependencies", {}).items()
    for target in manifest.get("target", {}).values():
        yield from target.get("dependencies", {}).items()


def main():
    workspace = tomllib.loads((WORKSPACE / "Cargo.toml").read_text())
    assert set(workspace["workspace"]["members"]) == {
        "app-client", "app-server", "app-shared"
    }, "workspace must retain all three physical crates"
    for crate in ("app-client", "app-shared"):
        manifest = tomllib.loads((WORKSPACE / crate / "Cargo.toml").read_text())
        allowed = {"serde"} if crate == "app-shared" else {"app-shared", "leptos", "dioxus"}
        for name, spec in dependencies(manifest):
            package = spec.get("package", name) if isinstance(spec, dict) else name
            assert package in allowed, f"{crate} unexpected dependency: {package}"
            if isinstance(spec, dict) and "path" in spec:
                assert (WORKSPACE / crate / spec["path"]).resolve() == WORKSPACE / "app-shared", (
                    f"{crate} path escapes shared DTO boundary"
                )
        for source in (WORKSPACE / crate / "src").rglob("*.rs"):
            text = source.read_text()
            assert '#[path' not in text and 'include!' not in text, (
                f"{source} must not include source from another crate"
            )
    print("State workspace: native server, WASM client and shared DTO boundaries passed")


if __name__ == "__main__":
    main()
