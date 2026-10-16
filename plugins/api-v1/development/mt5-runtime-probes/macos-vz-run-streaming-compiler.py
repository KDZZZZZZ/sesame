#!/usr/bin/env python3
"""Two controlled Mac P0 compiles with the actual Node snapshot producer.

No compiler or source is mounted in the VM. This reuses the verified private
QEMU and Seatbelt template; it is neither a runtime installer nor a backend.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import signal
import stat
import subprocess
import threading
import time

PREPARED_SHA = 'a0caeddb5998436548ee88e455b65d2772c5a48667dc637e571202eda30ba0fc'
# The post-sign identity, not a pre-sign executable digest.
QEMU_SHA = '0664e9d494a77e63676ea99404054c2641ed392e53cf7ac40c6dfbbedf6edb21'
FROZEN = (
    ('vmlinuz', 17000840, '5cd6898e71f247e0dd820bcbae669a5b5d35bd736cbe3c2e6834ff2381525e5d'),
    ('initramfs.cpio.gz', 1174301, '0b02ccbe93d8dc6eda5aed6c5133312ecfae7a51053938b00a797e679159abdc'),
    ('runtime.squashfs', 437280768, 'b822f45ff0cac1e9b26e218cdbd3677d8793fe261214d335a9cfb2f736e38882'),
)
EXPECTED_BOOT = dict(format='squashfs', read_only=True, host_verified_image_sha256=FROZEN[2][2],
                     build_verified_files=4659, run_tmpfs_bytes=16777216)
CHUNK = 64 * 1024


def require(value, message):
    if not value:
        raise RuntimeError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def ordinary(path, root, readonly=False):
    info = path.lstat()
    require(path.resolve(strict=True) == path and path.is_relative_to(root)
            and stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid(),
            'Task input is not an owned ordinary file: ' + str(path))
    if readonly:
        require(stat.S_IMODE(info.st_mode) == 0o444, 'Input must be mode 0444: ' + str(path))
    return tuple(getattr(info, name) for name in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def policy_text(original, prepared, inputs, scratch, directory):
    # Replace only the two already-tested directory rules. Never extend to the
    # compiler source directory, task root, user home, or a package-manager tree.
    for old, new, count in ((prepared['inputs'], str(inputs), 1), (prepared['scratch'], str(scratch), 2)):
        before, after = f'(subpath {json.dumps(old)})', f'(subpath {json.dumps(new)})'
        require(original.count(before) == count, 'Unexpected original Seatbelt template')
        original = original.replace(before, after)
    return original + f'\n(allow file-read-metadata (require-all (literal {json.dumps(str(directory))}) (vnode-type DIRECTORY)))\n'


def command(binary, runtime, inputs, profile):
    share = runtime / 'share/qemu'
    nodes = [dict(driver='file', **{'node-name': 'runtime-root-file', 'filename': str(inputs / 'runtime.squashfs'),
                                   'read-only': True, 'auto-read-only': False}),
             dict(driver='raw', **{'node-name': 'runtime-root', 'file': 'runtime-root-file',
                                  'read-only': True, 'auto-read-only': False})]
    args = ['/usr/bin/sandbox-exec', '-f', str(profile), str(binary), '-run-with', 'exit-with-parent=on',
            '-no-user-config', '-machine', 'q35', '-accel', 'tcg,thread=multi', '-cpu', 'max', '-smp', '2', '-m', '4096',
            '-nodefaults', '-no-reboot', '-display', 'none', '-monitor', 'none', '-serial', 'none',
            '-chardev', 'stdio,id=console,signal=off', '-device', 'virtio-serial-pci', '-device', 'virtconsole,chardev=console',
            '-nic', 'none', '-L', str(share), '-bios', str(share / 'bios-256k.bin'),
            '-kernel', str(inputs / 'vmlinuz'), '-initrd', str(inputs / 'initramfs.cpio.gz'),
            '-append', 'console=hvc0 rdinit=/init quiet panic=-1 sesame-p0=1']
    for node in nodes:
        args.extend(['-blockdev', json.dumps(node, separators=(',', ':'))])
    return args + ['-device', 'virtio-blk-pci,drive=runtime-root']


class Channel:
    """A bounded response queue; producer forwarding never buffers a full file."""
    def __init__(self, process, directory):
        self.process, self.events = process, queue.Queue(maxsize=32)
        self.failure, self.bootstrap, self.snapshot = None, [], []
        self.threads = []
        for label, stream in (('stdout', process.stdout), ('stderr', process.stderr)):
            worker = threading.Thread(target=self.read, args=(label, stream, directory), daemon=True)
            worker.start()
            self.threads.append(worker)

    def read(self, label, stream, directory):
        total = 0
        try:
            with (directory / (label + '.log')).open('xb') as log:
                maximum = 48 * 1024**2 if label == 'stdout' else 1024**2
                while True:
                    line = stream.readline(maximum + 1)
                    if not line:
                        break
                    total += len(line)
                    require(len(line) <= maximum and total <= 128 * 1024**2, 'Guest output exceeded its bound')
                    log.write(line)
                    if b'Initramfs unpacking failed' in line:
                        raise RuntimeError('Kernel reported failed initramfs extraction')
                    if label == 'stdout':
                        try:
                            value = json.loads(line)
                        except (UnicodeDecodeError, json.JSONDecodeError):
                            continue
                        require(isinstance(value, dict), 'Unexpected guest JSON value')
                        self.events.put_nowait(value)
        except Exception as error:
            self.failure = str(error)

    def receive(self, predicate, deadline):
        while time.monotonic() < deadline:
            require(not self.failure, self.failure)
            try:
                event = self.events.get(timeout=min(0.1, max(0.001, deadline - time.monotonic())))
            except queue.Empty:
                require(self.process.poll() is None, 'Guest exited before the expected response')
                continue
            require(event.get('type') not in ('error', 'boot_error'), 'Guest error: ' + str(event.get('message')))
            if event.get('type') == 'bootstrap':
                self.bootstrap.append(event)
            if event.get('type') == 'snapshot_ready':
                self.snapshot.append(event)
            if predicate(event):
                return event
        raise TimeoutError('One deadline includes snapshot transfer and compilation')


def stop(process):
    if process is None:
        return None
    started = time.monotonic()
    forced = process.poll() is None
    if forced:
        # Each Popen is a private session. No unrelated process is signaled.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=2)
    return dict(pid=process.pid, exit_code=process.returncode, forced=forced,
                wait_ms=round((time.monotonic() - started) * 1000, 3))


def stream_snapshot(channel, node, producer, module, snapshot, environment, directory):
    header = dict(action='compile_snapshot', id='stream-' + snapshot['kind'],
                  manifest_sha256=snapshot['manifest_sha256'], compilerBudget='macos')
    state = dict(wire_bytes=0, max_forward_chunk=0, complete=False)
    started = time.monotonic()
    deadline = started + 300
    child = subprocess.Popen([node, str(producer), str(module), snapshot['directory'], snapshot['manifest_sha256']],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, cwd=directory,
                             bufsize=CHUNK, start_new_session=True)
    errors, worker = [], None

    def forward():
        try:
            channel.process.stdin.write((json.dumps(header, separators=(',', ':')) + '\n').encode())
            channel.process.stdin.flush()
            while True:
                piece = child.stdout.read(CHUNK)
                if not piece:
                    break
                require(time.monotonic() < deadline, 'Snapshot transfer deadline elapsed')
                channel.process.stdin.write(piece)
                channel.process.stdin.flush()
                state['wire_bytes'] += len(piece)
                state['max_forward_chunk'] = max(state['max_forward_chunk'], len(piece))
                require(state['wire_bytes'] <= 720 * 1024**2, 'Snapshot wire budget exceeded')
            require(child.wait(timeout=max(0.001, deadline - time.monotonic())) == 0, 'Snapshot producer failed')
            state['complete'] = True
        except Exception as error:
            errors.append(str(error))
            channel.failure = str(error)

    try:
        worker = threading.Thread(target=forward, daemon=True)
        worker.start()
        raw = channel.receive(lambda event: event.get('id') == header['id'] and 'exitCode' in event, deadline)
        worker.join(timeout=max(0.001, deadline - time.monotonic()))
        require(not worker.is_alive() and not errors and state['complete'], 'Producer did not complete before the result')
        state['wall_ms'] = round((time.monotonic() - started) * 1000, 3)
        require(state['wall_ms'] <= 300000, 'Transfer plus compilation exceeded the Mac budget')
        return raw, state
    finally:
        state['producer_cleanup'] = stop(child)
        # The trusted wrapper emits at most one short error, never input bytes.
        diagnostic = child.stderr.read(65537)
        require(len(diagnostic) <= 65536, 'Producer diagnostics exceeded the bound')
        (directory / (header['id'] + '-producer.log')).write_bytes(diagnostic)
        if worker and worker.is_alive():
            # Killing only Node cannot unblock a writer inside the QEMU pipe.
            stop(channel.process)
            worker.join(timeout=2)
        child.stdout.close()
        child.stderr.close()


def validate(raw, snapshot, transfer, state):
    require(raw.get('id') == 'stream-' + snapshot['kind'] and raw.get('exitCode') == 0
            and raw.get('stopped') is None, 'Compiler request did not finish successfully')
    require(transfer.get('manifest_sha256') == snapshot['manifest_sha256'] and transfer.get('file_count') == 9
            and transfer.get('total_bytes') == snapshot['total_bytes'] and transfer.get('wire_bytes') == state['wire_bytes'],
            'Guest did not acknowledge the exact streamed snapshot')
    require(0 <= transfer['transfer_ms'] <= state['wall_ms'] <= 300000, 'Invalid transfer/task timing')
    limits = {'memory.max': '2147483648', 'memory.swap.max': '0', 'pids.max': '256', 'cpu.max': '200000 100000'}
    metrics = raw.get('metrics', {})
    require(all(metrics.get(key) == value for key, value in limits.items()), 'Compiler resource contract changed')
    require(re.search(r'(^|\n)populated 0(\n|$)', metrics.get('cgroup.events', ''))
            and re.search(r'(^|\n)oom_kill 0(\n|$)', metrics.get('memory.events', ''))
            and 0 <= raw['cleanup_ms'] <= 2000, 'Compiler did not clean its task cgroup')
    success = snapshot['kind'] == 'success'
    files = raw.get('files', {})
    require(set(files) == ({'Strategy.ex5', 'compile-result.json'} if success else {'compile-result.json'}),
            'Unexpected compiler outputs')
    compiled = json.loads(base64.b64decode(files['compile-result.json'], validate=True))
    require(compiled.get('success') is success, 'Unexpected compile result')
    message = 'Result: 0 errors, 0 warnings' if success else "undeclared identifier 'missing_compile_token'"
    require(message in compiled.get('diagnostics', ''), 'Expected compiler diagnostic missing')
    if success:
        artifact = base64.b64decode(files['Strategy.ex5'], validate=True)
        require(0 < len(artifact) <= 32 * 1024**2
                and compiled['ex5_sha256'] == 'sha256:' + hashlib.sha256(artifact).hexdigest(), 'Invalid EX5 artifact')
    else:
        require(compiled.get('ex5_sha256') is None, 'Failed compile returned an artifact')
    return dict(kind=snapshot['kind'], accepted=True, transfer=transfer, transport=state,
                compiled=compiled, metrics=metrics, cleanup_ms=raw['cleanup_ms'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('root', 'inputs', 'snapshots', 'snapshot-module', 'producer'):
        parser.add_argument('--' + name, type=Path, required=True)
    for name in ('snapshot-module-sha256', 'producer-sha256', 'output-prefix'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    require(os.uname().sysname == 'Darwin' and os.uname().machine == 'arm64', 'Authorized Mac host only')
    root = args.root.resolve(strict=True)
    require(root.name == 'sesame-p0-vz-_wdao4x5', 'Unexpected task root')
    require(re.fullmatch(r'[a-z0-9][a-z0-9-]{1,63}', args.output_prefix), 'Invalid new output directory')
    inputs = args.inputs.absolute()
    require(inputs.resolve(strict=True) == inputs and inputs.parent == root and inputs.name == 'guest-v16-streaming-compiler-v1',
            'Use the new exact guest directory')
    prepared_path = root / 'qemu-minimal-private-prep-evidence.json'
    require(digest(prepared_path) == PREPARED_SHA, 'Verified runtime evidence changed')
    prepared = json.loads(prepared_path.read_text())
    require(all(prepared.get(key) is True for key in ('pass', 'canary_pass', 'private_qemu_version_pass')),
            'Private runtime was not verified')
    runtime, binary = Path(prepared['runtime']), Path(prepared['binary'])
    require(runtime.resolve(strict=True) == runtime and runtime.is_relative_to(root)
            and binary.is_relative_to(runtime), 'Runtime escaped the task directory')
    for item in prepared['copied']:
        path = Path(item['destination'])
        ordinary(path, runtime)
        require(digest(path) == item['sha256'], 'Private runtime changed')
    require(digest(binary) == QEMU_SHA, 'Private signed QEMU changed')
    for item in prepared['firmware']:
        require(digest(runtime / 'share/qemu' / item['name']) == item['sha256'], 'Firmware changed')
    old_profile = Path(prepared['profile'])
    require(digest(old_profile) == prepared['profile_sha256'], 'Original Seatbelt profile changed')
    for path, expected in ((args.snapshot_module, args.snapshot_module_sha256), (args.producer, args.producer_sha256)):
        ordinary(path, root)
        require(re.fullmatch(r'[a-f0-9]{64}', expected) and digest(path) == expected, 'Producer source changed')
    identities = {}
    for name, length, expected in FROZEN:
        path = inputs / name
        identities[name] = ordinary(path, root, True)
        require(path.stat().st_size == length and digest(path) == expected, 'Guest artifact differs: ' + name)
    ordinary(args.snapshots, root)
    snapshots = json.loads(args.snapshots.read_text())
    require([item.get('kind') for item in snapshots] == ['success', 'error'], 'Exactly two controlled compiler cases required')
    for item in snapshots:
        path = Path(item['directory'])
        require(path.resolve(strict=True) == path and path.is_relative_to(root) and not path.is_relative_to(inputs),
                'Compiler snapshot must have its own physical task directory')
        manifest = path / 'manifest.json'
        ordinary(manifest, root)
        require(item['manifest_sha256'] == 'sha256:' + digest(manifest), 'Snapshot manifest differs')
        metadata = json.loads(manifest.read_text())
        require(len(metadata['files']) == 9 and metadata['compiler_sha256'] ==
                'sha256:c4641eda510ffea814c627c922ea19e9eef51a22ff1a7244cda31345736c1d2e', 'Unexpected controlled compiler')
        expected_source = ('2d8850ba7ebb28b60bbc024b30c6a96245d4695224cbb837414c422a66040523' if item['kind'] == 'success'
                           else '27aa75906d772150dd43984666d2a6c7d31141d4240b44fa0c0d3c6d11a6723e')
        require(metadata['files']['Experts/Strategy.mq5']['sha256'] == 'sha256:' + expected_source,
                'Unexpected controlled source')
        item['total_bytes'] = sum(value['bytes'] for value in metadata['files'].values())
    directory = root / args.output_prefix
    directory.mkdir(mode=0o700)
    scratch = directory / 'scratch'
    scratch.mkdir(mode=0o700)
    profile = directory / 'qemu.sb'
    profile.write_text(policy_text(old_profile.read_text(), prepared, inputs, scratch, directory))
    environment = {**prepared['environment'], 'HOME': str(scratch), 'TMPDIR': str(scratch), 'TMP': str(scratch), 'TEMP': str(scratch)}
    result = dict(scope='Controlled Mac P0 streamed compiler; not production/release acceptance', status='INCOMPLETE',
                  host={'kernel': os.uname().release, 'arch': os.uname().machine, 'uid': os.getuid()},
                  qemu_sha256=QEMU_SHA, producer_sha256=args.producer_sha256,
                  snapshot_module_sha256=args.snapshot_module_sha256, cases=[],
                  profile_sha256=digest(profile), original_profile_sha256=prepared['profile_sha256'],
                  policy='Verified template with exact new guest/scratch paths; no compiler source read grant',
                  network_regression='NOT_RUN', argv=command(binary, runtime, inputs, profile))
    vm, channel = None, None
    full = []
    started = time.monotonic()
    try:
        vm = subprocess.Popen(result['argv'], cwd=scratch, env=environment, stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=CHUNK, start_new_session=True)
        channel = Channel(vm, directory)
        result['ready'] = channel.receive(lambda event: event.get('type') == 'ready', started + 180)
        result['boot_ms'] = round((time.monotonic() - started) * 1000, 3)
        require(channel.bootstrap == [dict(type='bootstrap', stage='block_mounted', **EXPECTED_BOOT)], 'Bootstrap proof differs')
        for item in snapshots:
            raw, state = stream_snapshot(channel, '/opt/homebrew/bin/node', args.producer, args.snapshot_module,
                                         item, environment, directory)
            full.append(raw)
            matches = [event for event in channel.snapshot if event.get('id') == raw.get('id')]
            require(len(matches) == 1, 'Missing/duplicate snapshot acknowledgement')
            result['cases'].append(validate(raw, item, matches[0], state))
            (directory / 'results.json').write_text(json.dumps(result, indent=2))
        vm.stdin.write(b'{"action":"shutdown"}\n')
        vm.stdin.flush()
        vm.wait(timeout=15)
        require(vm.returncode == 0, 'Guest did not shut down cleanly')
        for name, _, expected in FROZEN:
            require(ordinary(inputs / name, root, True) == identities[name] and digest(inputs / name) == expected,
                    'Read-only guest artifact changed')
        result['status'] = 'PASS'
    except Exception as error:
        result['status'], result['error'] = 'FAIL', str(error)
    finally:
        result['cleanup'] = stop(vm)
        if channel:
            for worker in channel.threads:
                worker.join(timeout=2)
            if channel.failure:
                result['status'], result['reader_error'] = 'FAIL', channel.failure
            result['bootstrap'], result['snapshot_events'] = channel.bootstrap, channel.snapshot
        if vm:
            for stream in (vm.stdin, vm.stdout, vm.stderr):
                try:
                    stream.close()
                except OSError as error:
                    result.setdefault('pipe_close_errors', []).append(str(error))
        (directory / 'responses.json').write_text(json.dumps(full, indent=2))
        (directory / 'results.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(dict(status=result['status'], cases=len(result['cases']), directory=str(directory), error=result.get('error'))))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
