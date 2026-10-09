"""Compiler entry contract tests. Fake runner only; never start Wine or a VM."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("compiler_entry", ROOT / "packages/mt5/backend/resources/compiler-entry.py")
entry = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = entry
spec.loader.exec_module(entry)


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


class EntryTests(unittest.TestCase):
    def setUp(self):
        base = ROOT.parent.parent / ".test-output/compiler"
        base.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="compiler-entry-test-", dir=base)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_production_utf16le_bom_and_crlf_are_preserved_without_exit_code_inference(self):
        diagnostics = "Z:\\build\\Experts\\Strategy.mq5 : 中文\r\nResult: 0 errors, 2 warnings\r\n"
        decoded = entry.decode_diagnostics(b"\xff\xfe" + diagnostics.encode("utf-16-le"))
        self.assertEqual(decoded, diagnostics)
        self.assertEqual(entry.decode_diagnostics(diagnostics.encode("utf-16-le")), diagnostics)
        result = entry.make_result(decoded, sha(b"EX5"), 3)
        self.assertEqual(result, {"success": True, "diagnostics": diagnostics, "ex5_sha256": sha(b"EX5")})

    def test_ordinary_errors_keep_the_entire_log_including_early_error_lines(self):
        diagnostics = "Strategy.mq5(1,1) : error 256: missing_compile_token\r\n" + "detail\r\n" * 3000 + "Result: 1 errors, 0 warnings\r\n"
        result = entry.make_result(entry.decode_diagnostics(b"\xff\xfe" + diagnostics.encode("utf-16-le")))
        self.assertFalse(result["success"]); self.assertIsNone(result["ex5_sha256"])
        self.assertEqual(result["diagnostics"], diagnostics)

    def test_json_exactly_8mib_and_artifact_exactly_32mib_are_accepted_not_truncated(self):
        baseline = b'{"success":false,"diagnostics":"","ex5_sha256":null}\n'
        self.assertEqual(entry.encode_result(entry.make_result("")), baseline)
        diagnostics = "a" * (8 * 1024 * 1024 - len(baseline))
        self.assertEqual(len(entry.encode_result(entry.make_result(diagnostics))), 8 * 1024 * 1024)
        with self.assertRaises(entry.CompilerEntryError): entry.encode_result(entry.make_result(diagnostics + "a"))
        success = "Result: 0 errors, 0 warnings"
        self.assertTrue(entry.make_result(success, sha(b"x"), 32 * 1024 * 1024)["success"])
        with self.assertRaises(entry.CompilerEntryError): entry.make_result(success, sha(b"x"), 32 * 1024 * 1024 + 1)
        with self.assertRaises(entry.CompilerEntryError): entry.make_result(success, sha(b""), 0)
        with self.assertRaises(entry.CompilerEntryError): entry.decode_diagnostics(b"\x00" * (16 * 1024 * 1024 + 3))

    def fixture(self, diagnostics="Result: 0 errors, 0 warnings\r\n", artifact=b"EX5 controlled"):
        build, terminal, prefix, work, temporary = [self.root / name for name in ("build", "terminal", "prefix", "work", "tmp")]
        for directory in (build / "Experts", build / "Include", build / ".compiler", terminal, prefix, work, temporary):
            directory.mkdir(parents=True, exist_ok=True)
        source = b"void OnTick() {}\n"; editor = b"MZ fixture never executed"
        (build / "Experts/Strategy.mq5").write_bytes(source)
        (build / ".compiler/MetaEditor64.exe").write_bytes(editor)
        (terminal / "MetaEditor64.exe").write_bytes(editor)
        manifest = {"compiler_sha256": sha(editor), "files": {
            ".compiler/MetaEditor64.exe": {"bytes": len(editor), "sha256": sha(editor)},
            "Experts/Strategy.mq5": {"bytes": len(source), "sha256": sha(source)},
        }}
        raw = json.dumps(manifest).encode(); (build / "manifest.json").write_bytes(raw)
        layout = entry.Layout(build, terminal / "MetaEditor64.exe", prefix, work, temporary)

        class FakeRunner:
            started = False
            closed = False
            env = None

            def start(self, env, deadline):
                self.started, self.env = True, env.copy()

            def run(self, command, env, deadline):
                self.command = command
                (prefix / "owned-state").write_bytes(b"private")
                if diagnostics is not None:
                    (build / "Experts/Strategy.log").write_bytes(b"\xff\xfe" + diagnostics.encode("utf-16-le"))
                if artifact is not None:
                    (build / "Experts/Strategy.ex5").write_bytes(artifact)
                return 1 if artifact is not None else 0

            def close(self, env):
                self.closed = True

        return layout, sha(raw), FakeRunner()

    def test_fake_compile_exports_only_result_and_ex5_and_uses_its_private_prefix(self):
        layout, expected, runner = self.fixture()
        user_prefix = self.root / "untouched-user-prefix"; user_prefix.mkdir(); (user_prefix / "sentinel").write_text("keep")
        with patch.dict(os.environ, {"WINEPREFIX": str(user_prefix), "HOME": str(user_prefix)}):
            result = entry.compile_snapshot(layout, expected, timeout=10, runner=runner)
        self.assertTrue(result["success"]); self.assertTrue(runner.closed)
        self.assertEqual(runner.env["WINEPREFIX"], str(layout.prefix))
        self.assertNotEqual(runner.env["HOME"], str(user_prefix))
        self.assertEqual(runner.command, ["/opt/wine-staging/bin/wine", "/terminal/MetaEditor64.exe", "/compile:Z:\\build\\Experts\\Strategy.mq5", "/include:Z:\\build", "/log"])
        self.assertEqual({path.name for path in layout.work.iterdir()}, {"compile-result.json", "Strategy.ex5"})
        self.assertEqual(json.loads((layout.work / "compile-result.json").read_text()), result)
        self.assertEqual(result["ex5_sha256"], sha((layout.work / "Strategy.ex5").read_bytes()))
        self.assertEqual((user_prefix / "sentinel").read_text(), "keep")

    def test_fake_ordinary_error_is_a_valid_result_and_missing_log_is_protocol_failure(self):
        layout, expected, runner = self.fixture("error: missing_compile_token\r\nResult: 1 errors, 0 warnings\r\n", None)
        result = entry.compile_snapshot(layout, expected, timeout=10, runner=runner)
        self.assertFalse(result["success"]); self.assertTrue(runner.closed)
        self.assertEqual({path.name for path in layout.work.iterdir()}, {"compile-result.json"})
        (layout.work / "compile-result.json").unlink(); (layout.build / "Experts/Strategy.log").unlink(); (layout.prefix / "owned-state").unlink()
        def no_log(command, env, deadline): return 0
        runner.run = no_log
        with self.assertRaises(entry.CompilerEntryError): entry.compile_snapshot(layout, expected, timeout=10, runner=runner)
        self.assertEqual(list(layout.work.iterdir()), [])

    def test_timeout_and_input_failure_clean_up_without_publishing_results(self):
        layout, expected, runner = self.fixture()
        def timeout(command, env, deadline): raise subprocess.TimeoutExpired(command, 0.1)
        runner.run = timeout
        with self.assertRaises(entry.CompilerEntryError): entry.compile_snapshot(layout, expected, timeout=0.1, runner=runner)
        self.assertTrue(runner.closed); self.assertEqual(list(layout.work.iterdir()), [])
        runner.started = False
        with self.assertRaises(entry.CompilerEntryError): entry.compile_snapshot(layout, "sha256:" + "0" * 64, timeout=10, runner=runner)
        self.assertFalse(runner.started)

    def test_internal_deadlines_never_exceed_existing_standard_or_mac_limits(self):
        required = ["--manifest-sha256", "sha256:" + "0" * 64]
        self.assertEqual(entry.parse_args(required).timeout, 115)
        self.assertEqual(entry.parse_args(required + ["--budget", "macos"]).timeout, 295)
        self.assertEqual(entry.parse_args(required + ["--timeout", "0.25"]).timeout, 0.25)
        for value in ("116", "0", "nan", "inf"):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                entry.parse_args(required + ["--timeout", value])

    def test_real_runner_refuses_the_development_host_before_starting_any_process(self):
        with patch.dict(os.environ, {"SESAME_COMPILER_GUEST": "1"}), patch.object(entry.subprocess, "Popen", side_effect=AssertionError("host process forbidden")):
            with self.assertRaises(entry.CompilerEntryError): entry.GuestRunner()

    def test_each_frozen_mount_must_be_readonly_not_just_have_readonly_mode_bits(self):
        layout, _, _ = self.fixture()
        expected_paths = {layout.build / "Include", layout.build / ".compiler", layout.build / "manifest.json", layout.editor}
        visited = []
        def read_only(path):
            visited.append(path)
            return SimpleNamespace(f_flag=1)
        with patch.object(entry.os, "ST_RDONLY", 1, create=True), patch.object(entry.os, "statvfs", read_only, create=True):
            entry.readonly_inputs(layout)
        self.assertEqual(set(visited), expected_paths)
        for writable_path in expected_paths:
            def one_writable(path): return SimpleNamespace(f_flag=0 if path == writable_path else 1)
            with patch.object(entry.os, "ST_RDONLY", 1, create=True), patch.object(entry.os, "statvfs", one_writable, create=True):
                with self.assertRaisesRegex(entry.CompilerEntryError, "read-only"):
                    entry.readonly_inputs(layout)

    def test_nonempty_prefix_stale_output_or_changed_editor_never_start_wine(self):
        layout, expected, runner = self.fixture()
        (layout.prefix / "user-state").write_bytes(b"must not be used")
        with self.assertRaises(entry.CompilerEntryError): entry.compile_snapshot(layout, expected, runner=runner)
        self.assertFalse(runner.started)
        (layout.prefix / "user-state").unlink()
        (layout.build / "Experts/Strategy.ex5").write_bytes(b"stale success must not count")
        with self.assertRaises(entry.CompilerEntryError): entry.compile_snapshot(layout, expected, runner=runner)
        self.assertFalse(runner.started)
        (layout.build / "Experts/Strategy.ex5").unlink()
        layout.editor.write_bytes(b"changed")
        with self.assertRaises(entry.CompilerEntryError): entry.compile_snapshot(layout, expected, runner=runner)
        self.assertFalse(runner.started)

    def test_cleanup_failure_prevents_export_and_outer_exception_does_not_remove_success(self):
        layout, expected, runner = self.fixture()
        def failed_cleanup(env): raise entry.CompilerEntryError("cleanup", "cleanup failed")
        original_close = runner.close; runner.close = failed_cleanup
        with self.assertRaises(entry.CompilerEntryError): entry.compile_snapshot(layout, expected, runner=runner)
        self.assertEqual(list(layout.work.iterdir()), [])
        for path in (layout.build / "Experts/Strategy.log", layout.build / "Experts/Strategy.ex5", layout.prefix / "owned-state"):
            path.unlink()
        runner.close = original_close
        try:
            raise RuntimeError("a caller may be handling an unrelated exception")
        except RuntimeError:
            result = entry.compile_snapshot(layout, expected, runner=runner)
        self.assertTrue(result["success"])
        self.assertTrue((layout.work / "compile-result.json").is_file())

    def test_process_adapter_inherits_supervisor_output_and_kills_only_the_private_prefix(self):
        calls = []
        def fake_process(command, **options):
            calls.append((command, options))
            return SimpleNamespace(returncode=1)
        with patch.object(entry, "guest_preflight"), patch.object(entry.subprocess, "run", fake_process):
            runner = entry.GuestRunner()
            private_env = {"WINEPREFIX": "/prefix"}
            self.assertEqual(runner.run(list(entry.COMMAND), private_env, entry.time.monotonic() + 5), 1)
            runner.close(private_env)
        self.assertEqual(calls[1][0], ["/opt/wine-staging/bin/wineserver", "-k"])
        for command, options in calls:
            self.assertEqual(options["env"], private_env)
            self.assertNotIn("stdout", options)
            self.assertNotIn("stderr", options)
        self.assertLessEqual(calls[1][1]["timeout"], 2)

    def test_short_result_write_removes_both_export_files(self):
        layout, expected, runner = self.fixture()
        original_open = Path.open
        class ShortWriter:
            def __enter__(self): return self
            def __exit__(self, *args): self.handle.close()
            def write(self, data):
                self.handle.write(data[:3])
                return 3
        def controlled_open(path, *args, **kwargs):
            handle = original_open(path, *args, **kwargs)
            if path == layout.work / "compile-result.json":
                result = ShortWriter(); result.handle = handle
                return result
            return handle
        with patch.object(Path, "open", controlled_open):
            with self.assertRaisesRegex(entry.CompilerEntryError, "Short compiler result write"):
                entry.compile_snapshot(layout, expected, runner=runner)
        self.assertTrue(runner.closed)
        self.assertEqual(list(layout.work.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
