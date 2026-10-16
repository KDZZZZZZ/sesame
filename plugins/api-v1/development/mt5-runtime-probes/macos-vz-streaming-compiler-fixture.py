#!/usr/bin/env python3
"""Prepare only the already-authorized, pinned compiler fixture; never run it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tarfile

COMPILER = 'c4641eda510ffea814c627c922ea19e9eef51a22ff1a7244cda31345736c1d2e'
SOURCE = '2d8850ba7ebb28b60bbc024b30c6a96245d4695224cbb837414c422a66040523'
ERROR_SOURCE = '27aa75906d772150dd43984666d2a6c7d31141d4240b44fa0c0d3c6d11a6723e'
INCLUDES = '4a0462183e1bcec7d6d089536635bc00833729659746e0fb5b767785de868941'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def regular(path):
    info = path.lstat()
    assert path.resolve(strict=True) == path and stat.S_ISREG(info.st_mode) and info.st_nlink == 1
    return info


def verified(directory):
    assert directory.resolve(strict=True) == directory
    regular(directory / 'frozen.json')
    frozen = json.loads((directory / 'frozen.json').read_text())
    assert frozen['compiler_sha256'] == COMPILER and frozen['source_sha256'] == SOURCE
    includes = frozen['includes']
    assert len(includes) == 7 and hashlib.sha256(json.dumps(includes, sort_keys=True).encode()).hexdigest() == INCLUDES
    files = {'MetaEditor64.exe': {'bytes': 115827176, 'sha256': COMPILER},
             'Fixture.mq5': {'bytes': (directory / 'Fixture.mq5').stat().st_size, 'sha256': SOURCE},
             **{'Include/' + name: item for name, item in includes.items()}}
    for name, item in files.items():
        assert not name.startswith('/') and not any(part in ('', '.', '..') for part in name.split('/')) and '\\' not in name
        info = regular(directory / name)
        assert info.st_size == item['bytes'] and sha(directory / name) == item['sha256'], name
    return files


def archive(output):
    root = Path('/tmp/sesame-zero-setup-20261007.tElMxa')
    source = root / 'compiler-overlay-v2/overlay/usr/share/sesame-compiler-p0'
    assert output.parent == root and output.name == 'streaming-compiler-fixture-v1.tar.gz' and not output.exists()
    assert shutil.disk_usage(root).free >= 512 * 1024**2
    files = verified(source)
    with tarfile.open(output, 'x:gz') as target:
        for name in sorted([*files, 'frozen.json']):
            path = source / name
            info = regular(path)
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode, entry.mtime = info.st_size, 0o444, 0
            with path.open('rb') as stream:
                target.addfile(entry, stream)
    verified(source)
    record = dict(path=str(output), bytes=output.stat().st_size, sha256=sha(output),
                  compiler_sha256=COMPILER, source_sha256=SOURCE, include_manifest_sha256=INCLUDES)
    output.with_suffix('.json').write_text(json.dumps(record, indent=2))
    print(json.dumps(record))


def prepare(archive_path, expected, output):
    root = output.parent
    assert os.uname().sysname == 'Darwin' and root.name == 'sesame-p0-vz-_wdao4x5' and root.resolve() == root
    assert output.name == 'streaming-compiler-fixture-v1' and not output.exists()
    assert archive_path.parent == root and sha(archive_path) == expected
    assert shutil.disk_usage(root).free >= 1024**3
    output.mkdir(mode=0o700)
    source = output / 'input'
    source.mkdir(mode=0o700)
    seen, total = set(), 0
    with tarfile.open(archive_path, 'r:gz') as archive_file:
        for member in archive_file:
            name = member.name
            assert member.isfile() and name not in seen and not name.startswith('/') and '\\' not in name
            assert all(part not in ('', '.', '..') for part in name.split('/'))
            assert name in ('MetaEditor64.exe', 'Fixture.mq5', 'frozen.json') or name.startswith('Include/')
            seen.add(name)
            total += member.size
            assert len(seen) <= 10 and 0 <= member.size <= 115827176 and total <= 116 * 1024**2
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with archive_file.extractfile(member) as incoming, path.open('xb') as target:
                shutil.copyfileobj(incoming, target, 256 * 1024)
            assert path.stat().st_size == member.size
            path.chmod(0o444)
    files = verified(source)
    assert seen == set(files) | {'frozen.json'}
    snapshots = []
    for kind in ('success', 'error'):
        directory = output / kind
        directory.mkdir(mode=0o700)
        entries = {}
        for name, item in files.items():
            relative = { 'MetaEditor64.exe': '.compiler/MetaEditor64.exe', 'Fixture.mq5': 'Experts/Strategy.mq5' }.get(name, name)
            target = directory / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if name == 'Fixture.mq5' and kind == 'error':
                target.write_bytes((source / name).read_bytes().replace(b'return INIT_SUCCEEDED;', b'return missing_compile_token;'))
                assert sha(target) == ERROR_SOURCE
            else:
                shutil.copyfile(source / name, target)
                assert sha(target) == item['sha256']
            target.chmod(0o444)
            entries[relative] = {'bytes': target.stat().st_size, 'sha256': 'sha256:' + sha(target)}
        manifest = directory / 'manifest.json'
        manifest.write_text(json.dumps(dict(compiler_sha256='sha256:' + COMPILER, files=entries), indent=2))
        manifest.chmod(0o444)
        snapshots.append(dict(kind=kind, directory=str(directory), manifest_sha256='sha256:' + sha(manifest)))
    destination = output / 'snapshots.json'
    destination.write_text(json.dumps(snapshots, indent=2))
    print(json.dumps(dict(snapshots=str(destination), cases=snapshots, compilation_executed=False)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('archive', 'prepare'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--sha256')
    args = parser.parse_args()
    if args.mode == 'archive':
        archive(args.output)
    else:
        prepare(args.archive, args.sha256, args.output)


if __name__ == '__main__':
    main()
