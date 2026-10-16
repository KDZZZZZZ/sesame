#!/usr/bin/env python3
"""Prepare a verified runtime tree without the P0 user's compiler/Include samples.

This development step never mounts the image or changes an installed MT5/Wine.
It preserves the old fixture and refuses to reuse an existing output directory.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys

sys.dont_write_bytecode = True
ROOT = Path('/tmp/sesame-zero-setup-20261007.tElMxa')
BASE_IMAGE_SHA = '23cb62e349a3439a45709924c7b9b99a77ad2b389f30e5bcb7c716d2da68fba2'
BASE_MANIFEST_SHA = '12163da84d345298309555ffd31e38e5eff6f8e72a656b96ee6d7f7444d18eac'
COMPILER_PREFIX = 'usr/share/sesame-compiler-p0'
POSIX_PREFIX = 'usr/share/sesame-posix-p0'
LICENSE_ROOT = 'usr/share/sesame-runtime/licenses'


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--builder', type=Path, required=True)
    parser.add_argument('--builder-sha256', required=True)
    args = parser.parse_args()
    assert sys.platform == 'linux'
    assert ROOT.resolve(strict=True) == ROOT and not ROOT.is_symlink()
    output = args.output.absolute()
    assert output.parent == ROOT and output.resolve() == output and not output.exists()
    builder = args.builder.absolute()
    assert builder.is_relative_to(ROOT) and builder.resolve(strict=True) == builder
    assert builder.is_file() and builder.stat().st_nlink == 1 and digest(builder) == args.builder_sha256
    image = ROOT / 'guest-v13-compiler-block/runtime.squashfs'
    manifest = ROOT / 'guest-v13-compiler-block/expanded-manifest.json'
    for path, expected in ((image, BASE_IMAGE_SHA), (manifest, BASE_MANIFEST_SHA)):
        assert path.is_file() and not path.is_symlink() and path.resolve(strict=True) == path and path.stat().st_nlink == 1
        assert digest(path) == expected
    expected = json.loads(manifest.read_text())['files']
    file_bytes = sum(entry['bytes'] for entry in expected.values() if entry['kind'] == 'file')
    assert shutil.disk_usage(ROOT).free >= file_bytes + 4 * 1024**3
    spec = importlib.util.spec_from_file_location('block_builder', builder)
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    output.mkdir(mode=0o700)
    tree = output / 'tree'
    elapsed = helpers.command(helpers.unpack_arguments(image, tree), output / 'unpack.log')
    before = helpers.verify_tree(tree, expected)
    licenses = tree / LICENSE_ROOT
    licenses.mkdir(parents=True)
    for name, prefix in (('compiler', COMPILER_PREFIX), ('posix', POSIX_PREFIX)):
        source = tree / prefix / 'licenses'
        assert source.resolve(strict=True) == source and source.is_dir() and not source.is_symlink()
        source.rename(licenses / name)
    removed = {name: entry for name, entry in expected.items()
               if (name == COMPILER_PREFIX or name.startswith(COMPILER_PREFIX + '/'))
               and name != COMPILER_PREFIX + '/licenses' and not name.startswith(COMPILER_PREFIX + '/licenses/')}
    assert sum(entry['kind'] == 'file' for entry in removed.values()) == 11
    for prefix in (COMPILER_PREFIX, POSIX_PREFIX):
        path = tree / prefix
        assert path.resolve(strict=True) == path and path.is_relative_to(tree) and not path.is_symlink()
        assert shutil.rmtree.avoids_symlink_attacks
        shutil.rmtree(path)
    actual = helpers.snapshot(tree)
    remapped = {}
    for name, entry in expected.items():
        if name in removed or name in (POSIX_PREFIX, POSIX_PREFIX + '/licenses'):
            continue
        if name == COMPILER_PREFIX + '/licenses':
            continue
        for label, prefix in (('compiler', COMPILER_PREFIX), ('posix', POSIX_PREFIX)):
            if name.startswith(prefix + '/licenses/'):
                name = LICENSE_ROOT + '/' + label + name[len(prefix + '/licenses'):]
                break
        remapped[name] = entry
    added_directories = ['usr/share/sesame-runtime', LICENSE_ROOT, LICENSE_ROOT + '/compiler', LICENSE_ROOT + '/posix']
    for name in added_directories:
        assert actual[name]['kind'] == 'dir'
        remapped[name] = actual[name]
    assert actual == remapped, 'Only the declared sample removals and license moves may change the runtime tree'
    assert not any(name.lower().endswith(('.mq5', '.mqh', '/metaeditor64.exe')) or name.startswith(COMPILER_PREFIX) for name in actual)
    output_manifest = output / 'runtime-tree-manifest.json'
    output_manifest.write_text(json.dumps({'files': actual, 'purpose': 'Candidate runtime tree without user compiler samples; not a distributable bundle'}, indent=2) + '\n')
    result = {'scope': 'P1/P2 input separation; image rebuild and execution NOT_RUN',
              'base_image_sha256': BASE_IMAGE_SHA, 'base_manifest_sha256': BASE_MANIFEST_SHA,
              'builder_sha256': args.builder_sha256, 'tree_before': before,
              'tree_after': helpers.verify_tree(tree, actual), 'removed_entries': removed,
              'license_moves': {COMPILER_PREFIX + '/licenses': LICENSE_ROOT + '/compiler', POSIX_PREFIX + '/licenses': LICENSE_ROOT + '/posix'},
              'runtime_manifest_sha256': digest(output_manifest), 'unpack_seconds': elapsed,
              'old_image_unchanged': digest(image) == BASE_IMAGE_SHA,
              'host_mounts_or_settings_changed': False, 'free_bytes_after': shutil.disk_usage(ROOT).free}
    (output / 'preparation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ('scope', 'tree_before', 'tree_after', 'runtime_manifest_sha256', 'old_image_unchanged', 'free_bytes_after')}))


if __name__ == '__main__':
    main()
