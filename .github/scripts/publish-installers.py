"""Copy verified binary artifacts to an existing draft without source credentials."""
import hashlib
import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

TARGETS = {
    "linux": ("linux", "x64", ["linux-x64.AppImage", "linux-x64.deb"]),
    "windows": ("win32", "x64", ["win-x64.exe"]),
    "macos": ("darwin", "arm64", ["mac-arm64.dmg"]),
}
REQUIRED_CHECKS = {"installer extraction", "native host package without VM bundle", "packaged server import", "desktop update configuration"}


def artifact_names(version, platform):
    native, arch, suffixes = TARGETS[platform]
    installers = {f"Sesame-{version}-{suffix}" for suffix in suffixes}
    if native == "darwin":
        return installers
    blockmaps = {f"{name}.blockmap" for name in installers if name.endswith((".exe", ".deb"))}
    return installers | blockmaps | {f"update-feed-{native}-{arch}.yml", f"update-plan-{native}-{arch}.json"}


def check(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(block)
    return base64.b64encode(h.digest()).decode("ascii") if algorithm == "sha512" else h.hexdigest()


def api(path):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True))


def matches(pattern, value):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def check_artifact_url(url):
    check(isinstance(url, str) and not re.search(r"\s", url), "Expected a GitHub artifact storage URL")
    try:
        parsed = urllib.parse.urlsplit(url)
        valid = (parsed.scheme == "https" and (parsed.hostname or "").endswith(".blob.core.windows.net")
                 and parsed.username is None and parsed.password is None and parsed.port in (None, 443))
    except ValueError:
        valid = False
    check(valid, "Expected a GitHub artifact storage URL")


def validate_inputs(inputs):
    check(matches(r"v\d+\.\d+\.\d+", inputs.get("tag")), "Invalid release tag")
    check(matches(r"[0-9a-f]{40}", inputs.get("source_revision")), "Invalid source revision")
    check(matches(r"\d+", inputs.get("release_id")), "Invalid release ID")
    check(matches(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", inputs.get("plugins_repository")), "Invalid plugin repository")
    check(matches(r"[0-9a-f]{40}", inputs.get("plugins_commit")), "Invalid plugin source commit")
    check(matches(r"[0-9a-f]{64}", inputs.get("plugin_lock_sha256")), "Invalid reviewed plugin source lock digest")
    for platform in TARGETS:
        check_artifact_url(inputs.get(f"{platform}_url"))
        check(matches(r"[0-9a-f]{64}", inputs.get(f"{platform}_sha256")), "Invalid artifact digest")


def require_draft(repo, release_id, tag):
    release = api(f"repos/{repo}/releases/{release_id}")
    check(release.get("tag_name") == tag, "Release tag mismatch")
    check(release.get("draft") is True, "This workflow only uploads to a draft release")
    return release


def download_artifact(url, archive):
    try:
        with urllib.request.urlopen(url, timeout=120) as response, archive.open("wb") as stream:
            check_artifact_url(response.geturl())
            shutil.copyfileobj(response, stream)
    except (urllib.error.URLError, OSError):
        # urllib exceptions may include the signed URL. Keep it out of errors.
        raise ValueError("Artifact download failed") from None


def extract_artifact(archive, root, inputs, platform):
    check(digest(archive) == inputs[f"{platform}_sha256"], "Artifact archive digest mismatch")
    native_platform, arch, _ = TARGETS[platform]
    version = inputs["tag"][1:]
    names = artifact_names(version, platform)
    inventory = []
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.namelist()
        check(len(entries) == len(names) + 1 and set(entries) == names | {"verification.json"}, "Unexpected artifact contents")
        verification = json.loads(bundle.read("verification.json"))
        check(isinstance(verification, dict), "Invalid verification evidence")
        check(verification.get("version") == version and verification.get("source_revision") == inputs["source_revision"], "Build provenance mismatch")
        check(verification.get("platform") == native_platform and verification.get("arch") == arch, "Platform or architecture mismatch")
        check(verification.get("plugin_source") == {"repository": inputs["plugins_repository"], "commit": inputs["plugins_commit"]}, "Plugin source provenance mismatch")
        check(verification.get("plugin_lock_sha256") == inputs["plugin_lock_sha256"], "Reviewed plugin source lock mismatch")
        checks = verification.get("checks")
        check(isinstance(checks, list) and all(isinstance(item, str) for item in checks) and REQUIRED_CHECKS.issubset(checks), "Required build verification checks missing")
        if native_platform != "darwin":
            check("update feed integrity" in checks, "Required update feed verification missing")
        assets = verification.get("assets")
        check(isinstance(assets, list) and len(assets) == len(names), "Verification inventory mismatch")
        expected = {}
        for item in assets:
            check(isinstance(item, dict) and item.get("name") in names and item["name"] not in expected and matches(r"[0-9a-f]{64}", item.get("sha256")), "Verification inventory mismatch")
            expected[item["name"]] = item["sha256"]
        check(set(expected) == names, "Verification inventory mismatch")
        for name in sorted(names):
            file = root / name
            with bundle.open(name) as source, file.open("xb") as destination:
                shutil.copyfileobj(source, destination)
            check(digest(file) == expected[name], "Installer digest mismatch")
            inventory.append({"name": name, "bytes": file.stat().st_size, "sha256": expected[name]})
        if native_platform != "darwin":
            verify_update_plan(root, version, native_platform, arch, names)
    return inventory, verification


def verify_update_plan(root, version, platform, arch, names):
    manifest = f"update-feed-{platform}-{arch}.yml"
    plan_name = f"update-plan-{platform}-{arch}.json"
    plan = json.loads((root / plan_name).read_text(encoding="utf-8"))
    check(isinstance(plan, dict) and plan.get("schemaVersion") == 1 and plan.get("runtimeProtocol") == 2 and plan.get("eligible") is True,
          "Invalid update verification plan")
    check((plan.get("version"), plan.get("channel"), plan.get("platform"), plan.get("arch")) == (version, "stable", platform, arch),
          "Update plan differs from stable release")
    channel_file = "latest-linux.yml" if platform == "linux" else "latest.yml"
    check(plan.get("manifest") == manifest and plan.get("key") == f"updates/stable/{platform}-{arch}/{channel_file}", "Invalid update feed destination")
    assets = plan.get("assets")
    expected = names - {manifest, plan_name}
    check(isinstance(assets, list) and len(assets) == len(expected), "Incomplete update verification plan")
    seen = set()
    for asset in assets:
        check(isinstance(asset, dict), "Invalid update plan asset")
        name = asset.get("file")
        check(isinstance(name, str) and name in expected and name not in seen and asset.get("key") == f"v{version}/{name}", "Invalid update plan asset")
        seen.add(name)
        file = root / name
        check(asset.get("bytes") == file.stat().st_size and asset.get("sha512") == digest(file, "sha512"), "Update plan artifact digest mismatch")


def existing_assets(release, inventory):
    existing = {asset["name"]: asset for asset in release["assets"]}
    check(len(existing) == len(release["assets"]), "Duplicate existing release asset names")
    for item in inventory:
        name = item["name"]
        if name in existing:
            check(existing[name].get("digest") == "sha256:" + item["sha256"] and existing[name].get("size") == item["bytes"], "Existing release asset differs")
    return existing


def publish(inputs, repo, token):
    validate_inputs(inputs)
    check(matches(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo), "Invalid destination repository")
    tag, release_id = inputs["tag"], inputs["release_id"]
    require_draft(repo, release_id, tag)
    # Read from the event file, never interpolate signed URLs into shell code.
    for platform in TARGETS:
        print("::add-mask::" + inputs[f"{platform}_url"].replace("%", "%25"), flush=True)
    with tempfile.TemporaryDirectory(prefix="sesame-publish-") as temporary:
        root, inventory = Path(temporary), []
        for platform in TARGETS:
            archive = root / f"{platform}.zip"
            download_artifact(inputs[f"{platform}_url"], archive)
            items, verification = extract_artifact(archive, root, inputs, platform)
            inventory.extend(items)
            for item in items:
                print("SESAME_ASSET " + json.dumps(item), flush=True)
            print("SESAME_PLATFORM " + json.dumps(verification), flush=True)

        # Validate every artifact and every existing asset before the first write.
        existing_assets(require_draft(repo, release_id, tag), inventory)
        for item in inventory:
            # Recheck draft state and immutable retries immediately before upload.
            existing = existing_assets(require_draft(repo, release_id, tag), inventory)
            name = item["name"]
            if name in existing:
                continue
            # A draft's tag does not exist yet; address its numeric release ID.
            url = f"https://uploads.github.com/repos/{repo}/releases/{release_id}/assets?" + urllib.parse.urlencode({"name": name})
            with (root / name).open("rb") as stream:
                request = urllib.request.Request(url, data=stream, method="POST", headers={
                    "Authorization": "Bearer " + token,
                    "Content-Type": "application/octet-stream", "Content-Length": str(item["bytes"]),
                    "User-Agent": "Sesame-Release",
                })
                with urllib.request.urlopen(request, timeout=300) as response:
                    uploaded = json.load(response)
            check(uploaded.get("name") == name and uploaded.get("digest") == "sha256:" + item["sha256"] and uploaded.get("size") == item["bytes"], "Uploaded installer differs")

    print("All verified installers uploaded to draft; publication remains a separate step.")


if __name__ == "__main__":
    inputs = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())["inputs"]
    publish(inputs, os.environ["GITHUB_REPOSITORY"], os.environ["GH_TOKEN"])
