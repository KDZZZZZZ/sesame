import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('installer', Path(__file__).parents[1] / 'packages/mt5/scripts/install-mt5-python.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def archive(files):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as value:
        for name, text in files.items():
            value.writestr(name, text)
    return data.getvalue()


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.original = installer.PACKAGES

    def tearDown(self):
        installer.PACKAGES = self.original
        self.temporary.cleanup()

    def fixture(self):
        data = archive({'python.exe': 'MZ controlled executable fixture', 'python312._pth': 'placeholder'})
        installer.PACKAGES = [{'package': 'python', 'version': 'fixture', 'url': 'https://www.python.org/fixture.zip', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}]
        return data

    def test_atomic_install_reuses_only_verified_tree_and_does_not_execute(self):
        data = self.fixture()
        target = self.root / 'python'
        self.assertEqual(installer.install(target, lambda _package: data)['status'], 'installed')
        self.assertEqual(installer.install(target, lambda _package: self.fail('should not download twice'))['status'], 'reused')
        (target / 'python.exe').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'different or modified'):
            installer.install(target, lambda _package: self.fail('must preserve existing installation'))
        self.assertEqual((target / 'python.exe').read_text(), 'changed')

    def test_digest_mismatch_does_not_publish_partial_installation(self):
        self.fixture()
        with self.assertRaisesRegex(ValueError, 'digest/size'):
            installer.install(self.root / 'python', lambda _package: b'tampered')
        self.assertEqual(list(self.root.iterdir()), [])

    def test_rejects_unsafe_zip_before_writing_any_file(self):
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            installer.extract(archive({'safe': 'first', '../escape': 'bad'}), self.root / 'target')
        self.assertEqual(list(self.root.iterdir()), [])

    def test_rejects_cross_platform_path_ambiguity(self):
        for name in ['C:/escape', 'a\\..\\escape', '/root/escape']:
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                installer.extract(archive({name: 'bad'}), self.root / 'target')

    def test_transport_retries_never_relax_pinned_identity(self):
        data = self.fixture()
        package = installer.PACKAGES[0]
        class Response(io.BytesIO):
            url = package['url']
        with patch.object(installer.urllib.request, 'urlopen', side_effect=[Response(b'partial'), Response(data)]) as fetch:
            self.assertEqual(installer.download(package), data)
            self.assertEqual(fetch.call_count, 2)
        with patch.object(installer.urllib.request, 'urlopen', side_effect=lambda *_args, **_kwargs: Response(b'wrong')) as fetch:
            with self.assertRaisesRegex(ValueError, 'digest/size'):
                installer.download(package)
            self.assertEqual(fetch.call_count, 3)

    def test_requires_explicit_absolute_target(self):
        with self.assertRaisesRegex(ValueError, 'absolute'):
            installer.install('relative/path')


if __name__ == '__main__':
    unittest.main()
