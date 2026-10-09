#!/usr/bin/env python3
"""Receive one finite compiler snapshot substream. Never execute its contents."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import unicodedata

MANIFEST_BYTES = 8 * 1024 * 1024
FILE_COUNT = 10000
FILE_BYTES = 256 * 1024 * 1024
TOTAL_BYTES = 512 * 1024 * 1024
CHUNK_BYTES = 256 * 1024
RECORD_BYTES = 1024 * 1024
PATH_BYTES = 1024
DEPTH = 64
NODE_COUNT = 40000


class SnapshotError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = "compiler_snapshot_" + code


def require(condition, code, message):
    if not condition:
        raise SnapshotError(code, message)


def digest(value):
    return isinstance(value, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", value) is not None


def hashed(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "protocol", "Duplicate JSON key")
        result[key] = value
    return result


def parse(raw):
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)


def collision_key(name):
    return unicodedata.normalize("NFC", unicodedata.normalize("NFKC", name).upper().lower())


def files(manifest):
    require(isinstance(manifest, dict) and digest(manifest.get("compiler_sha256"))
            and isinstance(manifest.get("files"), dict), "manifest", "Invalid compiler manifest")
    entries = sorted(manifest["files"].items(), key=lambda item: item[0].encode("utf-8"))
    require(0 < len(entries) <= FILE_COUNT, "limit", "Compiler file count exceeds its bound")
    seen = {collision_key("manifest.json"): ("manifest.json", False)}
    total = 0
    for name, item in entries:
        require(name and not any(c in '\\:<>"|?*' or unicodedata.category(c) in ("Cc", "Cf", "Cs") for c in name),
                "path", "Unsafe compiler path")
        require(len(name.encode("utf-8")) <= PATH_BYTES, "limit", "Compiler path exceeds 1024 UTF8 bytes")
        parts = name.split("/")
        require(len(parts) <= DEPTH, "limit", "Compiler path exceeds 64 components")
        require(all(part and part not in (".", "..") and not part.endswith((".", " "))
                    and not re.fullmatch(r"con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]",
                                         part.split(".")[0].rstrip(), flags=re.I) for part in parts), "path", "Unsafe compiler path")
        for index in range(1, len(parts) + 1):
            current = "/".join(parts[:index])
            key, directory = collision_key(current), index < len(parts)
            prior = seen.get(key)
            require(prior is None or prior == (current, True) and directory, "path", "Aliased compiler paths")
            require(prior is not None or len(seen) < NODE_COUNT, "limit", "Compiler snapshot exceeds 40000 file/directory nodes")
            seen[key] = (current, directory)
        require(isinstance(item, dict) and type(item.get("bytes")) is int and 0 <= item["bytes"] <= FILE_BYTES
                and digest(item.get("sha256")), "limit", "Invalid compiler file size or digest")
        total += item["bytes"]
        require(total <= TOTAL_BYTES, "limit", "Compiler snapshot exceeds 512 MiB")
    compiler = manifest["files"].get(".compiler/MetaEditor64.exe")
    require(compiler and compiler["sha256"] == manifest["compiler_sha256"], "manifest", "Compiler identity is missing or inconsistent")
    return entries, total


def same_stat(a, b, *, cross_api=False):
    keys = ("st_dev", "st_ino", "st_nlink", "st_size", "st_mtime_ns")
    # On this Windows CPython, path stat infers .exe execute bits and returns
    # creation-time ctime; fd stat does not. Compare each API's full metadata
    # before/after, and mask only these cross-API differences. Linux is strict.
    if os.name == "nt" and cross_api:
        if a.st_mode & ~0o111 != b.st_mode & ~0o111:
            return False
    else:
        keys += ("st_mode", "st_ctime_ns")
    return all(getattr(a, name) == getattr(b, name) for name in keys)


def verify_stored(path, expected, cancellation):
    """Read back bounded chunks; the wire digest alone is not a stored-file check."""
    cancellation()
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == expected["bytes"]
            and path.resolve() == path, "integrity", "Stored compiler file identity changed")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0))
    try:
        opened = os.fstat(fd)
        require(same_stat(before, opened, cross_api=True), "integrity", "Stored compiler file changed while opening")
        checksum, count = hashlib.sha256(), 0
        while count < expected["bytes"]:
            cancellation()
            data = os.read(fd, min(CHUNK_BYTES, expected["bytes"] - count))
            require(data, "integrity", "Stored compiler file ended early")
            checksum.update(data)
            count += len(data)
        require(os.read(fd, 1) == b"" and "sha256:" + checksum.hexdigest() == expected["sha256"]
                and same_stat(opened, os.fstat(fd)) and same_stat(before, path.lstat()) and path.resolve() == path,
                "integrity", "Stored compiler file size, digest or identity changed")
    finally:
        os.close(fd)
    cancellation()


def write_chunk(fd, data):
    require(os.write(fd, data) == len(data), "io", "Short write to compiler snapshot")


def receive_snapshot(stream, parent, expected_manifest_sha256, *, canceled=lambda: False):
    """Logical EOF belongs to this substream, never to the persistent VM connection."""
    require(digest(expected_manifest_sha256), "manifest", "Expected manifest SHA256 is required")
    staging = None

    def cancellation():
        require(not canceled(), "canceled", "Compiler snapshot canceled")

    def record(kind, fields=()):
        cancellation()
        raw = stream.readline(RECORD_BYTES + 1)
        cancellation()
        require(raw and len(raw) <= RECORD_BYTES and raw.endswith(b"\n"), "protocol", "Truncated or oversized compiler record")
        value = parse(raw)
        require(isinstance(value, dict), "protocol", "Compiler record must be an object")
        require(value.get("type") != "cancel", "canceled", "Compiler snapshot canceled")
        require(value.get("type") == kind and set(value) == {"type", *fields}, "protocol", "Unexpected compiler record")
        return value

    def chunk(kind, offset, remaining):
        value = record(kind, ("offset", "data"))
        require(type(value["offset"]) is int and value["offset"] == offset and isinstance(value["data"], str),
                "protocol", "Wrong compiler chunk offset or encoding")
        data = base64.b64decode(value["data"], validate=True)
        require(len(data) == min(CHUNK_BYTES, remaining) and base64.b64encode(data).decode() == value["data"],
                "protocol", "Compiler chunk has the wrong length or encoding")
        return data

    try:
        begin = record("begin", ("version", "manifest_bytes", "manifest_sha256"))
        require(type(begin["version"]) is int and begin["version"] == 1
                and begin["manifest_sha256"] == expected_manifest_sha256, "integrity", "Compiler manifest identity mismatch")
        size = begin["manifest_bytes"]
        require(type(size) is int and 0 < size <= MANIFEST_BYTES, "limit", "Compiler manifest exceeds 8 MiB")
        raw = bytearray()
        while len(raw) < size:
            raw.extend(chunk("manifest_chunk", len(raw), size - len(raw)))
        record("manifest_end")
        require(hashed(raw) == expected_manifest_sha256, "integrity", "Compiler manifest digest mismatch")
        entries, total = files(parse(raw))
        cancellation()
        parent = Path(parent).absolute()
        require(parent.is_dir() and not parent.is_symlink() and parent.resolve() == parent,
                "path", "Snapshot parent must be an existing physical directory without aliases")
        staging = Path(tempfile.mkdtemp(prefix="compiler-snapshot-", dir=parent))
        for index, (name, item) in enumerate(entries):
            value = record("file", ("index", "path"))
            require(type(value["index"]) is int and value["index"] == index and value["path"] == name,
                    "protocol", "Compiler files are out of order")
            target = staging / name
            cancellation()
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            require(target.parent.resolve() == target.parent, "path", "Snapshot directory contains an alias")
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0), 0o600)
            try:
                offset, checksum = 0, hashlib.sha256()
                while offset < item["bytes"]:
                    data = chunk("chunk", offset, item["bytes"] - offset)
                    write_chunk(fd, data)
                    checksum.update(data)
                    offset += len(data)
                record("file_end")
                require("sha256:" + checksum.hexdigest() == item["sha256"] and os.fstat(fd).st_size == item["bytes"],
                        "integrity", "Compiler file size or digest mismatch")
            finally:
                os.close(fd)
        record("end")
        cancellation()
        require(stream.read(1) == b"", "protocol", "Records follow compiler snapshot end")
        cancellation()
        manifest_path = staging / "manifest.json"
        fd = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0), 0o600)
        try:
            for offset in range(0, len(raw), CHUNK_BYTES):
                cancellation()
                write_chunk(fd, memoryview(raw)[offset:offset + CHUNK_BYTES])
        finally:
            os.close(fd)
        for name, item in entries:
            verify_stored(staging / name, item, cancellation)
        verify_stored(manifest_path, {"bytes": len(raw), "sha256": expected_manifest_sha256}, cancellation)
        result = {"directory": str(staging), "manifest_sha256": expected_manifest_sha256,
                  "file_count": len(entries), "total_bytes": total}
        staging = None
        return result
    finally:
        if staging is not None:
            shutil.rmtree(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parent", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args()
    try:
        result = receive_snapshot(sys.stdin.buffer, args.parent, args.manifest_sha256)
    except Exception as error:
        print(json.dumps({"error": getattr(error, "code", "compiler_snapshot_io"), "message": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
