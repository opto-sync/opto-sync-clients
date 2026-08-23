import json
import sys
import tempfile
import unittest
from pathlib import Path


BIN = Path(__file__).resolve().parents[1] / "bin"
sys.path.insert(0, str(BIN))

import check_surface  # noqa: E402
import derive_contract  # noqa: E402
import extract  # noqa: E402


class ApiSurfaceDerivationTests(unittest.TestCase):
    def test_reads_top_level_public_methods_and_skips_private_methods(self):
        surface = {
            "symbols": [
                {
                    "name": "OptoSyncTransport",
                    "kind": "interface",
                    "visibility": "public",
                    "methods": [
                        {
                            "name": "send",
                            "visibility": "public",
                            "parameters": [{"name": "path", "type": {"kind": "primitive", "name": "string"}}],
                        },
                        {"name": "_internal", "visibility": "private", "parameters": []},
                    ],
                },
                {
                    "name": "OptoSyncClient",
                    "kind": "class",
                    "visibility": "public",
                    "methods": [{"name": "health", "visibility": "public", "parameters": []}],
                },
                {
                    "name": "createOptoSyncClient",
                    "kind": "function",
                    "visibility": "public",
                    "parameters": [{"name": "options", "type": {"kind": "named", "name": "Options"}}],
                },
            ]
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "api-surface.json"
            path.write_text(json.dumps(surface), encoding="utf-8")
            operations, client_type = derive_contract.ops_from_api_surface(str(path))

        self.assertEqual(client_type, "OptoSyncClient")
        self.assertEqual(
            [operation["name"] for operation in operations],
            ["create_opto_sync_client", "health", "send"],
        )


class SourceExtractionTests(unittest.TestCase):
    def test_sources_globs_restrict_the_files_that_are_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "src").mkdir()
            (root / "generated").mkdir()
            (root / "src" / "public.py").write_text("def health():\n    return True\n", encoding="utf-8")
            (root / "generated" / "other.py").write_text("def send():\n    return b''\n", encoding="utf-8")

            result = extract.extract(str(root), lang="python", include=("src/**",))

        self.assertEqual(set(result["symbols"]), {"health"})
        self.assertEqual(result["files"], 1)

    def test_empty_gate_surface_is_an_error(self):
        contract = {
            "conventions": {
                "clientType": "OptoSyncClient",
                "errorTypes": [],
                "naming": {"default": "snake_case", "byLanguage": {"python3": "snake_case"}},
            },
            "operations": [{"name": "health", "params": [], "returns": {"type": "object"}}],
        }
        config = {
            "tier": "gate",
            "naming": "snake_case",
            "sources": ["src/**"],
            "exclude": [],
            "minCoverage": 100.0,
        }
        with tempfile.TemporaryDirectory() as tmp:
            clients = Path(tmp) / "clients"
            (clients / "python3" / "src").mkdir(parents=True)
            (clients / "python3" / "src" / "empty.py").write_text("VALUE = 1\n", encoding="utf-8")
            findings, result = check_surface.check_language(
                contract,
                "python3",
                config,
                str(clients),
                {},
            )

        self.assertEqual(result["symbols"], {})
        self.assertTrue(any(f.severity == "error" and "no exported symbols" in f.message for f in findings))
        self.assertTrue(any(f.severity == "error" and "coverage regressed" in f.message for f in findings))


if __name__ == "__main__":
    unittest.main()
