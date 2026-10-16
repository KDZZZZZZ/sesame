#!/usr/bin/env python3
"""Copy declared, already-installed compiler files into a P0-only cpio overlay.

No installer, account data, Wine prefix, or system configuration is modified.
The result contains proprietary MetaEditor and has NOT been cleared for release.
"""
import argparse
import collections
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


FIXTURE = """#property strict
#include <Trade/Trade.mqh>
CTrade compile_only_trade;
int OnInit() { return INIT_SUCCEEDED; }
void OnTick() {}
"""
PAYLOAD = "/usr/share/sesame-compiler-p0"


def digest(path):
    with Path(path).open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--wine-root", type=Path, default=Path("/opt/wine-staging"))
    parser.add_argument("--mt5-dir", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        raise SystemExit("Use a new output directory; compiler probes never overwrite artifacts")
    wine = args.wine_root.resolve(strict=True)
    if wine != Path("/opt/wine-staging"):
        raise SystemExit("This bounded experiment declares only /opt/wine-staging")
    mt5 = args.mt5_dir.resolve(strict=True)
    editor = mt5 / "MetaEditor64.exe"
    includes = (mt5 / "MQL5/Include").resolve(strict=True)
    output.mkdir(parents=True)
    root = output / "overlay"
    root.mkdir()
    sources, missing = {}, set()
    loader_env = {**os.environ, "LD_LIBRARY_PATH": str(wine / "lib/wine/x86_64-unix")}

    def copy(source, destination=None, category="system", libraries=True):
        source = Path(source)
        destination = str(destination or source)
        if destination in sources:
            return
        real = source.resolve(strict=True)
        if not real.is_file():
            raise ValueError(f"Not a declared regular file: {source}")
        allowed = any(real.is_relative_to(base) for base in (Path("/usr"), Path("/lib"), Path("/lib64"), wine))
        if not allowed and real != editor.resolve() and not real.is_relative_to(includes) and not real.is_relative_to(Path(__file__).resolve().parent):
            raise ValueError(f"Source outside the declared runtime/standard Include roots: {source}")
        target = root / destination.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(real, target)
        target.chmod(real.stat().st_mode & 0o777)
        sources[destination] = {"source": str(real), "bytes": target.stat().st_size, "sha256": digest(target), "category": category}
        with target.open("rb") as handle:
            elf = handle.read(4) == b"\x7fELF"
        if libraries and elf:
            result = subprocess.run(["ldd", str(real)], env=loader_env, capture_output=True, text=True, check=False)
            missing.update(re.findall(r"^\s*(\S+) => not found", result.stdout, re.M))
            for dependency in re.findall(r"(?:=>\s+|^\s*)(/\S+)", result.stdout, re.M):
                copy(dependency, libraries=False)

    # Runtime only: omit i386 and developer import libraries, headers and tools.
    for name in ("wine", "wineserver"):
        copy(wine / "bin" / name, category="wine-x64")
    for path in sorted((wine / "lib/wine/x86_64-unix").iterdir()):
        if path.is_file() and (path.suffix == ".so" or path.name in ("wine", "wine-preloader")):
            copy(path, category="wine-x64")
    for path in sorted((wine / "lib/wine/x86_64-windows").rglob("*")):
        if path.is_file():
            copy(path, category="wine-x64", libraries=False)
    for path in sorted((wine / "share/wine").rglob("*")):
        if path.is_file():
            copy(path, category="wine-data", libraries=False)
    for name in ("Xvfb", "xkbcomp"):
        copy(shutil.which(name), category="x11")
    for directory in ("/usr/share/X11/xkb", "/usr/share/X11/locale", "/usr/share/fontconfig/conf.avail"):
        for path in sorted(Path(directory).rglob("*")):
            if path.is_file():
                copy(path, category="x11-data", libraries=False)
    for path in sorted(Path("/etc/fonts").rglob("*")):
        if path.is_file():
            # fontconfig files/symlinks are public distro configuration only.
            destination = root / str(path).lstrip("/")
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)
            sources[str(path)] = {"source": str(path.resolve()), "bytes": destination.stat().st_size, "sha256": digest(destination), "category": "font-config"}
    for name in ("DejaVuSans.ttf", "DejaVuSansMono.ttf", "DejaVuSerif.ttf"):
        copy(Path("/usr/share/fonts/truetype/dejavu") / name, category="fonts", libraries=False)
    # Wine loads these by soname rather than recording every dependency in DT_NEEDED.
    libraries = ("libfreetype.so.6", "libfontconfig.so.1", "libXrender.so.1", "libXrandr.so.2", "libXcomposite.so.1", "libXcursor.so.1", "libXi.so.6", "libgnutls.so.30", "libGL.so.1", "libnss_files.so.2", "libnss_dns.so.2")
    cache = subprocess.check_output(["ldconfig", "-p"], text=True)
    for name in libraries:
        match = re.search(r"^\s*" + re.escape(name) + r" \(libc6,x86-64[^)]*\) => (\S+)", cache, re.M)
        if not match:
            raise ValueError(f"Required installed runtime library absent: {name}")
        copy(match.group(1))

    # Exactly the literal Include closure of the controlled fixture, never the
    # user's entire MQL5 tree. Every header must identify MetaQuotes copyright.
    pending, headers = ["Trade/Trade.mqh"], {}
    while pending:
        name = pending.pop()
        if name in headers:
            continue
        path = (includes / name).resolve(strict=True)
        if not path.is_relative_to(includes) or path.suffix.lower() != ".mqh":
            raise ValueError(f"Invalid standard Include path: {name}")
        raw = path.read_bytes()
        text = raw.decode("utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig")
        if "MetaQuotes" not in text[:2048] or "Copyright" not in text[:2048]:
            raise ValueError(f"Header not identified as a standard MetaQuotes file: {name}")
        headers[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        copy(path, f"{PAYLOAD}/Include/{name}", category="standard-include", libraries=False)
        for delimiter, value in re.findall(r'^\s*#include\s*([<"])([^>"]+)[>"]', text, re.M):
            value = value.replace("\\", "/")
            dependency = value if delimiter == "<" else str(Path(name).parent / value)
            pending.append(dependency)
    copy(editor, f"{PAYLOAD}/MetaEditor64.exe", category="metaeditor", libraries=False)
    copy(Path(__file__).with_name("compile-guest.py"), f"{PAYLOAD}/compile-guest.py", category="probe", libraries=False)
    payload = root / PAYLOAD.lstrip("/")
    (payload / "Fixture.mq5").write_text(FIXTURE)
    include_digest = hashlib.sha256(json.dumps(headers, sort_keys=True).encode()).hexdigest()
    frozen = {"purpose": "P0 compiler compatibility only; no redistribution approval", "compiler_sha256": digest(editor), "source_sha256": hashlib.sha256(FIXTURE.encode()).hexdigest(), "include_manifest_sha256": include_digest, "includes": headers, "wine_root": str(wine)}
    (payload / "frozen.json").write_text(json.dumps(frozen, indent=2))
    for package in ("wine-staging", "xvfb", "x11-xkb-utils", "fonts-dejavu-core", "fontconfig-config"):
        path = Path("/usr/share/doc") / package / "copyright"
        if path.exists():
            copy(path, f"{PAYLOAD}/licenses/{package}.copyright", category="license", libraries=False)
    categories = collections.defaultdict(lambda: {"files": 0, "bytes": 0})
    for item in sources.values():
        categories[item["category"]]["files"] += 1
        categories[item["category"]]["bytes"] += item["bytes"]
    manifest = {"purpose": "P0 feasibility only; installed binaries are not a licensed release payload", "wine_version": subprocess.check_output([str(wine / "bin/wine"), "--version"], text=True).strip(), "categories": dict(categories), "ldd_unresolved": sorted(missing), "frozen": frozen, "files": sources}
    (output / "sources.json").write_text(json.dumps(manifest, indent=2))
    names = ["."] + sorted(str(path.relative_to(root)) for path in root.rglob("*"))
    archive_path = output / "compiler-overlay.cpio.gz"
    listing = output / "cpio.names"
    listing.write_bytes(("\0".join(names) + "\0").encode())
    with (output / "cpio.stderr").open("wb") as errors, listing.open("rb") as entries:
        process = subprocess.Popen(["cpio", "--null", "-o", "--format=newc", "--owner=0:0"], cwd=root, stdin=entries, stdout=subprocess.PIPE, stderr=errors)
        with gzip.GzipFile(archive_path, "wb", mtime=0, compresslevel=6) as compressed:
            shutil.copyfileobj(process.stdout, compressed)
        if process.wait() != 0:
            raise RuntimeError("cpio failed; see cpio.stderr")
    print(json.dumps({"output": str(output), "archive_bytes": archive_path.stat().st_size, "archive_sha256": digest(archive_path), "categories": dict(categories), "ldd_unresolved": sorted(missing), "include_files": len(headers)}))


if __name__ == "__main__":
    main()
