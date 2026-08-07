from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("check-adoption-manifest.py")
SPEC = importlib.util.spec_from_file_location("check_adoption_manifest", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def valid_manifest() -> dict[str, object]:
    return {
        "schemaVersion": "opto-sync.adoption.v1",
        "project": "example/example-clients",
        "clientPackage": {
            "package": "opto-sync/opto-sync-clients",
            "repository": "https://github.com/opto-sync/opto-sync-clients",
            "version": "0.2.0",
            "commit": "068414c8ff7d4262d0a395959b5209d5908f0fcc",
        },
        "languages": ["dart", "rust", "typescript"],
        "dataScopes": ["documents"],
        "localStores": ["indexeddb", "sqlite"],
        "transports": ["http", "websocket"],
        "writeStrategies": ["local-durable", "local-then-remote"],
        "conflictPolicy": {
            "arrayStrategy": "mergeByKey",
            "resolveByTimestamp": True,
            "lwwKeys": ["updatedAt"],
            "arrayMatchKeys": ["id"],
            "tombstones": True,
        },
        "background": {
            "webServiceWorker": True,
            "mobileWorker": True,
            "desktopWorker": True,
        },
        "security": {
            "authenticatedTransport": True,
            "encryptedAtRest": True,
            "secretsInManifest": False,
        },
        "rollout": {"phase": "declared", "owners": ["example-platform"]},
    }


class AdoptionManifestTests(unittest.TestCase):
    def test_accepts_canonical_manifest(self) -> None:
        document = valid_manifest()
        self.assertIs(MODULE.validate_manifest(document), document)

    def test_rejects_mutable_or_abbreviated_client_ref(self) -> None:
        document = valid_manifest()
        document["clientPackage"]["commit"] = "main"  # type: ignore[index]
        with self.assertRaisesRegex(MODULE.ManifestError, "40-character commit SHA"):
            MODULE.validate_manifest(document)

    def test_rejects_credentials_and_unknown_fields(self) -> None:
        document = valid_manifest()
        document["apiToken"] = "not-allowed"
        with self.assertRaises(MODULE.ManifestError):
            MODULE.validate_manifest(document)

    def test_rejects_insecure_transport_and_missing_tombstones(self) -> None:
        document = valid_manifest()
        document["security"]["authenticatedTransport"] = False  # type: ignore[index]
        with self.assertRaisesRegex(MODULE.ManifestError, "must be true"):
            MODULE.validate_manifest(document)

        document = valid_manifest()
        document["conflictPolicy"]["tombstones"] = False  # type: ignore[index]
        with self.assertRaisesRegex(MODULE.ManifestError, "must be true"):
            MODULE.validate_manifest(document)

    def test_file_validator_reports_invalid_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".opto-sync.json"
            path.write_text("{invalid", encoding="utf-8")
            with self.assertRaisesRegex(MODULE.ManifestError, "invalid JSON"):
                MODULE.validate_file(path)

    def test_discovery_prefers_root_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root_manifest = root / ".opto-sync.json"
            root_manifest.write_text(json.dumps(valid_manifest()), encoding="utf-8")
            nested = root / "nested" / ".opto-sync.json"
            nested.parent.mkdir()
            nested.write_text(json.dumps(valid_manifest()), encoding="utf-8")
            self.assertEqual(MODULE.discover(root), [root_manifest])


if __name__ == "__main__":
    unittest.main()
