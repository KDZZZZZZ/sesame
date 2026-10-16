"""Explicit, pinned Windows Python installation in a caller-selected private directory.

Use an existing host Python 3.9+ to run this installer. Nothing is executed from
these archives; it neither starts Wine/MT5 nor changes a global Python or prefix.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import urllib.error
import urllib.request
import zipfile

PACKAGES = [
    {"package": "python", "version": "3.12.10", "url": "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip", "sha256": "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3", "bytes": 11133606},
    {"package": "numpy", "version": "1.26.4", "url": "https://files.pythonhosted.org/packages/16/2e/86f24451c2d530c88daf997cb8d6ac622c1d40d19f5a031ed68a4b73a374/numpy-1.26.4-cp312-cp312-win_amd64.whl", "sha256": "08beddf13648eb95f8d867350f6a018a4be2e5ad54c8d8caed89ebca558b2818", "bytes": 15517754},
    {"package": "MetaTrader5", "version": "5.0.6231", "url": "https://files.pythonhosted.org/packages/90/ed/525a69afbc050f5b19342a6ddada4f086e2aa9ef63b987bef5d723f29586/metatrader5-5.0.6231-cp312-cp312-win_amd64.whl", "sha256": "b94b1f8f52087ae36dfac5f352a96f5d04fe308704d9515f82cf5d1470bc31d4", "bytes": 47968},
]


def download(package):
    failure = None
    for _attempt in range(3):
        try:
            with urllib.request.urlopen(package['url'], timeout=60) as response:
                if not response.url.startswith(('https://www.python.org/', 'https://files.pythonhosted.org/')):
                    raise ValueError('Unapproved download redirect')
                data = response.read(package['bytes'] + 1)
            actual_digest = hashlib.sha256(data).hexdigest()
            if len(data) == package['bytes'] and actual_digest == package['sha256']:
                return data
            failure = ValueError(f"Pinned dependency digest/size mismatch: {package['package']} ({len(data)} bytes, sha256 {actual_digest})")
        except (urllib.error.URLError, TimeoutError) as cause:
            failure = cause
    # Retries only download identical pinned bytes. No fallback version, URL or
    # checksum is accepted, and an incomplete directory is never published.
    raise failure


def extract(data, directory):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 20000 or sum(item.file_size for item in entries) > 256 * 1024 * 1024:
            raise ValueError('Dependency archive exceeds budget')
        seen = set()
        for item in entries:
            name = item.filename
            path = PurePosixPath(name)
            if not name or '\\' in name or ':' in name or path.is_absolute() or '..' in path.parts or stat.S_ISLNK(item.external_attr >> 16) or name.casefold() in seen:
                raise ValueError('Unsafe dependency archive path')
            seen.add(name.casefold())
        for item in entries:
            target = directory / item.filename
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as stream:
                    stream.write(archive.read(item))


def installed_files(directory):
    return {str(path.relative_to(directory)).replace('\\', '/'): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(directory.rglob('*')) if path.is_file() and path.name != 'install-manifest.json'}


def install(directory, fetch=download):
    target = Path(directory)
    if not target.is_absolute():
        raise ValueError('An explicit absolute plugin-private directory is required')
    if target.exists():
        manifest = json.loads((target / 'install-manifest.json').read_text())
        if manifest['packages'] != PACKAGES or manifest['files'] != installed_files(target):
            raise ValueError('Existing directory is different or modified; choose a new private directory')
        return {'status': 'reused', 'python': str(target / 'python.exe')}
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.parent.resolve() != target.parent or target.is_symlink():
        raise ValueError('Private directory must not be redirected by a symbolic link')
    stage = Path(tempfile.mkdtemp(prefix='.python-install-', dir=target.parent))
    try:
        for package in PACKAGES:
            data = fetch(package)
            # Also validate injected transport results; only tests replace fetch.
            if len(data) != package['bytes'] or hashlib.sha256(data).hexdigest() != package['sha256']:
                raise ValueError('Pinned dependency digest/size mismatch: ' + package['package'])
            extract(data, stage if package['package'] == 'python' else stage / 'Lib/site-packages')
        (stage / 'python312._pth').write_text('python312.zip\n.\nLib/site-packages\nimport site\n')
        manifest = {'packages': PACKAGES, 'files': installed_files(stage)}
        (stage / 'install-manifest.json').write_text(json.dumps(manifest, indent=2))
        if target.exists():
            raise ValueError('Destination appeared during installation; refusing to overwrite')
        stage.rename(target)
        return {'status': 'installed', 'python': str(target / 'python.exe'), 'manifest': str(target / 'install-manifest.json')}
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, help='Absolute directory returned by mt5_dependencies; must be new or match the pinned manifest')
    args = parser.parse_args()
    print(json.dumps(install(args.directory)))
