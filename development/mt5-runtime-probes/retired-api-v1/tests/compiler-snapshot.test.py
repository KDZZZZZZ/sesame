"""Public receiver boundary tests; temporary files stay inside the workspace."""
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("compiler_snapshot", ROOT / "packages/mt5/backend/resources/compiler-snapshot.py")
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def line(value):
    return json.dumps(value, separators=(",", ":")).encode() + b"\n"


def envelope(manifest, payloads):
    raw = json.dumps(manifest, separators=(",", ":")).encode()
    records = [{"type": "begin", "version": 1, "manifest_bytes": len(raw), "manifest_sha256": sha(raw)}]
    for offset in range(0, len(raw), 256 * 1024):
        records.append({"type": "manifest_chunk", "offset": offset, "data": base64.b64encode(raw[offset:offset + 256 * 1024]).decode()})
    records.append({"type": "manifest_end"})
    for index, name in enumerate(sorted(payloads, key=lambda value: value.encode())):
        records.append({"type": "file", "index": index, "path": name})
        for offset in range(0, len(payloads[name]), 256 * 1024):
            records.append({"type": "chunk", "offset": offset, "data": base64.b64encode(payloads[name][offset:offset + 256 * 1024]).decode()})
        records.append({"type": "file_end"})
    records.append({"type": "end"})
    return records, sha(raw)


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        base = ROOT.parent.parent / ".test-output/compiler"
        base.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="compiler-snapshot-python-", dir=base)
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name)
        self.payloads = {".compiler/MetaEditor64.exe": b"MZ controlled compiler, never executed" * 10000,
                         "Include/asset.bin": bytes([0, 128, 255]), "engine.json": b"{}", "Include/empty": b""}
        self.manifest = {"compiler_sha256": sha(self.payloads[".compiler/MetaEditor64.exe"]),
                         "files": {name: {"bytes": len(data), "sha256": sha(data)} for name, data in self.payloads.items()}}

    def receive(self, records, expected, **kwargs):
        stream = records if hasattr(records, "readline") else io.BytesIO(b"".join(line(record) for record in records))
        return receiver.receive_snapshot(stream, self.parent, expected, **kwargs)

    def fails_cleanly(self, records, expected, **kwargs):
        with self.assertRaises((ValueError, OSError)):
            self.receive(records, expected, **kwargs)
        self.assertEqual(list(self.parent.iterdir()), [])

    def test_complete_snapshot_preserves_manifest_resources_and_private_directory(self):
        records, expected = envelope(self.manifest, self.payloads)
        result = self.receive(records, expected)
        directory = Path(result["directory"])
        self.assertEqual(result["file_count"], 4)
        self.assertEqual(result["total_bytes"], sum(map(len, self.payloads.values())))
        self.assertEqual(sha((directory / "manifest.json").read_bytes()), expected)
        for name, data in self.payloads.items():
            self.assertEqual((directory / name).read_bytes(), data)
        if os.name != "nt":
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)

    def test_truncation_corruption_wrong_order_duplicates_cancel_and_trailing_frames(self):
        original, expected = envelope(self.manifest, self.payloads)
        first_chunk = next(i for i, row in enumerate(original) if row["type"] == "chunk")
        for mutation in ("eof", "partial_line", "missing_chunk", "duplicate_chunk", "offset", "data", "file_order", "empty_chunk", "cancel", "trailing"):
            with self.subTest(mutation=mutation):
                records = json.loads(json.dumps(original))
                if mutation == "eof": records.pop()
                elif mutation == "partial_line":
                    self.fails_cleanly(io.BytesIO(b"".join(map(line, records))[:-1]), expected)
                    continue
                elif mutation == "missing_chunk": records.pop(first_chunk)
                elif mutation == "duplicate_chunk": records.insert(first_chunk, records[first_chunk].copy())
                elif mutation == "offset": records[first_chunk]["offset"] = 1
                elif mutation == "data":
                    data = bytearray(base64.b64decode(records[first_chunk]["data"])); data[0] ^= 1
                    records[first_chunk]["data"] = base64.b64encode(data).decode()
                elif mutation == "file_order": records[first_chunk - 1]["index"] = 1
                elif mutation == "empty_chunk": records[first_chunk]["data"] = ""
                elif mutation == "cancel": records[first_chunk] = {"type": "cancel"}
                elif mutation == "trailing": records.append({"type": "end"})
                self.fails_cleanly(records, expected)

    def test_manifest_limits_and_path_aliases_are_checked_before_staging(self):
        for mutation in ("file_size", "total_size", "file_count", "negative", "bool", "digest", "traversal", "case_alias", "directory_alias", "reserved", "manifest_alias"):
            with self.subTest(mutation=mutation):
                manifest = json.loads(json.dumps(self.manifest))
                editor = manifest["files"][".compiler/MetaEditor64.exe"]
                if mutation == "file_size": editor["bytes"] = 256 * 1024 * 1024 + 1
                elif mutation == "total_size":
                    editor["bytes"] = 256 * 1024 * 1024
                    manifest["files"]["huge"] = {"bytes": 256 * 1024 * 1024, "sha256": "sha256:" + "0" * 64}
                elif mutation == "file_count":
                    manifest["files"].update({f"file{i}": {"bytes": 0, "sha256": sha(b"")} for i in range(10000)})
                elif mutation == "negative": editor["bytes"] = -1
                elif mutation == "bool": editor["bytes"] = True
                elif mutation == "digest": editor["sha256"] = "sha256:" + "0" * 64
                else:
                    name = {"traversal": "../escape", "case_alias": "include/other", "directory_alias": "Include",
                            "reserved": "CON.txt", "manifest_alias": "Manifest.json"}[mutation]
                    manifest["files"][name] = {"bytes": 0, "sha256": sha(b"")}
                records, expected = envelope(manifest, {})
                self.fails_cleanly(records, expected)

    def test_oversized_records_manifest_claims_and_duplicate_json_keys_fail(self):
        records, expected = envelope(self.manifest, self.payloads)
        self.fails_cleanly(io.BytesIO(b" " * (1024 * 1024) + b"\n"), expected)
        records[0]["manifest_bytes"] = 8 * 1024 * 1024 + 1
        self.fails_cleanly(records[:1], expected)
        self.fails_cleanly(io.BytesIO(b'{"type":"begin","type":"begin"}\n'), expected)
        self.fails_cleanly(envelope(self.manifest, self.payloads)[0], "sha256:" + "0" * 64)
        for invalid in (expected.removeprefix("sha256:"), "sha512:" + "0" * 64, "sha256:" + "A" * 64):
            self.fails_cleanly(records, invalid)

    def test_abort_callback_and_short_write_never_return_or_leave_a_snapshot(self):
        records, expected = envelope(self.manifest, self.payloads)
        calls = 0

        def canceled():
            nonlocal calls
            calls += 1
            return calls > 11

        self.fails_cleanly(records, expected, canceled=canceled)
        real_write = os.write
        with patch.object(receiver.os, "write", side_effect=lambda fd, data: real_write(fd, data[:1])):
            self.fails_cleanly(records, expected)

    def test_changed_staged_file_is_not_published_even_when_wire_digest_was_correct(self):
        records, expected = envelope(self.manifest, self.payloads)
        parent = self.parent

        class ChangedFile(io.BytesIO):
            def readline(self, maximum=-1):
                raw = super().readline(maximum)
                if raw == line({"type": "end"}):
                    path = next(parent.iterdir()) / ".compiler/MetaEditor64.exe"
                    with path.open("r+b") as target:
                        target.write(b"XX")
                return raw

        self.fails_cleanly(ChangedFile(b"".join(map(line, records))), expected)

    def test_path_bytes_depth_and_total_nodes_at_and_above_protocol_boundaries(self):
        compiler = self.manifest["files"][".compiler/MetaEditor64.exe"]
        path1024 = "/".join(["d" * 200] * 5 + ["f" * 19])
        self.assertEqual(len(path1024.encode()), 1024)
        nodes = [f"{i}/a/b/" + ("c/" if i == 0 else "") + "file" for i in range(9999)]
        too_many = nodes.copy(); too_many[1] = "1/a/b/c/file"
        for names, accepted in (([path1024], True), ([path1024 + "x"], False), (["界" * 342], False),
                                (["/".join(["d"] * 64)], True), (["/".join(["d"] * 65)], False),
                                (nodes, True), (too_many, False)):
            with self.subTest(paths=len(names), accepted=accepted):
                manifest = {"compiler_sha256": compiler["sha256"], "files": {".compiler/MetaEditor64.exe": compiler}}
                manifest["files"].update({name: {"bytes": 0, "sha256": sha(b"")} for name in names})
                records, expected = envelope(manifest, {})
                # Accepted metadata reaches the file phase (no payload supplied);
                # a limit rejection must happen earlier. Neither publishes a path.
                with self.assertRaises(receiver.SnapshotError) as failure:
                    self.receive(records, expected)
                self.assertEqual(failure.exception.code, "compiler_snapshot_protocol" if accepted else "compiler_snapshot_limit")
                self.assertEqual(list(self.parent.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
