"""Fail-closed boundaries for the functional-conformance test-harness exemption.

Only deliberate Dart executable test fixtures in tool/ may be exempt. This
must not exempt production lib/ Dart, everyday tool CLIs, or false lookalikes.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fp_conformance import EXEMPT_PATH


class DartHarnessBoundaryTests(unittest.TestCase):
    def test_explicit_non_shipped_harnesses_are_exempt(self):
        harnesses = (
            "clients/dart/tool/connectivity_itf_replay.dart",
            "clients/dart/tool/scheduler_itf_replay.dart",
            "clients/dart/tool/formal_itf_replay/runner.dart",
            "clients/reactive-dart/tool/background_failure_test.dart",
            "clients/reactive-dart/tool/background_contract_test.dart",
            "clients/reactive-dart/tool/desktop_self_test.dart",
            "clients/reactive-dart/tool/sqlite_conformance_child.dart",
            "clients/reactive-dart/tool/sqlite_desktop_child.dart",
            "clients/reactive-dart/tool/lifecycle_formal_self_test.dart",
        )
        for path in harnesses:
            with self.subTest(path=path):
                self.assertIsNotNone(EXEMPT_PATH.search(path))

    def test_real_sdk_and_tool_commands_remain_scanned(self):
        production = (
            "clients/dart/lib/opto_sync_client.dart",
            "clients/dart/lib/src/protocol_sync_loop.dart",
            "clients/reactive-dart/lib/src/desktop_sync.dart",
            "clients/reactive-dart/lib/src/ridl_rpc.dart",
            "clients/reactive-dart/tool/sync_cli.dart",
            "clients/reactive-dart/tool/desktop_runner.dart",
            "clients/reactive-dart/tool/validate_contract.dart",
            "clients/reactive-dart/tool/run_child.dart",
            "clients/reactive-dart/tool/formal_itf_replay/runner.js",
        )
        for path in production:
            with self.subTest(path=path):
                self.assertIsNone(EXEMPT_PATH.search(path))

    def test_exemption_does_not_match_suffix_lookalikes(self):
        for path in (
            "clients/dart/tool/desktop_self_test.dart.exe",
            "clients/dart/tool/fake_child.dart.bak",
            "clients/dart/tool/formal_itf_replay/runner.dart.bak",
            "clients/dart/tool/formal_itf_replay/nested/production.dart",
        ):
            with self.subTest(path=path):
                self.assertIsNone(EXEMPT_PATH.search(path))


if __name__ == "__main__":
    unittest.main()
