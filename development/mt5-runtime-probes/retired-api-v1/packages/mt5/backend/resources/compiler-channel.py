"""Bound one compiler snapshot substream on a persistent guest control channel."""
import json
import os
import selectors
import time

RECORD_BYTES = 1024 * 1024
WIRE_BYTES = 768 * 1024 * 1024


class SnapshotInput:
    """The end record closes this view, preserving subsequent control bytes.

    Only the trusted dispatcher constructs this view. Snapshot validation still
    belongs to receive_snapshot; framing does not authenticate any file.
    """

    def __init__(self, descriptor, incoming, deadline):
        self.descriptor = descriptor
        self.incoming = incoming
        self.deadline = deadline
        self.bytes_read = 0
        self.ended = False

    def check_deadline(self):
        if time.monotonic() >= self.deadline:
            raise TimeoutError("Compiler snapshot exceeded the task deadline")

    def readline(self, limit):
        if limit != RECORD_BYTES + 1:
            raise ValueError("Unexpected compiler record read bound")
        self.check_deadline()
        if self.ended:
            return b""
        while b"\n" not in self.incoming and len(self.incoming) < limit:
            with selectors.DefaultSelector() as poller:
                poller.register(self.descriptor, selectors.EVENT_READ)
                if not poller.select(max(0, self.deadline - time.monotonic())):
                    raise TimeoutError("Compiler snapshot exceeded the task deadline")
            self.check_deadline()
            data = os.read(self.descriptor, min(65536, limit - len(self.incoming)))
            if not data:
                raise EOFError("Host disconnected during compiler snapshot")
            self.incoming.extend(data)
        self.check_deadline()
        newline = self.incoming.find(b"\n")
        count = min(limit, newline + 1 if newline >= 0 else len(self.incoming))
        record = bytes(self.incoming[:count])
        del self.incoming[:count]
        self.bytes_read += count
        if self.bytes_read > WIRE_BYTES:
            raise ValueError("Compiler snapshot exceeded the encoded-byte budget")
        # The receiver independently enforces exact fields, duplicate keys,
        # record order and digests. Invalid input is fatal to this guest task.
        if count <= RECORD_BYTES and record.endswith(b"\n"):
            self.ended = json.loads(record) == {"type": "end"}
        return record

    def read(self, size):
        self.check_deadline()
        if size != 1 or not self.ended:
            raise ValueError("Logical EOF is available only after the snapshot end")
        return b""
