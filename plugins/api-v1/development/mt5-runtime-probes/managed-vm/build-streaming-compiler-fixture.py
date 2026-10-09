#!/usr/bin/env python3
"""Add the verified compiler transport to the prepared, user-tool-free P0 root.

This creates a fresh development fixture, not a production/distribution bundle.
It never mounts a host filesystem, modifies a user MT5 or replaces old evidence.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys

sys.dont_write_bytecode = True
ROOT = Path('/tmp/sesame-zero-setup-20261007.tElMxa')
PREPARED_SHA = 'f588222728e3b0e81a7963eba89a8ccaac98906266039b420789e57af7c9b8d5'
BLOCK_HELPER_SHA = 'd158883fcdf5d936135106c367328b121bc9a0febf9fbe71b7182903217ce047'
BOOT_HELPER_SHA = '3138c96f0e6be8419aa1169297c7aada76e76f205f0b45b27a51fed085a9f55e'
KERNEL_SHA = '5cd6898e71f247e0dd820bcbae669a5b5d35bd736cbe3c2e6834ff2381525e5d'
DESTINATIONS = {
    'guest.py': 'guest.py',
    'compiler-snapshot.py': 'usr/share/sesame-runtime/compiler_snapshot.py',
    'compiler-channel.py': 'usr/share/sesame-runtime/compiler_channel.py',
    'compiler-entry.py': 'usr/share/sesame-runtime/compiler_entry.py',
}


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def checked(path, expected):
    assert path.is_relative_to(ROOT) and path.resolve(strict=True) == path
    assert path.is_file() and not path.is_symlink() and path.stat().st_nlink == 1
    assert digest(path) == expected, f'Input hash mismatch: {path.name}'
    return path


def module(name, path, expected):
    checked(path, expected)
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--network', type=Path)
    parser.add_argument('--network-manifest-sha256')
    args = parser.parse_args()
    assert sys.platform == 'linux' and ROOT.resolve(strict=True) == ROOT
    source, output = args.input.absolute(), args.output.absolute()
    assert source.parent == ROOT and source.resolve(strict=True) == source
    assert output.parent == ROOT and not output.exists() and output.resolve() == output
    inputs = json.loads((source / 'input-sha256.json').read_text())
    assert set(inputs) == set(DESTINATIONS)
    for name, expected in inputs.items():
        checked(source / name, expected)
    helpers = module('block_helper', ROOT / 'block-fixture-input-v1/build-block-fixture.py', BLOCK_HELPER_SHA)
    boot = module('boot_helper', ROOT / 'block-fixture-input-v1/build-compiler-bootstrap.py', BOOT_HELPER_SHA)
    manifest_path = checked(ROOT / 'guest-v15-runtime-only/runtime-tree-manifest.json', PREPARED_SHA)
    expected = json.loads(manifest_path.read_text())['files']
    prepared = ROOT / 'guest-v15-runtime-only/tree'
    before = helpers.verify_tree(prepared, expected)
    assert shutil.disk_usage(ROOT).free >= 2 * before['file_bytes'] + 5 * 1024**3
    output.mkdir(mode=0o700)
    tree = output / 'tree-building'
    shutil.copytree(prepared, tree, symlinks=True)
    helpers.verify_tree(tree, expected)
    if args.network:
        network = args.network.absolute()
        assert network.parent == ROOT and network.resolve(strict=True) == network
        metadata = json.loads(checked(network / 'sources.json', args.network_manifest_sha256).read_text())
        for name, record in metadata['files'].items():
            assert name.startswith('/') and '..' not in Path(name).parts
            if record['delivery'] != 'overlay':
                assert digest(tree / name.lstrip('/')) == record['sha256']
                continue
            source_file, target = network / 'overlay' / name.lstrip('/'), tree / name.lstrip('/')
            target.parent.mkdir(parents=True, exist_ok=True)
            assert target.parent.resolve() == target.parent and target.parent.is_relative_to(tree)
            if record.get('type') == 'symlink':
                assert source_file.is_symlink() and os.readlink(source_file) == record['target']
                assert hashlib.sha256(record['target'].encode()).hexdigest() == record['sha256']
                assert not target.exists() and not target.is_symlink()
                target.symlink_to(record['target'])
            else:
                checked(source_file, record['sha256'])
                assert not target.is_symlink()
                shutil.copyfile(source_file, target)
                target.chmod(int(record['mode'], 8))
        expected = helpers.snapshot(tree)
        for name in ('hosts', 'resolv.conf', 'nsswitch.conf'):
            template = tree / 'usr/share/sesame-network-p0/etc' / name
            target = tree / 'etc' / name
            assert template.is_file() and not template.is_symlink() and not target.is_symlink()
            shutil.copyfile(template, target)
            target.chmod(0o644)
            expected['etc/' + name] = dict(kind='file', mode=0o644, bytes=target.stat().st_size, sha256=digest(target))
    for name, target in DESTINATIONS.items():
        data = checked(source / name, inputs[name]).read_bytes()
        mode = expected[target]['mode'] if target in expected else 0o444
        (tree / target).write_bytes(data)
        (tree / target).chmod(mode)
        expected[target] = dict(kind='file', mode=mode, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    assert not any(name.lower().endswith(('.mq5', '.mqh', '/metaeditor64.exe'))
                   or name.startswith('usr/share/sesame-compiler-p0') for name in expected)
    evidence = {
        'purpose': 'Bundled runtime candidate; no user compiler in the runtime image' if args.network else 'P1/P2 streamed frozen compiler proof; no user compiler in the runtime image',
        'network_manifest_sha256': args.network_manifest_sha256,
        'prepared_manifest_sha256': PREPARED_SHA, 'overlay_sources': inputs,
        'build_tree': helpers.verify_tree(tree, expected),
        'host_mounts_created': False, 'host_settings_changed': False,
        'task_limits_changed': False, 'build_validation': 'INCOMPLETE', 'runtime_validation': 'NOT_RUN',
    }
    (output / 'expanded-manifest.json').write_text(json.dumps({'files': expected}, sort_keys=True, indent=2) + '\n')
    image = output / 'runtime.squashfs'
    evidence['mksquashfs_seconds'] = helpers.command(helpers.squashfs_arguments(tree, image), output / 'mksquashfs.log')
    evidence['image'] = {'bytes': image.stat().st_size, 'sha256': digest(image)}
    busybox = (tree / 'bin/busybox').read_bytes()
    assert hashlib.sha256(busybox).hexdigest() == expected['bin/busybox']['sha256']
    helpers.remove_own_tree(output, 'tree-building')
    print(json.dumps({'stage': 'image_built', 'image': evidence['image']}), flush=True)
    readback = output / 'tree-readback'
    evidence['unsquashfs_seconds'] = helpers.command(helpers.unpack_arguments(image, readback), output / 'unsquashfs.log')
    evidence['readback_tree'] = helpers.verify_tree(readback, expected)
    assert digest(image) == evidence['image']['sha256']
    helpers.remove_own_tree(output, 'tree-readback')
    evidence['tiny_initrd'] = helpers.write_tiny(boot, output, busybox, evidence['image']['sha256'], evidence['build_tree']['types']['file'])
    kernel = checked(ROOT / 'guest-v13-compiler-block/vmlinuz', KERNEL_SHA)
    shutil.copyfile(kernel, output / 'vmlinuz')
    assert digest(output / 'vmlinuz') == KERNEL_SHA
    evidence['kernel_sha256'] = KERNEL_SHA
    evidence['expanded_manifest_sha256'] = digest(output / 'expanded-manifest.json')
    evidence['build_validation'] = 'PASS'
    evidence['prepared_tree_unchanged'] = helpers.verify_tree(prepared, json.loads(manifest_path.read_text())['files']) == before
    evidence['free_bytes_after'] = shutil.disk_usage(ROOT).free
    (output / 'sources.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence), flush=True)


if __name__ == '__main__':
    main()
