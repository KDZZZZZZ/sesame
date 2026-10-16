#!/usr/bin/env python3
"""Compile a verified snapshot inside the fixed Sesame guest sandbox only."""
import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

MANIFEST_BYTES = 8 * 1024 * 1024
RESULT_BYTES = 8 * 1024 * 1024
ARTIFACT_BYTES = 32 * 1024 * 1024
# Even ASCII diagnostics use two UTF-16 bytes per character. The final UTF-8
# JSON bound is checked separately, without dropping any diagnostic lines.
LOG_BYTES = 2 * RESULT_BYTES + 2
CHUNK_BYTES = 256 * 1024
BUDGET_SECONDS = {"standard": 115, "macos": 295}
GUEST_SCRIPT = Path("/usr/share/sesame-runtime/compiler_entry.py")
COMMAND = ["/opt/wine-staging/bin/wine", "/terminal/MetaEditor64.exe",
           "/compile:Z:\\build\\Experts\\Strategy.mq5", "/include:Z:\\build", "/log"]


class CompilerEntryError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = "compiler_entry_" + code


def require(condition, code, message):
    if not condition:
        raise CompilerEntryError(code, message)


def is_digest(value):
    return isinstance(value, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", value) is not None


def check_deadline(deadline):
    require(time.monotonic() < deadline, "timeout", "Compiler internal deadline expired")


@dataclass(frozen=True)
class Layout:
    build: Path
    editor: Path
    prefix: Path
    work: Path
    temporary: Path


GUEST_LAYOUT = Layout(Path("/build"), Path("/terminal/MetaEditor64.exe"),
                      Path("/prefix"), Path("/work"), Path("/tmp"))


def physical_directory(path, *, empty=False):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and path.resolve(strict=True) == path,
            "path", "Compiler directory must be physical and canonical")
    require(not empty or not any(path.iterdir()), "path", "Compiler task directory must be empty")


def readonly_inputs(layout):
    """Check the actual mounts, not mode bits or a supplied configuration flag."""
    for path in (layout.build / "Include", layout.build / ".compiler",
                 layout.build / "manifest.json", layout.editor):
        require(os.statvfs(path).f_flag & os.ST_RDONLY, "mount", "Compiler frozen input is not mounted read-only")


def guest_preflight():
    require(sys.platform == "linux" and Path(__file__).resolve() == GUEST_SCRIPT
            and Path.cwd() == Path("/work") and os.environ.get("SESAME_COMPILER_GUEST") == "1",
            "environment", "Compiler entry requires the fixed guest sandbox")
    for path in (GUEST_LAYOUT.build, GUEST_LAYOUT.build / "Experts",
                 GUEST_LAYOUT.build / "Include", GUEST_LAYOUT.build / ".compiler",
                 Path("/terminal"), GUEST_LAYOUT.temporary):
        physical_directory(path)
    physical_directory(GUEST_LAYOUT.prefix, empty=True)
    physical_directory(GUEST_LAYOUT.work, empty=True)
    readonly_inputs(GUEST_LAYOUT)


def file_identity(info):
    # Windows path/fd stat disagree on inferred .exe mode and birth/change time.
    # These stable fields are also checked after every read on both platforms.
    return (info.st_dev, info.st_ino, info.st_nlink, info.st_size, info.st_mtime_ns)


@contextmanager
def regular_file(path, maximum):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum
            and path.resolve(strict=True) == path, "path", "Compiler file is not a bounded regular file")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    with os.fdopen(os.open(path, flags), "rb") as handle:
        require(file_identity(before) == file_identity(os.fstat(handle.fileno())),
                "path", "Compiler file changed while opening")
        yield handle, before.st_size
        require(file_identity(before) == file_identity(os.fstat(handle.fileno()))
                == file_identity(path.lstat()), "path", "Compiler file changed while reading")


def read_bounded(path, maximum, deadline):
    with regular_file(path, maximum) as (handle, size):
        parts, count = [], 0
        while True:
            check_deadline(deadline)
            chunk = handle.read(min(CHUNK_BYTES, maximum + 1 - count))
            if not chunk:
                break
            count += len(chunk)
            require(count <= maximum, "limit", "Compiler file exceeds its byte bound")
            parts.append(chunk)
        require(count == size, "path", "Compiler file length changed")
    return b"".join(parts)


def hash_file(path, maximum, deadline):
    digest, count = hashlib.sha256(), 0
    with regular_file(path, maximum) as (handle, size):
        while True:
            check_deadline(deadline)
            chunk = handle.read(CHUNK_BYTES)
            if not chunk:
                break
            count += len(chunk)
            require(count <= maximum, "limit", "Compiler file exceeds its byte bound")
            digest.update(chunk)
        require(count == size, "path", "Compiler file length changed")
    return "sha256:" + digest.hexdigest(), count


def verify_input(layout, expected_manifest_sha256, deadline):
    require(is_digest(expected_manifest_sha256), "manifest", "Expected manifest digest is invalid")
    for path in (layout.build, layout.build / "Experts", layout.build / "Include",
                 layout.build / ".compiler", layout.editor.parent, layout.temporary):
        physical_directory(path)
    physical_directory(layout.prefix, empty=True)
    physical_directory(layout.work, empty=True)
    raw = read_bounded(layout.build / "manifest.json", MANIFEST_BYTES, deadline)
    require("sha256:" + hashlib.sha256(raw).hexdigest() == expected_manifest_sha256,
            "manifest", "Compiler manifest does not match its separately supplied digest")
    try:
        manifest = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError) as error:
        raise CompilerEntryError("manifest", "Compiler manifest is not UTF-8 JSON") from error
    require(isinstance(manifest, dict) and isinstance(manifest.get("files"), dict)
            and is_digest(manifest.get("compiler_sha256")), "manifest", "Invalid compiler manifest")
    # The trusted receiver already verified every resource. Recheck the exact
    # entry point and both compiler paths before invoking the fixed command.
    for name in (".compiler/MetaEditor64.exe", "Experts/Strategy.mq5"):
        expected = manifest["files"].get(name)
        require(isinstance(expected, dict) and type(expected.get("bytes")) is int
                and is_digest(expected.get("sha256")), "manifest", "Required compiler input is missing")
        actual, count = hash_file(layout.build / name, 256 * 1024 * 1024, deadline)
        require(count == expected["bytes"] and actual == expected["sha256"],
                "manifest", "Required compiler input digest or size does not match")
    require(manifest["files"][".compiler/MetaEditor64.exe"]["sha256"] == manifest["compiler_sha256"],
            "manifest", "Compiler manifest identity is inconsistent")
    # A bind mount of the verified compiler has the same identity. Avoid a
    # second 115 MiB read in that usual case; a separate copy is still hashed.
    with regular_file(layout.editor, 256 * 1024 * 1024) as (mounted, _):
        same_compiler = file_identity(os.fstat(mounted.fileno())) == file_identity(
            (layout.build / ".compiler/MetaEditor64.exe").lstat())
    require(same_compiler or hash_file(layout.editor, 256 * 1024 * 1024, deadline)[0] == manifest["compiler_sha256"],
            "manifest", "Mounted MetaEditor digest does not match")
    for suffix in ("log", "ex5"):
        require(not os.path.lexists(layout.build / ("Experts/Strategy." + suffix)),
                "path", "Compiler output already exists in the fresh snapshot")


def decode_diagnostics(raw):
    require(len(raw) <= LOG_BYTES, "limit", "Compiler UTF-16 log exceeds the result capacity")
    try:
        diagnostics = raw.decode("utf-16-le")
    except UnicodeError as error:
        raise CompilerEntryError("diagnostics", "Compiler log is not valid UTF-16LE") from error
    return diagnostics[1:] if diagnostics.startswith("\ufeff") else diagnostics


def make_result(diagnostics, artifact_digest=None, artifact_bytes=0):
    require(isinstance(diagnostics, str), "diagnostics", "Compiler diagnostics must be text")
    require((artifact_digest is None and artifact_bytes == 0)
            or is_digest(artifact_digest) and type(artifact_bytes) is int and 0 < artifact_bytes <= ARTIFACT_BYTES,
            "artifact", "Compiler artifact is empty, oversized or has an invalid digest")
    success = bool(re.search(r"Result: 0 errors, [0-9]+ warnings", diagnostics) and artifact_digest)
    return {"success": success, "diagnostics": diagnostics, "ex5_sha256": artifact_digest if success else None}


def encode_result(result):
    raw = (json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    require(len(raw) <= RESULT_BYTES, "limit", "Complete compiler diagnostics exceed the 8 MiB result limit")
    return raw


class GuestRunner:
    """The only process-running adapter; impossible to select by a host fixture."""
    def __init__(self):
        guest_preflight()
        self.display = None
        self.wine_started = False

    def start(self, env, deadline):
        check_deadline(deadline)
        socket = Path("/tmp/.X11-unix/X99")
        require(not os.path.lexists(socket), "display", "Compiler display socket already exists")
        # Inherit both output pipes so the outer supervisor's 1 MiB limit also
        # covers Xvfb and Wine. No unbounded diagnostic files are redirected.
        self.display = subprocess.Popen(["/usr/bin/Xvfb", ":99", "-screen", "0", "1024x768x24",
                                         "-nolisten", "tcp", "-noreset", "-ac", "-fp", "built-ins"],
                                        env=env, stdin=subprocess.DEVNULL)
        ready_deadline = min(deadline, time.monotonic() + 10)
        while True:
            require(self.display.poll() is None, "display", "Xvfb exited before becoming ready")
            check_deadline(ready_deadline)
            if socket.exists():
                require(stat.S_ISSOCK(socket.lstat().st_mode), "display", "Compiler display path is not a socket")
                return
            time.sleep(min(0.05, max(0, ready_deadline - time.monotonic())))

    def run(self, command, env, deadline):
        check_deadline(deadline)
        self.wine_started = True
        return subprocess.run(command, env=env, cwd="/build", stdin=subprocess.DEVNULL,
                              timeout=max(0.001, deadline - time.monotonic()), check=False).returncode

    def close(self, env):
        failed = False
        try:
            if self.wine_started:
                try:
                    subprocess.run(["/opt/wine-staging/bin/wineserver", "-k"], env=env,
                                   stdin=subprocess.DEVNULL, timeout=2, check=False)
                except (OSError, subprocess.TimeoutExpired):
                    failed = True
        finally:
            if self.display is not None:
                try:
                    if self.display.poll() is None:
                        self.display.terminate()
                    self.display.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    self.display.kill()
                    try:
                        self.display.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        failed = True
                except OSError:
                    failed = True
        require(not failed, "cleanup", "Private compiler process cleanup did not complete")


def compile_snapshot(layout, expected_manifest_sha256, *, timeout=115, budget="standard", runner):
    require(budget in BUDGET_SECONDS and isinstance(timeout, (int, float)) and math.isfinite(timeout)
            and 0 < timeout <= BUDGET_SECONDS[budget], "timeout", "Invalid compiler internal timeout")
    deadline = time.monotonic() + timeout
    env = {"PATH": "/usr/bin:/bin", "HOME": "/home/agent", "LANG": "C.UTF-8", "DISPLAY": ":99",
           "WINEPREFIX": str(layout.prefix), "WINEARCH": "win64", "WINEDEBUG": "-all",
           "WINEDLLOVERRIDES": "mscoree,mshtml=", "LIBGL_ALWAYS_SOFTWARE": "1",
           "XDG_CACHE_HOME": str(layout.temporary / "compiler-cache")}
    created, complete = [], False
    try:
        verify_input(layout, expected_manifest_sha256, deadline)
        try:
            runner.start(env, deadline)
            runner.run(list(COMMAND), env, deadline)
        finally:
            runner.close(env)
        check_deadline(deadline)
        diagnostics = decode_diagnostics(read_bounded(layout.build / "Experts/Strategy.log", LOG_BYTES, deadline))
        artifact = layout.build / "Experts/Strategy.ex5"
        artifact_digest, artifact_bytes = (hash_file(artifact, ARTIFACT_BYTES, deadline)
                                           if os.path.lexists(artifact) else (None, 0))
        result = make_result(diagnostics, artifact_digest, artifact_bytes)
        encoded = encode_result(result)
        physical_directory(layout.work, empty=True)
        if result["success"]:
            target = layout.work / "Strategy.ex5"
            copied = hashlib.sha256()
            with regular_file(artifact, ARTIFACT_BYTES) as (source, size), target.open("xb") as output:
                created.append(target)
                count = 0
                while True:
                    check_deadline(deadline)
                    chunk = source.read(CHUNK_BYTES)
                    if not chunk:
                        break
                    count += len(chunk)
                    require(count <= ARTIFACT_BYTES, "limit", "Compiler artifact exceeds 32 MiB")
                    require(output.write(chunk) == len(chunk), "io", "Short compiler artifact write")
                    copied.update(chunk)
                require(count == size == artifact_bytes and "sha256:" + copied.hexdigest() == artifact_digest,
                        "artifact", "Compiler artifact changed during export")
        check_deadline(deadline)
        target = layout.work / "compile-result.json"
        with target.open("xb") as output:
            created.append(target)
            require(output.write(encoded) == len(encoded), "io", "Short compiler result write")
        check_deadline(deadline)
        complete = True
        return result
    except (OSError, subprocess.TimeoutExpired) as error:
        raise CompilerEntryError("timeout" if isinstance(error, subprocess.TimeoutExpired) else "io",
                                 "Compiler timed out" if isinstance(error, subprocess.TimeoutExpired)
                                 else "Compiler input or output file operation failed") from error
    finally:
        # The supervisor's compiler branch exports only after entry exit 0 and
        # cgroup cleanup. Never leave our partial result or EX5 on failure.
        if not complete:
            for path in reversed(created):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--budget", choices=tuple(BUDGET_SECONDS), default="standard")
    parser.add_argument("--timeout", type=float)
    args = parser.parse_args(argv)
    if not is_digest(args.manifest_sha256):
        parser.error("--manifest-sha256 requires sha256:<64 lowercase hex>")
    maximum = BUDGET_SECONDS[args.budget]
    if args.timeout is None:
        args.timeout = maximum
    if not math.isfinite(args.timeout) or not 0 < args.timeout <= maximum:
        parser.error(f"--timeout must be finite, positive and at most {maximum} seconds")
    return args


def main(argv=None):
    args = parse_args(argv)
    try:
        runner = GuestRunner()
        compile_snapshot(GUEST_LAYOUT, args.manifest_sha256, timeout=args.timeout, budget=args.budget, runner=runner)
        return 0
    except (CompilerEntryError, OSError) as error:
        # Fixed bounded message; full diagnostics travel in the result file.
        print(json.dumps({"error": getattr(error, "code", "compiler_entry_io"),
                          "message": str(error)[:512]}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
