"""Review regressions without executing the PID-1 guest supervisor or a VM."""
import ast
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, source):
    spec = importlib.util.spec_from_file_location(name, ROOT / source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


channel = load("review_channel", "packages/mt5/backend/resources/compiler-channel.py")
snapshot = load("review_snapshot", "packages/mt5/backend/resources/compiler-snapshot.py")


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def line(record):
    return json.dumps(record, separators=(",", ":")).encode() + b"\n"


def records():
    payload = b"controlled fixture, never executed"
    name = ".compiler/MetaEditor64.exe"
    manifest = json.dumps({"compiler_sha256": sha(payload), "files": {
        name: {"bytes": len(payload), "sha256": sha(payload)}}}, separators=(",", ":")).encode()
    return [
        {"type": "begin", "version": 1, "manifest_bytes": len(manifest), "manifest_sha256": sha(manifest)},
        {"type": "manifest_chunk", "offset": 0, "data": base64.b64encode(manifest).decode()},
        {"type": "manifest_end"}, {"type": "file", "index": 0, "path": name},
        {"type": "chunk", "offset": 0, "data": base64.b64encode(payload).decode()},
        {"type": "file_end"}, {"type": "end"}], sha(manifest), payload


def receive_compiler_function(namespace):
    source = ROOT / "packages/mt5/backend/resources/compiler-guest.py"
    tree = ast.parse(source.read_text(encoding="utf-8"), str(source))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                    and node.name == "receive_compiler")
    # Execute only this function definition. Guest PID checks, mounts, processes,
    # cgroup setup, poweroff and the dispatch loop are never evaluated.
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
    return namespace["receive_compiler"]


class CompilerDeadlineReview(unittest.TestCase):
    def test_snapshot_ready_backpressure_does_not_extend_execution_deadline(self):
        for budget, maximum in (("standard", 120), ("macos", 300)):
            with self.subTest(budget=budget):
                clock, calls = [1000.0], []

                class TemporaryDirectory:
                    def __init__(self, **_kwargs):
                        pass

                    def __enter__(self):
                        return "/controlled-private-staging"

                    def __exit__(self, *_args):
                        return False

                def receive_snapshot(*_args, **_kwargs):
                    clock[0] += 20
                    return {"directory": "/controlled-private-staging/snapshot",
                            "manifest_sha256": "sha256:" + "0" * 64,
                            "file_count": 1, "total_bytes": 1}

                def emit(_message):
                    # A slow consumer can delay the synchronous flushed write.
                    clock[0] += 5

                def execute(request, **kwargs):
                    calls.append({"started": clock[0], "request": request, **kwargs})

                namespace = {
                    "sys": SimpleNamespace(path=[], stdin=SimpleNamespace(fileno=lambda: -1)),
                    "time": SimpleNamespace(monotonic=lambda: clock[0]),
                    "tempfile": SimpleNamespace(TemporaryDirectory=TemporaryDirectory),
                    "incoming": bytearray(), "emit": emit, "execute": execute,
                }
                modules = {
                    "compiler_channel": SimpleNamespace(SnapshotInput=lambda *_args: SimpleNamespace(bytes_read=1)),
                    "compiler_snapshot": SimpleNamespace(receive_snapshot=receive_snapshot),
                }
                receive = receive_compiler_function(namespace)
                with patch.dict("sys.modules", modules):
                    receive({"action": "compile_snapshot", "id": "controlled-review",
                             "manifest_sha256": "sha256:" + "0" * 64,
                             "compilerBudget": budget})
                self.assertEqual(len(calls), 1)
                call = calls[0]
                # Production stages have separate transfer and execution
                # budgets. Transfer ends at 1020; readiness takes another 5s.
                self.assertLessEqual(call["started"] + call["request"]["timeout"], 1020 + maximum)
                self.assertEqual(call.get("deadline_at"), 1020 + maximum)


@unittest.skipUnless(os.name == "posix", "Real pipe polling is verified on Linux")
class CompilerChannelPipeReview(unittest.TestCase):
    def setUp(self):
        base = ROOT / ".test-output/compiler"
        base.mkdir(parents=True, exist_ok=True)
        self.parent = tempfile.TemporaryDirectory(prefix="compiler-channel-review-", dir=base)
        self.addCleanup(self.parent.cleanup)
        self.reader, self.writer = os.pipe()
        self.addCleanup(os.close, self.reader)
        self.addCleanup(os.close, self.writer)

    def test_real_pipe_snapshot_leaves_the_next_control_frame_intact(self):
        content, expected, payload = records()
        next_control = b'{"action":"shutdown"}\n'
        wire = b"".join(map(line, content)) + next_control
        self.assertEqual(os.write(self.writer, wire), len(wire))
        stream = channel.SnapshotInput(self.reader, bytearray(), time.monotonic() + 1)
        result = snapshot.receive_snapshot(stream, self.parent.name, expected)
        self.assertEqual(stream.incoming, next_control)
        self.assertEqual(stream.bytes_read, len(wire) - len(next_control))
        self.assertEqual((Path(result["directory"]) / ".compiler/MetaEditor64.exe").read_bytes(), payload)

    def test_cancel_record_from_real_pipe_removes_partial_staging(self):
        content, expected, _ = records()
        wire = b"".join(map(line, content[:4] + [{"type": "cancel"}]))
        self.assertEqual(os.write(self.writer, wire), len(wire))
        stream = channel.SnapshotInput(self.reader, bytearray(), time.monotonic() + 1)
        with self.assertRaisesRegex(snapshot.SnapshotError, "canceled"):
            snapshot.receive_snapshot(stream, self.parent.name, expected)
        self.assertEqual(list(Path(self.parent.name).iterdir()), [])

    def test_idle_live_pipe_hits_the_absolute_deadline(self):
        stream = channel.SnapshotInput(self.reader, bytearray(), time.monotonic() + 0.03)
        started = time.monotonic()
        with self.assertRaises(TimeoutError):
            stream.readline(channel.RECORD_BYTES + 1)
        self.assertLess(time.monotonic() - started, 1)


if __name__ == "__main__":
    unittest.main()
