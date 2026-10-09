#!/usr/bin/env python3
"""Wrap the frozen P0 compiler image in a bounded, manifest-checked bootstrap.

Development fixture only. No runtime install, user prefix, account or release
payload is created. The embedded trusted init runs only as PID 1 in the P0 VM.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import shlex
import shutil
import stat
import struct
import zlib

BASE_SHA256 = '14424e8e5f015d1fee242f7c194f32b993605ce463912153679133a736e5dc54'
KERNEL_SHA256 = '5cd6898e71f247e0dd820bcbae669a5b5d35bd736cbe3c2e6834ff2381525e5d'
ROOTFS_BYTES = 2 * 1024**3
BOOTSTRAP_MAX_BYTES = 480 * 1024**2
CAPTURE = {'bin/busybox', 'guest.py', 'usr/share/sesame-compiler-p0/frozen.json'}


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


class Chunks:
    def __init__(self, chunks):
        self.chunks, self.buffer = iter(chunks), bytearray()

    def read(self, count):
        while len(self.buffer) < count:
            chunk = next(self.chunks, None)
            if chunk is None:
                break
            self.buffer.extend(chunk)
        result = bytes(self.buffer[:count])
        del self.buffer[:count]
        return result


def gzip_member(source, record):
    decoder, hashed, expanded = zlib.decompressobj(31), hashlib.sha256(), 0
    while not decoder.eof:
        block = source.read(65536)
        if not block:
            raise ValueError('Truncated gzip member')
        output = decoder.decompress(block)
        used = len(block) - len(decoder.unused_data)
        hashed.update(block[:used])
        if decoder.unused_data:
            source.seek(-len(decoder.unused_data), 1)
        expanded += len(output)
        if expanded > ROOTFS_BYTES:
            raise ValueError('One expanded member exceeds the fixed rootfs budget')
        yield output
    record.update({'compressed_bytes': source.tell()-record['offset'],
                   'compressed_sha256': hashed.hexdigest(), 'expanded_bytes': expanded})


def scan_cpio(stream, files, captured):
    def exact(size):
        result = stream.read(size)
        if len(result) != size:
            raise ValueError('Truncated newc archive')
        return result

    count = 0
    while True:
        header = exact(110)
        if header[:6] != b'070701':
            raise ValueError('Only the frozen newc format is supported')
        fields = [int(header[6+i*8:14+i*8], 16) for i in range(13)]
        mode, nlink, size, name_size = fields[1], fields[4], fields[6], fields[11]
        if not 0 < name_size <= 4096:
            raise ValueError('Invalid archive path length')
        raw_name = exact(name_size)
        if not raw_name.endswith(b'\0'):
            raise ValueError('Archive path lacks a terminator')
        name = raw_name[:-1].decode('utf-8')
        exact(-(110+name_size) % 4)
        if name == 'TRAILER!!!':
            if size:
                raise ValueError('Unexpected trailer contents')
            while chunk := stream.read(65536):
                if any(chunk):
                    raise ValueError('Each gzip member must contain exactly one cpio archive')
            return count
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or any(c in name for c in '\\\n\r\0'):
            raise ValueError(f'Unsafe frozen archive path: {name!r}')
        name = str(path)
        if name == '.':
            if not stat.S_ISDIR(mode) or size:
                raise ValueError('Invalid archive root entry')
            continue
        for ancestor in path.parents:
            if files.get(str(ancestor), {}).get('kind') == 'symlink':
                raise ValueError('Archive would write through a symlink ancestor')
        kind = 'file' if stat.S_ISREG(mode) else 'dir' if stat.S_ISDIR(mode) else 'symlink' if stat.S_ISLNK(mode) else None
        if kind is None or (kind == 'file' and nlink != 1) or (kind == 'dir' and size):
            raise ValueError('Unsupported device, hard link or directory body in controlled archive')
        hashed, body, remaining = hashlib.sha256(), bytearray(), size
        while remaining:
            block = exact(min(65536, remaining))
            hashed.update(block)
            if name in CAPTURE or kind == 'symlink':
                body.extend(block)
            remaining -= len(block)
        exact(-size % 4)
        entry = {'kind': kind, 'mode': mode & 0o777, 'bytes': size}
        if kind == 'file':
            entry['sha256'] = hashed.hexdigest()
        if kind == 'symlink':
            entry['target'] = body.decode('utf-8')
        files[name] = entry
        if name in CAPTURE:
            captured[name] = bytes(body)
        count += 1


def inspect(path, files, captured):
    segments = []
    with path.open('rb') as source:
        while source.tell() < path.stat().st_size:
            record = {'source': str(path), 'offset': source.tell()}
            stream = Chunks(gzip_member(source, record))
            record['entries'] = scan_cpio(stream, files, captured)
            segments.append(record)
    return segments


def static_x64(bytes_):
    if bytes_[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', bytes_, 18)[0] != 62:
        return False
    offset = struct.unpack_from('<Q', bytes_, 32)[0]
    width, count = struct.unpack_from('<HH', bytes_, 54)
    return all(struct.unpack_from('<I', bytes_, offset+i*width)[0] != 3 for i in range(count))


def trusted_init(file_count, segment_count):
    return f'''#!/bin/sh
set -eu
set -o pipefail
B=/bootstrap/bin/busybox
[ "$$" -eq 1 ] || exit 125
fail() {{
  "$B" printf '%s\\n' '{{"type":"boot_error","message":"compiler bootstrap verification failed"}}'
  exec "$B" poweroff -f
}}
trap fail EXIT
"$B" mount -t proc proc /proc
case "$("$B" cat /proc/cmdline)" in *sesame-p0=1*) ;; *) exit 125 ;; esac
"$B" mount -t tmpfs -o size={ROOTFS_BYTES},mode=755 tmpfs /runtime
block_bytes=$("$B" stat -f -c %S /runtime)
blocks=$("$B" stat -f -c %b /runtime)
[ "$((block_bytes * blocks))" -eq {ROOTFS_BYTES} ]
cd /bootstrap/payloads
"$B" sha256sum -c /bootstrap/payloads.sha256 > /bootstrap/source-check.log
for segment in /bootstrap/payloads/*.cpio.gz; do
  "$B" gzip -dc "$segment" | (cd /runtime; "$B" cpio -idu)
done
"$B" printf '%s\\n' '{{"type":"bootstrap","stage":"extracted"}}'
cd /runtime
"$B" sha256sum -c /bootstrap/expanded.sha256 > /bootstrap/expanded-check.log
"$B" printf '%s\\n' '{{"type":"bootstrap","stage":"content_verified"}}'
"$B" sh /bootstrap/types.sh
"$B" printf '%s\\n' '{{"type":"bootstrap","stage":"verified","rootfs_limit_bytes":{ROOTFS_BYTES},"verified_files":{file_count},"segments":{segment_count}}}'
cd /
"$B" umount /proc
trap - EXIT
exec "$B" switch_root /runtime /init
'''.encode()


def write_cpio_entry(stream, inode, name, mode, size, chunks):
    encoded = name.encode() + b'\0'
    values = (inode, mode, 0, 0, 1, 0, size, 0, 0, 0, 0, len(encoded), 0)
    stream.write(b'070701' + b''.join(f'{value:08x}'.encode() for value in values))
    stream.write(encoded)
    stream.write(b'\0' * (-(110+len(encoded)) % 4))
    written = 0
    for block in chunks:
        stream.write(block)
        written += len(block)
    if written != size:
        raise ValueError(f'Input changed while writing {name}')
    stream.write(b'\0' * (-size % 4))


def segment_bytes(segment):
    with Path(segment['source']).open('rb') as source:
        source.seek(segment['offset'])
        remaining, hashed = segment['compressed_bytes'], hashlib.sha256()
        while remaining:
            block = source.read(min(1048576, remaining))
            if not block:
                raise ValueError('Source segment shortened during wrapping')
            remaining -= len(block)
            hashed.update(block)
            yield block
        if hashed.hexdigest() != segment['compressed_sha256']:
            raise ValueError('Source segment changed during wrapping')


def type_check_script(files, busybox='/bootstrap/bin/busybox'):
    checks = ['#!/bin/sh', 'set -eu', 'set -o pipefail', f'B={shlex.quote(busybox)}']
    for name, item in sorted(files.items()):
        quoted = shlex.quote('./'+name)
        if item['kind'] == 'symlink':
            checks += [f'[ -L {quoted} ]', f'[ "$("$B" readlink {quoted})" = {shlex.quote(item["target"])} ]']
        else:
            flag = '-f' if item['kind'] == 'file' else '-d'
            checks += [f'[ ! -L {quoted} ] && [ {flag} {quoted} ]']
    # Keep exact metadata checks but amortize process startup under TCG. Prefix
    # names with ./ so even an option-looking archive name remains an operand.
    expected = ''.join(f'{item["mode"]:o} ./{name}\n' for name, item in sorted(files.items())).encode()
    names = sorted(files)
    checks += ['actual=$(', '{']
    for offset in range(0, len(names), 128):
        operands = ' '.join(shlex.quote('./'+name) for name in names[offset:offset+128])
        checks += [f'"$B" stat -c "%a %n" -- {operands} || exit $?']
    checks += ['} | "$B" sha256sum', ')',
               f'[ "$actual" = "{hashlib.sha256(expected).hexdigest()}  -" ]']
    return ('\n'.join(checks)+'\n').encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--guest', type=Path, required=True)
    parser.add_argument('--overlay', type=Path)
    parser.add_argument('--overlay-sha256')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if bool(args.overlay) != bool(args.overlay_sha256):
        parser.error('An optional final guard overlay requires its explicit frozen SHA256')
    output = args.output.resolve()
    if output.exists():
        parser.error('Use a fresh output directory; preserve every prior fixture')
    base = (args.guest/'initramfs.cpio.gz').resolve(strict=True)
    kernel = (args.guest/'vmlinuz').resolve(strict=True)
    for path, expected in [(base, BASE_SHA256), (kernel, KERNEL_SHA256),
                           *([(args.overlay.resolve(strict=True), args.overlay_sha256)] if args.overlay else [])]:
        if not path.is_file() or path.is_symlink() or digest(path) != expected:
            parser.error(f'Frozen fixture mismatch: {path}')
    files, captured = {}, {}
    segments = inspect(base, files, captured)
    if len(segments) != 4:
        raise ValueError('The frozen v8 input must have four gzip/cpio members')
    if args.overlay:
        segments.extend(inspect(args.overlay.resolve(), files, captured))
    if not static_x64(captured['bin/busybox']):
        raise ValueError('Expected the already copied static x86_64 BusyBox; do not install another runtime')
    compiler = 'usr/share/sesame-compiler-p0/'
    frozen = json.loads(captured[compiler+'frozen.json'])
    if files[compiler+'MetaEditor64.exe']['sha256'] != frozen['compiler_sha256']:
        raise ValueError('Frozen compiler is missing or changed')
    for name, entry in frozen['includes'].items():
        if any(files[compiler+'Include/'+name][key] != value for key, value in entry.items()):
            raise ValueError('Frozen standard Include changed')
    for name in ('init', 'guest.py', compiler+'compile-guest.py', compiler+'Fixture.mq5'):
        if files[name]['kind'] != 'file' or not files[name]['bytes']:
            raise ValueError('Trusted runtime entry point is missing')
    regular = {name: entry for name, entry in files.items() if entry['kind'] == 'file'}
    rounded_bytes = sum((entry['bytes']+4095)//4096*4096 for entry in regular.values())
    if rounded_bytes > ROOTFS_BYTES - 256*1024**2:
        raise ValueError('The runtime leaves less than the required 256 MiB rootfs margin')
    manifest = {'purpose': 'Development fixture only; no redistribution approval', 'files': files}
    hashes = ''.join(f"{entry['sha256']}  {name}\n" for name, entry in sorted(regular.items())).encode()
    segments_hashes = ''.join(f"{entry['compressed_sha256']}  {i:03}.cpio.gz\n" for i, entry in enumerate(segments)).encode()
    init = trusted_init(len(regular), len(segments))
    tiny = {
        'init': (0o755, b'#!/bin/sh\nexec /bootstrap/bin/busybox sh /bootstrap/init.sh\n'),
        'bootstrap/bin/busybox': (0o755, captured['bin/busybox']),
        'bootstrap/init.sh': (0o755, init),
        'bootstrap/payloads.sha256': (0o644, segments_hashes),
        'bootstrap/expanded.sha256': (0o644, hashes),
        'bootstrap/types.sh': (0o755, type_check_script(files)),
        'bootstrap/manifest.json': (0o644, json.dumps(manifest, sort_keys=True).encode()),
    }
    expanded_bootstrap = sum(len(data) for _, data in tiny.values()) + sum(x['compressed_bytes'] for x in segments)
    if expanded_bootstrap > BOOTSTRAP_MAX_BYTES:
        raise ValueError('Bootstrap exceeds its independent 480 MiB content bound')
    output.mkdir(parents=True)
    (output/'trusted-init.sh').write_bytes(init)
    (output/'expanded-manifest.json').write_bytes(tiny['bootstrap/manifest.json'][1])
    archive = output/'initramfs.cpio.gz'
    with archive.open('wb') as raw, gzip.GzipFile(fileobj=raw, filename='', mode='wb', mtime=0, compresslevel=1) as stream:
        inode = 1
        for name in ('.', 'bin', 'bootstrap', 'bootstrap/bin', 'bootstrap/payloads', 'dev', 'proc', 'runtime'):
            write_cpio_entry(stream, inode, name, stat.S_IFDIR | 0o755, 0, ())
            inode += 1
        link = b'../bootstrap/bin/busybox'
        write_cpio_entry(stream, inode, 'bin/sh', stat.S_IFLNK | 0o777, len(link), (link,))
        inode += 1
        for name, (mode, data) in tiny.items():
            write_cpio_entry(stream, inode, name, stat.S_IFREG | mode, len(data), (data,))
            inode += 1
        for i, segment in enumerate(segments):
            write_cpio_entry(stream, inode, f'bootstrap/payloads/{i:03}.cpio.gz', stat.S_IFREG | 0o644,
                             segment['compressed_bytes'], segment_bytes(segment))
            inode += 1
        write_cpio_entry(stream, 0, 'TRAILER!!!', 0, 0, ())
    shutil.copyfile(kernel, output/'vmlinuz')
    evidence = {'purpose': 'Finite-rootfs compiler bootstrap; not a product or distribution approval',
                'input_initrd_sha256': BASE_SHA256, 'kernel_sha256': KERNEL_SHA256,
                'overlay_sha256': args.overlay_sha256, 'segments': segments,
                'bootstrap_content_bytes': expanded_bootstrap, 'bootstrap_max_content_bytes': BOOTSTRAP_MAX_BYTES,
                'runtime_regular_files': len(regular), 'runtime_file_pages_bytes': rounded_bytes,
                'runtime_rootfs_bytes': ROOTFS_BYTES, 'runtime_nominal_free_bytes': ROOTFS_BYTES-rounded_bytes,
                'trusted_init_sha256': digest(output/'trusted-init.sh'),
                'expanded_manifest_sha256': digest(output/'expanded-manifest.json'),
                'archive_bytes': archive.stat().st_size, 'archive_sha256': digest(archive),
                'compiler_task_budget_changed': False, 'qemu_arguments_changed': False,
                'runtime_validation': 'NOT_RUN'}
    (output/'sources.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    print(json.dumps(evidence))


if __name__ == '__main__':
    main()
