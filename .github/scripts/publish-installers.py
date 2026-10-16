"""Copy verified binary artifacts to an existing draft without source credentials."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
import zipfile


def check(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def api(path):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True))


inputs = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())["inputs"]
tag, revision = inputs["tag"], inputs["source_revision"]
check(re.fullmatch(r"v\d+\.\d+\.\d+", tag), "Invalid release tag")
check(re.fullmatch(r"[0-9a-f]{40}", revision), "Invalid source revision")
repo = os.environ["GITHUB_REPOSITORY"]
release_id = inputs["release_id"]
check(re.fullmatch(r"\d+", release_id), "Invalid release ID")
release = api(f"repos/{repo}/releases/{release_id}")
check(release["tag_name"] == tag, "Release tag mismatch")
check(release["draft"], "This workflow only uploads to a draft release")
version = tag[1:]
inventory = []

with tempfile.TemporaryDirectory(prefix="sesame-publish-") as temporary:
    root = Path(temporary)
    for platform, suffixes in [("linux", ["linux-x64.AppImage", "linux-x64.deb"]), ("windows", ["win-x64.exe"])]:
        url, archive_hash = inputs[f"{platform}_url"], inputs[f"{platform}_sha256"]
        # The signed URLs grant short-lived access to these installers only.
        # Read inputs from the event file so URLs are not echoed by the shell.
        print(f"::add-mask::{url}", flush=True)
        parsed = urllib.parse.urlsplit(url)
        check(parsed.scheme == "https" and parsed.hostname.endswith(".blob.core.windows.net"), "Expected a GitHub artifact storage URL")
        check(re.fullmatch(r"[0-9a-f]{64}", archive_hash), "Invalid artifact digest")
        archive = root / f"{platform}.zip"
        with urllib.request.urlopen(url, timeout=120) as response, archive.open("wb") as stream:
            shutil.copyfileobj(response, stream)
        check(digest(archive) == archive_hash, "Artifact archive digest mismatch")
        names = {f"Sesame-{version}-{suffix}" for suffix in suffixes}
        with zipfile.ZipFile(archive) as bundle:
            check(set(bundle.namelist()) == names | {"verification.json"}, "Unexpected artifact contents")
            verification = json.loads(bundle.read("verification.json"))
            check(verification["version"] == version and verification["source_revision"] == revision, "Build provenance mismatch")
            check(verification["platform"] == ("win32" if platform == "windows" else "linux"), "Platform mismatch")
            expected = {item["name"]: item["sha256"] for item in verification["assets"]}
            check(set(expected) == names, "Verification inventory mismatch")
            for name in sorted(names):
                file = root / name
                with bundle.open(name) as source, file.open("wb") as destination:
                    shutil.copyfileobj(source, destination)
                check(digest(file) == expected[name], "Installer digest mismatch")
                item = {"name": name, "bytes": file.stat().st_size, "sha256": expected[name]}
                inventory.append(item)
                print("SESAME_ASSET " + json.dumps(item), flush=True)
        print("SESAME_PLATFORM " + json.dumps(verification), flush=True)

    existing = {asset["name"]: asset for asset in release["assets"]}
    for item in inventory:
        name = item["name"]
        if name in existing:
            check(existing[name]["digest"] == "sha256:" + item["sha256"] and existing[name]["size"] == item["bytes"], "Existing release asset differs")
        else:
            # A draft's tag does not exist yet; address its numeric release ID.
            url = f"https://uploads.github.com/repos/{repo}/releases/{release_id}/assets?" + urllib.parse.urlencode({"name": name})
            with (root / name).open("rb") as stream:
                request = urllib.request.Request(url, data=stream, method="POST", headers={
                    "Authorization": "Bearer " + os.environ["GH_TOKEN"],
                    "Content-Type": "application/octet-stream", "Content-Length": str(item["bytes"]),
                    "User-Agent": "Sesame-Release",
                })
                with urllib.request.urlopen(request, timeout=300) as response:
                    uploaded = json.load(response)
            check(uploaded["digest"] == "sha256:" + item["sha256"] and uploaded["size"] == item["bytes"], "Uploaded installer differs")

print("All verified installers uploaded to draft; publication remains a separate step.")
