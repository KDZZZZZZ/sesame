#!/usr/bin/env python3
"""Controlled MetaEditor fixture; run in a disposable /work sandbox only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

PAYLOAD = Path("/usr/share/sesame-compiler-p0")
BUDGET_SECONDS = {"standard": 120, "macos": 300}


def sha(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("success", "error"), default="success")
    parser.add_argument("--budget", choices=tuple(BUDGET_SECONDS), default="standard")
    parser.add_argument("--timeout", type=int)
    args = parser.parse_args(argv)
    maximum = BUDGET_SECONDS[args.budget] - 5
    if args.timeout is None:
        args.timeout = maximum
    if not 0 < args.timeout <= maximum:
        parser.error(f"--timeout must be between 1 and {maximum} for {args.budget}")
    return args


def main():
    args = parse_args()
    if Path.cwd() != Path("/work") or os.environ.get("SESAME_COMPILER_P0") != "1":
        raise SystemExit("Use the isolated P0 compiler profile with logical cwd /work")
    prefix = Path("/prefix")
    if not prefix.is_dir() or any(prefix.iterdir()):
        raise SystemExit("Bind an empty, task-private writable directory at /prefix")
    frozen = json.loads((PAYLOAD / "frozen.json").read_text())
    editor = PAYLOAD / "MetaEditor64.exe"
    if sha(editor) != frozen["compiler_sha256"] or sha(PAYLOAD / "Fixture.mq5") != frozen["source_sha256"]:
        raise RuntimeError("Frozen compiler/source digest mismatch")
    for name, expected in frozen["includes"].items():
        if sha(PAYLOAD / "Include" / name) != expected["sha256"]:
            raise RuntimeError(f"Frozen Include digest mismatch: {name}")
    source = (PAYLOAD / "Fixture.mq5").read_text()
    if args.case == "error":
        source = source.replace("return INIT_SUCCEEDED;", "return missing_compile_token;")
    Path("/work/Fixture.mq5").write_text(source)
    started = time.monotonic()
    wine = Path(frozen["wine_root"])
    result = {"case": args.case, "compiler_budget": args.budget, "timeout_seconds": args.timeout, "request_timeout_seconds": BUDGET_SECONDS[args.budget], "compiler_sha256": frozen["compiler_sha256"], "source_sha256": hashlib.sha256(source.encode()).hexdigest(), "include_manifest_sha256": frozen["include_manifest_sha256"], "success": False}
    with tempfile.TemporaryDirectory(prefix="sesame-compiler-", dir="/tmp") as temporary:
        private = Path(temporary)
        env = {"PATH": "/usr/bin:/bin", "HOME": "/home/agent", "LANG": "C.UTF-8", "DISPLAY": ":99", "WINEPREFIX": str(prefix), "WINEARCH": "win64", "WINEDEBUG": "-all", "WINEDLLOVERRIDES": "mscoree,mshtml=", "LIBGL_ALWAYS_SOFTWARE": "1", "XDG_CACHE_HOME": str(private / "cache")}
        xlog = Path("/work/xvfb.log").open("wb")
        display = subprocess.Popen(["/usr/bin/Xvfb", ":99", "-screen", "0", "1024x768x24", "-nolisten", "tcp", "-noreset", "-ac", "-fp", "built-ins"], env=env, stdout=xlog, stderr=subprocess.STDOUT)
        try:
            for _ in range(200):
                if display.poll() is not None:
                    raise RuntimeError("Xvfb exited: " + Path("/work/xvfb.log").read_text(errors="replace")[-4000:])
                if Path("/tmp/.X11-unix/X99").exists():
                    break
                time.sleep(0.05)
            else:
                raise RuntimeError("Xvfb did not become ready")
            with Path("/work/wine.log").open("wb") as log:
                process = subprocess.run([str(wine / "bin/wine"), str(editor), "/compile:Z:\\work\\Fixture.mq5", "/include:Z:\\usr\\share\\sesame-compiler-p0", "/log"], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, timeout=args.timeout)
            result["exit_code"] = process.returncode
            diagnostic_path = Path("/work/Fixture.log")
            diagnostics = diagnostic_path.read_text(encoding="utf-16", errors="replace") if diagnostic_path.exists() else ""
            result["diagnostics"] = diagnostics[-12000:]
            artifact = Path("/work/Fixture.ex5")
            result["success"] = bool(re.search(r"Result: 0 errors, \d+ warnings", diagnostics) and artifact.exists())
            result["ex5_sha256"] = sha(artifact) if result["success"] else None
            result["expected_observed"] = result["success"] if args.case == "success" else bool("missing_compile_token" in diagnostics and not result["success"] and not artifact.exists())
            if not diagnostics:
                result["wine_log_excerpt"] = Path("/work/wine.log").read_text(errors="replace")[-8000:]
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            result["error"] = str(error)
            result["expected_observed"] = False
        finally:
            # Prefix-specific wineserver commands never address the user's prefix.
            try:
                subprocess.run([str(wine / "bin/wineserver"), "-k"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2, check=False)
            except subprocess.TimeoutExpired:
                result["cleanup_timeout"] = True
            display.terminate()
            try:
                display.wait(timeout=2)
            except subprocess.TimeoutExpired:
                display.kill()
                display.wait(timeout=2)
            xlog.close()
            result["prefix_bytes"] = sum(path.stat().st_size for path in prefix.rglob("*") if path.is_file() and not path.is_symlink())
    result["elapsed_ms"] = round((time.monotonic() - started) * 1000, 3)
    Path("/work/compile-result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result))
    return 0 if result["expected_observed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
