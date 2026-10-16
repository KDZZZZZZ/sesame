"""Offline release-upload checks; no GitHub credentials or network access."""
from pathlib import Path
from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.parse
import warnings
import zipfile

spec = importlib.util.spec_from_file_location("publish_installers", Path(__file__).with_name("publish-installers.py"))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def inputs_fixture():
    inputs = {"tag": "v0.2.3", "release_id": "123", "source_revision": "a" * 40,
              "plugins_repository": "KDZZZZZZ/sesame", "plugins_commit": "b" * 40,
              "plugin_lock_sha256": "c" * 64}
    for platform in publisher.TARGETS:
        inputs[f"{platform}_url"] = f"https://example.blob.core.windows.net/artifacts/{platform}?sig=private-{platform}"
    return inputs


def artifact_fixture(inputs, platform, change=None, extra_entry=None, corrupt_installer=False):
    native, arch, suffixes = publisher.TARGETS[platform]
    files = {f"Sesame-{inputs['tag'][1:]}-{suffix}": (platform + suffix).encode() for suffix in suffixes}
    verification = {"version": inputs["tag"][1:], "source_revision": inputs["source_revision"], "platform": native, "arch": arch,
                    "plugin_source": {"repository": inputs["plugins_repository"], "commit": inputs["plugins_commit"]},
                    "plugin_lock_sha256": inputs["plugin_lock_sha256"], "checks": sorted(publisher.REQUIRED_CHECKS),
                    "assets": [{"name": name, "sha256": hashlib.sha256(data).hexdigest()} for name, data in files.items()]}
    if change:
        change(verification)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        for name, data in files.items():
            bundle.writestr(name, data + (b"corrupt" if corrupt_installer else b""))
        bundle.writestr("verification.json", json.dumps(verification))
        if extra_entry:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                bundle.writestr(extra_entry, b"unexpected")
    archive = buffer.getvalue()
    inputs[f"{platform}_sha256"] = hashlib.sha256(archive).hexdigest()
    inventory = [{"name": name, "digest": "sha256:" + hashlib.sha256(data).hexdigest(), "size": len(data)} for name, data in files.items()]
    return archive, inventory


class Response(io.BytesIO):
    def __init__(self, data, url="https://uploads.github.com/"):
        super().__init__(data)
        self.url = url

    def geturl(self):
        return self.url


class PublicationFixture:
    def __init__(self, inputs, changed_platform=None, change=None, existing=None):
        self.inputs, self.archives, self.expected, self.uploads = inputs, {}, [], []
        self.release = {"tag_name": inputs["tag"], "draft": True, "assets": list(existing or [])}
        for platform in publisher.TARGETS:
            archive, inventory = artifact_fixture(inputs, platform, change if platform == changed_platform else None)
            self.archives[inputs[f"{platform}_url"]] = archive
            self.expected.extend(inventory)

    def api(self, path):
        if path != "repos/KDZZZZZZ/sesame/releases/123":
            raise AssertionError(f"Unexpected API call: {path}")
        return deepcopy(self.release)

    def urlopen(self, request, timeout):
        if isinstance(request, str):
            return Response(self.archives[request], request)
        if request.method != "POST" or not request.full_url.startswith("https://uploads.github.com/repos/KDZZZZZZ/sesame/releases/123/assets?"):
            raise AssertionError("Only creation of an asset on the requested draft is allowed")
        if request.get_header("Authorization") != "Bearer test-token":
            raise AssertionError("Unexpected token")
        name = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)["name"][0]
        data = request.data.read()
        asset = {"name": name, "digest": "sha256:" + hashlib.sha256(data).hexdigest(), "size": len(data)}
        self.uploads.append(asset)
        self.release["assets"].append(asset)
        return Response(json.dumps(asset).encode())

    def run(self, api=None):
        output = io.StringIO()
        with patch.object(publisher, "api", side_effect=api or self.api), patch.object(publisher.urllib.request, "urlopen", side_effect=self.urlopen), redirect_stdout(output):
            publisher.publish(self.inputs, "KDZZZZZZ/sesame", "test-token")
        return output.getvalue()


class WorkflowTests(unittest.TestCase):
    def test_three_platforms_share_explicit_reviewed_plugin_source(self):
        workflow = (Path(__file__).parent.parent / "workflows/publish-installers.yml").read_text()
        for name in ["plugins_repository", "plugins_commit", "plugin_lock_sha256", "macos_url", "macos_sha256"]:
            self.assertIn(f"      {name}:\n", workflow)
        self.assertNotIn("${{ inputs.", workflow.split("steps:", 1)[1])
        self.assertIn("run: python3 .github/scripts/test_publish_installers.py", workflow)


class VerificationTests(unittest.TestCase):
    def test_all_three_platforms_upload_four_verified_installers_to_draft(self):
        fixture = PublicationFixture(inputs_fixture())
        output = fixture.run()
        self.assertEqual(fixture.uploads, fixture.expected)
        self.assertTrue(fixture.release["draft"])
        for platform in publisher.TARGETS:
            lines = [line for line in output.splitlines() if "private-" + platform in line]
            self.assertEqual(lines, ["::add-mask::" + fixture.inputs[f"{platform}_url"]])

    def test_each_provenance_field_and_required_checks_must_match(self):
        changes = [
            (lambda data: data.update(version="0.2.2"), "Build provenance"),
            (lambda data: data.update(source_revision="d" * 40), "Build provenance"),
            (lambda data: data.update(platform="linux"), "Platform or architecture"),
            (lambda data: data.update(arch="x64"), "Platform or architecture"),
            (lambda data: data["plugin_source"].update(repository="other/repo"), "Plugin source provenance"),
            (lambda data: data["plugin_source"].update(commit="e" * 40), "Plugin source provenance"),
            (lambda data: data.update(plugin_lock_sha256="d" * 64), "Reviewed plugin source lock"),
            (lambda data: data.update(checks=[]), "Required build verification"),
            (lambda data: data.pop("plugin_source"), "Plugin source provenance"),
            (lambda data: data["assets"].append(data["assets"][0]), "Verification inventory"),
            (lambda data: data["assets"][0].update(sha256="invalid"), "Verification inventory"),
        ]
        for change, expected_error in changes:
            with self.subTest(error=expected_error):
                fixture = PublicationFixture(inputs_fixture(), "macos", change)
                with self.assertRaisesRegex(ValueError, expected_error):
                    fixture.run()
                self.assertEqual(fixture.uploads, [], "All three platforms must pass before any upload")

    def test_artifact_archive_inventory_and_installer_digests_are_independent_checks(self):
        for mode, expected_error in [("archive", "archive digest"), ("extra", "Unexpected artifact"), ("duplicate", "Unexpected artifact"), ("installer", "Installer digest")]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                inputs = inputs_fixture()
                archive, _ = artifact_fixture(inputs, "macos", extra_entry="extra" if mode == "extra" else "verification.json" if mode == "duplicate" else None, corrupt_installer=mode == "installer")
                file = Path(temporary) / "macos.zip"
                file.write_bytes(archive)
                if mode == "archive":
                    inputs["macos_sha256"] = "0" * 64
                with self.assertRaisesRegex(ValueError, expected_error):
                    publisher.extract_artifact(file, Path(temporary), inputs, "macos")

    def test_plugin_pin_and_all_platform_inputs_are_mandatory_before_network_access(self):
        for field, value in [("plugins_commit", "main"), ("plugin_lock_sha256", "invalid"), ("macos_url", None), ("macos_sha256", None)]:
            with self.subTest(field=field):
                fixture = PublicationFixture(inputs_fixture())
                fixture.inputs[field] = value
                with patch.object(publisher, "api") as api, self.assertRaises(ValueError):
                    publisher.publish(fixture.inputs, "KDZZZZZZ/sesame", "test-token")
                api.assert_not_called()

    def test_same_bytes_are_idempotent_and_different_existing_bytes_prevent_all_uploads(self):
        fixture = PublicationFixture(inputs_fixture())
        fixture.release["assets"] = deepcopy(fixture.expected)
        fixture.run()
        self.assertEqual(fixture.uploads, [])
        fixture.release["assets"] = [dict(fixture.expected[-1], digest="sha256:" + "0" * 64)]
        with self.assertRaisesRegex(ValueError, "Existing release asset differs"):
            fixture.run()
        self.assertEqual(fixture.uploads, [])

    def test_published_or_wrong_release_is_rejected(self):
        for change, error in [({"draft": False}, "only uploads to a draft"), ({"tag_name": "v0.2.2"}, "Release tag mismatch")]:
            with self.subTest(change=change):
                fixture = PublicationFixture(inputs_fixture())
                fixture.release.update(change)
                with self.assertRaisesRegex(ValueError, error):
                    fixture.run()
                self.assertEqual(fixture.uploads, [])

    def test_draft_state_is_rechecked_after_download_and_before_each_upload(self):
        for stop_at in [2, 4]:
            with self.subTest(stop_at=stop_at):
                fixture = PublicationFixture(inputs_fixture())
                calls = 0
                def api(path):
                    nonlocal calls
                    calls += 1
                    if calls == stop_at:
                        fixture.release["draft"] = False
                    return fixture.api(path)
                with self.assertRaisesRegex(ValueError, "only uploads to a draft"):
                    fixture.run(api=api)
                self.assertEqual(len(fixture.uploads), 0 if stop_at == 2 else 1)

    def test_untrusted_urls_and_signed_download_errors_do_not_echo_secrets(self):
        for url in ["https://example.com/file", "https:///file", "https://example.blob.core.windows.net.evil.com/file", "http://example.blob.core.windows.net/file", "https://user:secret@example.blob.core.windows.net/file", "https://example.blob.core.windows.net:bad/file"]:
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "Expected a GitHub artifact storage URL"):
                publisher.check_artifact_url(url)
        secret = "https://example.blob.core.windows.net/file?sig=private-token"
        with tempfile.TemporaryDirectory() as temporary, patch.object(publisher.urllib.request, "urlopen", side_effect=urllib.error.URLError(secret)):
            with self.assertRaisesRegex(ValueError, "^Artifact download failed$") as error:
                publisher.download_artifact(secret, Path(temporary) / "archive.zip")
            self.assertNotIn("private-token", str(error.exception))


if __name__ == "__main__":
    unittest.main()
