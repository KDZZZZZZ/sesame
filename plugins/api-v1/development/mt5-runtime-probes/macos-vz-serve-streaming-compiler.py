#!/usr/bin/env python3
"""Four fixed P0 files, one existing authorized tailnet peer, then exit."""
from contextlib import ExitStack
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import time

ROOT = Path('/tmp/sesame-zero-setup-20261007.tElMxa')
FILES = (
    ('vmlinuz', 'guest-v16-streaming-compiler-v1/vmlinuz', 17000840,
     '5cd6898e71f247e0dd820bcbae669a5b5d35bd736cbe3c2e6834ff2381525e5d'),
    ('initramfs.cpio.gz', 'guest-v16-streaming-compiler-v1/initramfs.cpio.gz', 1174301,
     '0b02ccbe93d8dc6eda5aed6c5133312ecfae7a51053938b00a797e679159abdc'),
    ('runtime.squashfs', 'guest-v16-streaming-compiler-v1/runtime.squashfs', 437280768,
     'b822f45ff0cac1e9b26e218cdbd3677d8793fe261214d335a9cfb2f736e38882'),
    ('fixture.tar.gz', 'streaming-compiler-fixture-v1.tar.gz', 48158903,
     '8b94a81b300c16bb38034bea67c7f83aa54e469f1f021540c3b9175bb1329ac9'),
)


def main():
    assert sys.platform == 'linux' and ROOT.resolve(strict=True) == ROOT
    source = ROOT / 'serve-fixtures.py'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == '1266821fb980046903da28edd8ba1865fb5f14469d3b0dceae5c3bfe74674915'
    spec = importlib.util.spec_from_file_location('fixed_fixture_transfer', source)
    transfer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(transfer)
    assert transfer.TASK_ROOT == ROOT and transfer.BIND_ADDRESS == '100.77.91.52'
    assert transfer.ALLOWED_PEER == '100.71.228.23'
    assert shutil.disk_usage(ROOT).free >= sum(row[2] for row in FILES) + 1024**3
    deadline = time.monotonic() + transfer.LIFETIME_SECONDS
    with ExitStack() as stack:
        fixtures = {}
        for name, relative, size, digest in FILES:
            fixture = transfer.freeze_input(ROOT / relative, size, digest, ROOT, deadline)
            stack.callback(fixture.close)
            fixtures['/' + name] = fixture
        with transfer.FixtureServer((transfer.BIND_ADDRESS, 0), transfer.FixtureHandler) as server:
            server.fixtures, server.completed, server.deadline = fixtures, set(), deadline
            print(json.dumps(dict(event='fixture-server-ready', bind=server.server_address,
                                  allowed_peer=transfer.ALLOWED_PEER, lifetime_seconds=transfer.LIFETIME_SECONDS,
                                  files=[dict(path='/' + name, bytes=size, sha256=digest)
                                         for name, _, size, digest in FILES])), flush=True)
            while len(server.completed) < len(fixtures) and time.monotonic() < deadline:
                server.timeout = min(1, deadline - time.monotonic())
                server.handle_request()
            complete = len(server.completed) == len(fixtures)
            print(json.dumps(dict(event='fixture-server-exit', reason='complete' if complete else 'deadline',
                                  completed=sorted(server.completed))), flush=True)
            return 0 if complete else 1


if __name__ == '__main__':
    raise SystemExit(main())
