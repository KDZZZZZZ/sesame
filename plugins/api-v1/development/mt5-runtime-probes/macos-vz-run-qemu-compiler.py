#!/usr/bin/env python3
"""Mac development fixture: private QEMU under an already-verified host policy.

Only transports the common compiler requests. The unchanged shared JavaScript
validator must accept every returned response before any compile claim passes.
"""
import argparse
import datetime
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


def require(value, message):
    if not value:
        raise RuntimeError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def guest_contract(lock):
    storage = lock.get('storage_format', 'bounded_initramfs')
    require(storage in ('bounded_initramfs', 'readonly_squashfs'), 'Unexpected compiler storage format')
    names = ['vmlinuz', 'initramfs.cpio.gz']
    if storage == 'readonly_squashfs':
        names.append('runtime.squashfs')
    require([item['name'] for item in lock['files']] == names, 'Unexpected guest lock files')
    frozen = tuple((item['name'], item['bytes'], item['sha256']) for item in lock['files'])
    require(all(type(length) is int and length > 0 and re.fullmatch(r'[0-9a-f]{64}', sha)
                for name, length, sha in frozen), 'Invalid guest lock size or digest')
    expected = lock.get('bootstrap')
    require(isinstance(expected, dict), 'A replacement compiler guest requires a bootstrap contract')
    if storage == 'readonly_squashfs':
        require(expected == {
            'format': 'squashfs', 'read_only': True,
            'host_verified_image_sha256': frozen[2][2],
            'build_verified_files': 4667, 'run_tmpfs_bytes': 16 * 1024 ** 2,
        }, 'Read-only block bootstrap differs from the frozen builder contract')
        require(type(expected['read_only']) is bool, 'Read-only must be a boolean')
    else:
        require(set(expected) == {'rootfs_limit_bytes', 'verified_files', 'segments'} and
                expected['rootfs_limit_bytes'] == 2 * 1024 ** 3 and
                all(type(expected[key]) is int and expected[key] > 0 for key in ('verified_files', 'segments')),
                'A replacement compiler guest requires its bounded bootstrap proof contract')
    return storage, frozen, expected


def block_arguments(inputs):
    # JSON serialization keeps commas and other pathname characters literal.
    return [
        '-blockdev', json.dumps({'driver': 'file', 'node-name': 'runtime-root-file',
                                'filename': str(inputs / 'runtime.squashfs'),
                                'read-only': True, 'auto-read-only': False}, separators=(',', ':')),
        '-blockdev', json.dumps({'driver': 'raw', 'node-name': 'runtime-root',
                                'file': 'runtime-root-file', 'read-only': True,
                                'auto-read-only': False}, separators=(',', ':')),
        '-device', 'virtio-blk-pci,drive=runtime-root',
    ]


def frozen_identity(path):
    info = path.lstat()
    require(path.resolve() == path and stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
            'Compiler input must be an ordinary file with no symbolic or hard links')
    require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o444,
            'Compiler input must be task-owned and mode 0444')
    return {key: getattr(info, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')}


def check_bootstrap(events, expected, storage):
    stages = ['block_mounted'] if storage == 'readonly_squashfs' else ['extracted', 'content_verified', 'verified']
    require([item.get('stage') for item in events] == stages, 'Trusted bootstrap stages missing or out of order')
    require(events[-1] == {'type': 'bootstrap', 'stage': stages[-1], **expected},
            'Trusted bootstrap verification differs from the frozen guest contract')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--cases', required=True, type=Path)
    parser.add_argument('--policy-evidence', required=True, type=Path)
    parser.add_argument('--prepared', type=Path)
    parser.add_argument('--guest-lock', type=Path)
    parser.add_argument('--output-prefix', default='qemu-compiler-v8')
    args = parser.parse_args()
    root = args.root.resolve()
    require(os.uname().sysname == 'Darwin' and os.uname().machine == 'arm64',
            'This fixture is for the authorized Mac test host')
    require(root.name.startswith('sesame-p0-vz-'), 'Use the task temporary directory')
    require(args.cases.resolve().is_relative_to(root), 'Cases must be in the task directory')
    require(args.policy_evidence.resolve().is_relative_to(root), 'Policy evidence must be task-local')
    prepared_path = (args.prepared or root / 'qemu-private-prep-evidence.json').resolve()
    require(prepared_path.is_relative_to(root), 'Private preparation evidence must be task-local')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{1,63}', args.output_prefix), 'Invalid evidence prefix')
    cold_started = time.monotonic()
    prepared = json.loads(prepared_path.read_text())
    policy = json.loads(args.policy_evidence.read_text())
    require(policy.get('pass') is True and policy.get('canary_pass') is True
            and policy.get('private_qemu_version_pass') is True,
            'File, network and exec host-policy controls and QEMU version must pass first')
    directory = Path(prepared['directory']).resolve()
    require(directory.is_relative_to(root), 'Private runtime must be task-local')
    binary = Path(prepared['binary']).resolve()
    runtime = Path(prepared['runtime']).resolve()
    scratch = Path(prepared['scratch']).resolve()
    profile = Path(policy['profile']).resolve()
    require(all(path.is_relative_to(directory) for path in (binary, runtime, scratch, profile)),
            'Private runtime path escapes its directory')
    require(digest(profile) == policy['profile_sha256'], 'Validated host policy changed')
    for item in prepared['copied']:
        target = Path(item['destination']).resolve()
        require(target.is_relative_to(runtime) and digest(target) == item['sha256'],
                'Relocated runtime changed: ' + target.name)
    share = runtime / 'share/qemu'
    for item in prepared['firmware']:
        require(digest(share / item['name']) == item['sha256'], 'Private firmware changed')
    inputs = root / 'compiler-v8'
    frozen = (
        ('vmlinuz', 17000840, '5cd6898e71f247e0dd820bcbae669a5b5d35bd736cbe3c2e6834ff2381525e5d'),
        ('initramfs.cpio.gz', 472822214, '14424e8e5f015d1fee242f7c194f32b993605ce463912153679133a736e5dc54'),
    )
    expected_bootstrap = None
    storage_format = 'legacy_initramfs'
    if args.guest_lock:
        lock_path = args.guest_lock.resolve()
        require(lock_path.is_relative_to(root), 'Guest lock must be task-local')
        lock = json.loads(lock_path.read_text())
        inputs = (root / lock['directory']).resolve()
        require(inputs.parent == root and inputs == Path(prepared['inputs']).resolve(),
                'Guest lock must match the exact input directory allowed by the validated policy')
        storage_format, frozen, expected_bootstrap = guest_contract(lock)
    identities = {}
    if storage_format == 'readonly_squashfs':
        require(inputs.resolve() == inputs and inputs.stat().st_uid == os.getuid()
                and stat.S_IMODE(inputs.stat().st_mode) == 0o700, 'Block inputs must stay in a task-owned 0700 directory')
        identities = {name: frozen_identity(inputs / name) for name, _, _ in frozen}
    for name, length, expected in frozen:
        require((inputs / name).stat().st_size == length and digest(inputs / name) == expected,
                'Frozen compiler guest mismatch: ' + name)
    host_verification_ms = (time.monotonic() - cold_started) * 1000
    payload = json.loads(args.cases.read_text())
    require(payload['hostPlatform'] == 'darwin', 'Original Mac compiler budget must be explicit')
    baseline = payload.get('suite') == 'compiler-baseline-v1'
    require(payload.get('suite') in (None, 'compiler-baseline-v1'), 'Unexpected compiler fixture suite')
    names = ['compile-success', 'compile-error']
    if baseline:
        names += ['guest-seccomp', 'block-readonly', 'gnu-bash-semantics', 'npm-version', 'offline-npx-stdio']
    require([item['name'] for item in payload['cases']] == names, 'Unexpected controlled compiler/baseline fixtures')
    for item in payload['cases']:
        request = item['request']
        require(request['id'] == item['name'], 'Case/response identity differs')
        if item['name'].startswith('compile-'):
            require(request['timeout'] == 300 and request['compilerBudget'] == 'macos'
                    and request['profile'] == 'compiler' and request['files'] == {},
                    'Unexpected compiler request budget/profile/files')
        else:
            require(request.get('profile', 'research') == 'research' and 'compilerBudget' not in request
                    and request['timeout'] == (15 if item['name'] in ('guest-seccomp', 'block-readonly') else 60),
                    'Unexpected research baseline resource profile or deadline')
    command = [
        '/usr/bin/sandbox-exec', '-f', str(profile), str(binary),
        '-run-with', 'exit-with-parent=on',
        '-no-user-config',
        '-machine', 'q35', '-accel', 'tcg,thread=multi', '-cpu', 'max', '-smp', '2', '-m', '4096',
        '-nodefaults', '-no-reboot', '-display', 'none', '-monitor', 'none', '-serial', 'none',
        '-chardev', 'stdio,id=console,signal=off', '-device', 'virtio-serial-pci',
        '-device', 'virtconsole,chardev=console', '-nic', 'none',
        '-L', str(share), '-bios', str(share / 'bios-256k.bin'),
        '-kernel', str(inputs / 'vmlinuz'), '-initrd', str(inputs / 'initramfs.cpio.gz'),
        '-append', 'console=hvc0 rdinit=/init quiet panic=-1 sesame-p0=1',
    ]
    if storage_format == 'readonly_squashfs':
        command.extend(block_arguments(inputs))
    result = {
        'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'scope': 'Controlled Mac compiler feasibility; not production or release acceptance',
        'host': {'platform': os.uname().sysname, 'arch': os.uname().machine,
                 'kernel': os.uname().release},
        'private_runtime': str(runtime), 'profile': str(profile),
        'profile_sha256': policy['profile_sha256'], 'policy_evidence_sha256': digest(args.policy_evidence),
        'cases_sha256': digest(args.cases), 'common_validator_sha256': payload['common_validator_sha256'],
        'suite': payload.get('suite', 'compile-only'),
        'guest': [{'name': name, 'bytes': size, 'sha256': sha} for name, size, sha in frozen],
        'guest_directory': str(inputs), 'prepared_evidence_sha256': digest(prepared_path),
        'expected_bootstrap': expected_bootstrap, 'bootstrap_events': [],
        'storage_format': storage_format,
        'host_runtime_and_input_verification_ms': host_verification_ms,
        'measurement': 'Existing private bundle; verification, new VM boot and first compile; no guest prewarming',
        'argv': command, 'cases': [], 'transport_complete': False,
        'all_compile_fixtures_pass': False, 'validation': 'PENDING_COMMON_JS_VALIDATOR',
        'existing_lima_modified': False,
    }
    if storage_format == 'readonly_squashfs':
        result['host_verified_runtime_image'] = {
            'name': frozen[2][0], 'bytes': frozen[2][1], 'sha256': frozen[2][2],
            'method': 'complete_sha256_before_launch', 'mode': '0444',
            'identity_before': identities['runtime.squashfs'],
            'guest_write_boundary': 'fixed_readonly_block_graph_and_unchanged_Seatbelt',
        }
    evidence_path = root / (args.output_prefix + '-evidence.json')
    full_path = root / (args.output_prefix + '-full.json')
    require(not evidence_path.exists() and not full_path.exists(), 'Retain previous compiler evidence')
    events = queue.Queue()
    logs = {'stdout': [], 'stderr': []}
    started = time.monotonic()
    process = None
    readers = []

    def interrupted(number, _frame):
        raise RuntimeError('Controlled host runner interrupted by signal ' + str(number))

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)

    def read(stream, channel):
        for line in stream:
            logs[channel].append(line)
            if channel == 'stdout':
                try:
                    value = json.loads(line.strip())
                    if isinstance(value, dict):
                        events.put(value)
                except json.JSONDecodeError:
                    pass

    def receive(predicate, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                item = events.get(timeout=min(.1, max(.001, deadline - time.monotonic())))
            except queue.Empty:
                if process.poll() is not None:
                    raise RuntimeError('Private QEMU exited before response: ' + str(process.returncode))
                continue
            if item.get('type') in ('error', 'boot_error'):
                raise RuntimeError('Guest supervisor: ' + item.get('message', 'unknown error'))
            if item.get('type') == 'bootstrap':
                result['bootstrap_events'].append(item)
            if predicate(item):
                return item
        raise TimeoutError('Controlled guest response deadline exceeded')

    def send(value):
        process.stdin.write(json.dumps(value, separators=(',', ':')) + '\n')
        process.stdin.flush()

    try:
        process = subprocess.Popen(command, cwd=scratch, env=prepared['environment'],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, errors='replace', bufsize=1, start_new_session=True)
        result['qemu_pid'] = process.pid
        readers = [threading.Thread(target=read, args=(process.stdout, 'stdout'), daemon=True),
                   threading.Thread(target=read, args=(process.stderr, 'stderr'), daemon=True)]
        for thread in readers:
            thread.start()
        result['ready'] = receive(lambda item: item.get('type') == 'ready', 120)
        result['guest_ready_ms'] = (time.monotonic() - started) * 1000
        require('Initramfs unpacking failed' not in ''.join(logs['stdout']),
                'Guest readiness followed an initramfs unpack failure')
        if expected_bootstrap is not None:
            check_bootstrap(result['bootstrap_events'], expected_bootstrap, storage_format)
            if storage_format == 'readonly_squashfs':
                result['build_manifest_bound_to_host_verified_image'] = True
            else:
                result['complete_runtime_manifest_verified'] = True
        for case in payload['cases']:
            invoked = time.monotonic()
            send(case['request'])
            # Transport slack does not extend the guest deadline. The common
            # validator independently rejects task wall time above 300 seconds.
            response = receive(lambda item: item.get('id') == case['request']['id']
                               and 'exitCode' in item, case['request']['timeout'] + 10)
            response['wall_ms'] = (time.monotonic() - invoked) * 1000
            result['cases'].append({'name': case['name'], 'request': case['request'], 'response': response})
            if len(result['cases']) == 1:
                result['host_verify_boot_first_compile_ms'] = (time.monotonic() - cold_started) * 1000
        result['transport_complete'] = True
        send({'action': 'shutdown'})
        process.wait(timeout=15)
        require(process.returncode == 0, 'QEMU shutdown returned an error')
        if storage_format == 'readonly_squashfs':
            for name, _, expected in frozen:
                require(frozen_identity(inputs / name) == identities[name] and digest(inputs / name) == expected,
                        'Read-only compiler input changed during execution: ' + name)
            result['host_verified_runtime_image']['identity_unchanged_after_run'] = True
            result['host_verified_runtime_image']['sha256_after_run'] = digest(inputs / 'runtime.squashfs')
    except Exception as error:
        result['error'] = str(error)
    finally:
        if process is not None:
            if process.poll() is None:
                stopped = time.monotonic()
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)
                    result['forced_helper_kill'] = True
                result['helper_stop_ms'] = (time.monotonic() - stopped) * 1000
            result['helper_exit_code'] = process.returncode
            for thread in readers:
                thread.join(timeout=2)
            for pipe in (process.stdin, process.stdout, process.stderr):
                pipe.close()
        result['total_ms'] = (time.monotonic() - started) * 1000
        result['stderr_tail'] = ''.join(logs['stderr'])[-1500:]
        evidence_path.write_text(json.dumps(result, indent=2))
        full_path.write_text(json.dumps({'evidence': result, **logs}, indent=2))
    print(json.dumps({'evidence_file': str(evidence_path), 'full_file': str(full_path),
                      'guest_ready_ms': result.get('guest_ready_ms'),
                      'transport_complete': result['transport_complete'], 'case_count': len(result['cases']),
                      'helper_exit_code': result.get('helper_exit_code'), 'error': result.get('error'),
                      'stderr_tail': result['stderr_tail'], 'validation': result['validation']}))
    return 0 if result['transport_complete'] and not result.get('error') else 1


if __name__ == '__main__':
    raise SystemExit(main())
