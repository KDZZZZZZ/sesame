#!/usr/bin/env python3
"""Build the private Windows Python component; never modify a Wine prefix."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import stat
import urllib.request
import zipfile


def download(url, expected=None):
    if not url.startswith('https://'):
        raise ValueError('Runtime sources require HTTPS')
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read(64 * 1024**2 + 1)
    if len(data) > 64 * 1024**2:
        raise ValueError('Runtime archive exceeds 64 MiB')
    digest = hashlib.sha256(data).hexdigest()
    if expected and digest != expected:
        raise ValueError('Runtime source digest mismatch')
    return data, digest


def extract(data, root):
    root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        total = 0
        for item in archive.infolist():
            name = item.filename
            if (not name or '\\' in name or ':' in name or name.startswith('/')
                    or '..' in Path(name).parts or stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError('Unsafe runtime archive path')
            total += item.file_size
            if total > 256 * 1024**2:
                raise ValueError('Runtime archive expands beyond its budget')
            target = root / name
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as source, target.open('xb') as destination:
                    while chunk := source.read(1024**2):
                        destination.write(chunk)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    target = args.output.absolute()
    target.mkdir(mode=0o700)
    # The existing macOS installer already uses this pair for MT5's Wine 10.
    version, abi = '3.12.10', '312'
    url = f'https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip'
    data, digest = download(url, '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3')
    extract(data, target)
    manifest = [{'package': 'python', 'version': version, 'url': url, 'sha256': digest}]
    for package, release, expected in [
        ('numpy', '1.26.4', '08beddf13648eb95f8d867350f6a018a4be2e5ad54c8d8caed89ebca558b2818'),
        ('MetaTrader5', '5.0.6231', 'b94b1f8f52087ae36dfac5f352a96f5d04fe308704d9515f82cf5d1470bc31d4')]:
        metadata, _ = download(f'https://pypi.org/pypi/{package}/{release}/json')
        info = json.loads(metadata)
        wheel = next(item for item in info['urls'] if item['filename'].endswith(f'-cp{abi}-cp{abi}-win_amd64.whl'))
        if wheel['digests']['sha256'] != expected:
            raise ValueError('Official wheel metadata changed from the pinned release')
        data, digest = download(wheel['url'], expected)
        extract(data, target / 'Lib/site-packages')
        manifest.append({'package': package, 'version': release, 'url': wheel['url'], 'sha256': digest})
    (target / f'python{abi}._pth').write_text(f'python{abi}.zip\n.\nLib/site-packages\nimport site\n')
    (target / 'install-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'root': str(target), 'sources': manifest}))


if __name__ == '__main__':
    main()
