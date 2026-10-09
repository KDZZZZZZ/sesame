"""Install the official Windows Python/MetaTrader5 wheels in the existing Wine prefix.

Run: python3 scripts/install-mt5-python.py
No Linux MetaTrader5 substitute, pip bootstrap script, or shell execution of downloads.
"""
import hashlib
import io
import json
import os
import sys
from pathlib import Path
import urllib.request
import zipfile

default_prefix = Path.home() / '.mt5'
mac_prefix = Path.home() / 'Library/Application Support/net.metaquotes.wine.metatrader5'
if sys.platform == 'darwin' and (mac_prefix / 'drive_c').is_dir():
    default_prefix = mac_prefix
directory = os.environ.get('MT5AGENT_MT5_DIR', '')
if '/drive_c/' in directory.lower():
    default_prefix = Path(directory[:directory.lower().index('/drive_c/')])
target = Path(os.environ['MT5AGENT_PYTHON_DIR']) if os.environ.get('MT5AGENT_PYTHON_DIR') else Path(os.environ.get('MT5AGENT_WINEPREFIX', os.environ.get('WINEPREFIX', str(default_prefix)))) / 'drive_c/mt5agent-python'
target.mkdir(parents=True, exist_ok=True, mode=0o700)


def download(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def extract(data, directory):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in archive.namelist():
            if not (directory / name).resolve().is_relative_to(directory.resolve()):
                raise ValueError('Unsafe archive path')
        archive.extractall(directory)


# Official macOS Wine 10 lacks ucrtbase.crealf used by NumPy 2 Windows wheels.
mac = sys.platform == 'darwin'
version = '3.12.10' if mac else '3.13.15'
abi = '312' if mac else '313'
url = f'https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip'
data = download(url)
extract(data, target)
manifest = [{'package': 'python', 'version': version, 'url': url, 'sha256': hashlib.sha256(data).hexdigest()}]
for package, release in [('numpy', '1.26.4' if mac else None), ('MetaTrader5', '5.0.6231')]:
    info = json.loads(download(f'https://pypi.org/pypi/{package}/{release + "/" if release else ""}json'))
    wheel = next(item for item in info['urls'] if item['filename'].endswith(f'-cp{abi}-cp{abi}-win_amd64.whl'))
    data = download(wheel['url'])
    if hashlib.sha256(data).hexdigest() != wheel['digests']['sha256']:
        raise ValueError('Wheel digest mismatch')
    extract(data, target / 'Lib/site-packages')
    manifest.append({'package': package, 'version': info['info']['version'], 'url': wheel['url'], 'sha256': wheel['digests']['sha256']})
    print(f'Installed {package} {info["info"]["version"]}', flush=True)
(target / f'python{abi}._pth').write_text(f'python{abi}.zip\n.\nLib/site-packages\nimport site\n')
(target / 'install-manifest.json').write_text(json.dumps(manifest, indent=2))
print(f'Python installed: {target / "python.exe"}', flush=True)
