"""The snapshot end must not consume the persistent channel's next request."""
import importlib.util
import json
from pathlib import Path
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("compiler_channel", Path(__file__).parents[1] / "packages/mt5/backend/resources/compiler-channel.py")
channel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(channel)


class CompilerChannelTests(unittest.TestCase):
    def stream(self, data):
        return channel.SnapshotInput(-1, bytearray(data), time.monotonic() + 5)

    def test_end_preserves_following_control_request(self):
        next_request = b'{"action":"shutdown"}\n'
        stream = self.stream(b'{"type":"file_end"}\n {"type":"end"} \n' + next_request)
        self.assertEqual(json.loads(stream.readline(channel.RECORD_BYTES + 1)), {"type": "file_end"})
        self.assertFalse(stream.ended)
        self.assertEqual(json.loads(stream.readline(channel.RECORD_BYTES + 1)), {"type": "end"})
        self.assertEqual(stream.read(1), b"")
        self.assertEqual(stream.readline(channel.RECORD_BYTES + 1), b"")
        self.assertEqual(stream.incoming, next_request)

    def test_oversize_record_cannot_become_logical_end(self):
        for tail in (b"", b"\n"):
            with self.subTest(tail=tail):
                stream = self.stream(b"x" * (channel.RECORD_BYTES + 2) + tail)
                self.assertEqual(len(stream.readline(channel.RECORD_BYTES + 1)), channel.RECORD_BYTES + 1)
                self.assertFalse(stream.ended)
                with self.assertRaisesRegex(ValueError, "only after"):
                    stream.read(1)

    def test_aggregate_wire_budget_is_independent_of_record_size(self):
        stream = self.stream(b'{"type":"end"}\n')
        stream.bytes_read = channel.WIRE_BYTES
        with self.assertRaisesRegex(ValueError, "encoded-byte"):
            stream.readline(channel.RECORD_BYTES + 1)

    def test_deadline_applies_to_buffered_bytes_and_eof(self):
        stream = self.stream(b'{"type":"end"}\n')
        stream.deadline = 0
        with self.assertRaises(TimeoutError):
            stream.readline(channel.RECORD_BYTES + 1)
        stream.ended = True
        with self.assertRaises(TimeoutError):
            stream.read(1)

    def test_disconnect_during_record_is_fatal(self):
        stream = self.stream(b'{"type":')
        with patch.object(channel.selectors, "DefaultSelector") as poll, patch.object(channel.os, "read", return_value=b""):
            poll.return_value.__enter__.return_value.select.return_value = [True]
            with self.assertRaises(EOFError):
                stream.readline(channel.RECORD_BYTES + 1)

    def test_partial_reads_keep_bytes_after_end(self):
        stream = self.stream(b"")
        with patch.object(channel.selectors, "DefaultSelector") as poll, patch.object(channel.os, "read", side_effect=[b'{"type":', b'"end"}\nnext\n']):
            poll.return_value.__enter__.return_value.select.return_value = [True]
            self.assertEqual(json.loads(stream.readline(channel.RECORD_BYTES + 1)), {"type": "end"})
        self.assertEqual(stream.incoming, b"next\n")


if __name__ == "__main__":
    unittest.main()
