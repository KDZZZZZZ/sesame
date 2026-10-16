#!/usr/bin/env python3
"""Preflight the declared compiler overlay in an isolated copy of the P0 rootfs.

Uses the host Linux kernel and existing systemd/bwrap, not QEMU. This verifies
copied runtime completeness; VM performance/resource evidence is a separate run.
"""
import argparse
import gzip
import json
import os
from pathlib import Path
import shutil
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-initramfs", type=Path, required=True)
    parser.add_argument("--compiler-overlay", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        raise SystemExit("Use a new preflight output directory")
    output.mkdir(parents=True)
    root = output / "rootfs"
    root.mkdir()
    for archive in (args.base_initramfs, args.compiler_overlay):
        with (output / (archive.name + ".extract.log")).open("wb") as log:
            process = subprocess.Popen(["cpio", "-idmu", "--no-absolute-filenames", "--quiet"], cwd=root, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT)
            with gzip.open(archive, "rb") as compressed:
                shutil.copyfileobj(compressed, process.stdin)
            process.stdin.close()
            if process.wait() != 0:
                raise RuntimeError(f"Could not extract {archive}; see extraction log")
    results = []
    (root / "prefix").mkdir(exist_ok=True)
    for case in ("success", "error"):
        work = output / case
        work.mkdir()
        prefix = output / (case + "-prefix")
        prefix.mkdir(mode=0o700)
        unit = f"sesame-p0-compiler-{os.getpid()}-{case}.scope"
        command = ["systemd-run", "--user", "--scope", "--quiet", f"--unit={unit}", "-p", "MemoryMax=2G", "-p", "MemorySwapMax=0", "-p", "TasksMax=256", "-p", "CPUQuota=200%",
                   "bwrap", "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv", "--ro-bind", str(root), "/", "--proc", "/proc", "--dev", "/dev", "--size", "268435456", "--tmpfs", "/tmp", "--bind", str(work), "/work", "--bind", str(prefix), "/prefix", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "HOME", "/home/agent", "--setenv", "LANG", "C.UTF-8", "--setenv", "SESAME_COMPILER_P0", "1", "--chdir", "/work", "/usr/bin/python3", "/usr/share/sesame-compiler-p0/compile-guest.py", "--case", case]
        started = time.monotonic()
        with (output / f"{case}.log").open("wb") as log:
            try:
                process = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=120)
                entry = {"case": case, "exit_code": process.returncode, "wall_ms": round((time.monotonic() - started) * 1000, 3)}
            except subprocess.TimeoutExpired:
                entry = {"case": case, "exit_code": None, "timeout": True, "wall_ms": round((time.monotonic() - started) * 1000, 3)}
            finally:
                subprocess.run(["systemctl", "--user", "kill", "--kill-whom=all", "--signal=KILL", unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        result = work / "compile-result.json"
        entry["result"] = json.loads(result.read_text()) if result.exists() else None
        results.append(entry)
        (output / "results.json").write_text(json.dumps({"backend": "host Linux kernel with copied rootfs, not VM", "cases": results}, indent=2))
        print(json.dumps(entry), flush=True)
        if entry["exit_code"] != 0:
            raise SystemExit(entry["exit_code"] or 1)


if __name__ == "__main__":
    main()
