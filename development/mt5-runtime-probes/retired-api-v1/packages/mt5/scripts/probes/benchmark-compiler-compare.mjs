// Controlled same-host compiler comparison helpers. Never install/update a runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { availableParallelism } from 'node:os';
import { createInterface } from 'node:readline';
import { compileNative, fileManifest } from '../../backend/native.js';
import { execute as executeCompiler } from '../../backend/compiler-worker.js';
import { digest as nativeDigest } from '../../backend/support.js';
import { buildCompileCases } from './compile-cases.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = Object.freeze({
  compiler: 'c4641eda510ffea814c627c922ea19e9eef51a22ff1a7244cda31345736c1d2e',
  includeManifest: '4a0462183e1bcec7d6d089536635bc00833729659746e0fb5b767785de868941',
  source: {
    success: '2d8850ba7ebb28b60bbc024b30c6a96245d4695224cbb837414c422a66040523',
    error: '27aa75906d772150dd43984666d2a6c7d31141d4240b44fa0c0d3c6d11a6723e',
  },
});

// Match the builder's Python json.dumps(..., sort_keys=True) for this ASCII-only
// manifest of paths, byte counts and SHA256 strings.
const manifestJson = value => value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}: ${manifestJson(value[key])}`).join(', ')}}`
  : JSON.stringify(value);

export async function readFrozenFixture(input) {
  const root = resolve(input);
  const frozen = JSON.parse(await readFile(join(root, 'frozen.json'), 'utf8'));
  const editor = join(root, 'MetaEditor64.exe');
  assert.equal(sha256(await readFile(editor)), expected.compiler, 'Frozen compiler mismatch');
  assert.equal(frozen.compiler_sha256, expected.compiler);
  assert.equal(frozen.include_manifest_sha256, expected.includeManifest);
  assert.equal(sha256(manifestJson(frozen.includes)), expected.includeManifest);
  assert.equal(Object.keys(frozen.includes).length, 7);
  for (const [name, metadata] of Object.entries(frozen.includes)) {
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..') && !/[\\:]/.test(name));
    const bytes = await readFile(join(root, 'Include', name));
    assert.equal(bytes.length, metadata.bytes, name);
    assert.equal(sha256(bytes), metadata.sha256, name);
  }
  const source = await readFile(join(root, 'Fixture.mq5'), 'utf8');
  assert.equal(sha256(source), expected.source.success);
  assert.equal(sha256(source.replace('return INIT_SUCCEEDED;', 'return missing_compile_token;')), expected.source.error);
  return { root, editor, source, frozen };
}

/** Prepare an immutable-input build before timing the unchanged production API. */
export async function prepareLegacyBuild(fixture, directory, kind) {
  assert.ok(kind === 'success' || kind === 'error');
  directory = resolve(directory);
  // No recursive/force replacement: every sample gets a new owned directory.
  await mkdir(directory);
  await mkdir(join(directory, '.compiler'));
  await mkdir(join(directory, 'Experts'));
  await copyFile(fixture.editor, join(directory, '.compiler/MetaEditor64.exe'));
  for (const name of Object.keys(fixture.frozen.includes)) {
    const target = join(directory, 'Include', name);
    await mkdir(join(target, '..'), { recursive: true });
    await copyFile(join(fixture.root, 'Include', name), target);
  }
  const source = kind === 'success' ? fixture.source : fixture.source.replace('return INIT_SUCCEEDED;', 'return missing_compile_token;');
  await writeFile(join(directory, 'Experts/Strategy.mq5'), source);
  const files = await fileManifest(directory);
  assert.equal(Object.keys(files).length, 9);
  assert.equal(files['.compiler/MetaEditor64.exe'].sha256, `sha256:${expected.compiler}`);
  assert.equal(files['Experts/Strategy.mq5'].sha256, `sha256:${expected.source[kind]}`);
  const manifestText = JSON.stringify({ compiler_sha256: files['.compiler/MetaEditor64.exe'].sha256, files }, null, 2);
  await writeFile(join(directory, 'manifest.json'), manifestText);
  return { directory, kind, editor: join(directory, '.compiler/MetaEditor64.exe'), manifest_sha256: nativeDigest(manifestText) };
}

/**
 * Actual Windows compileNative -> WSL worker -> compileInWSL -> compileLinux.
 * No replacement executable, mount override or mutation of the WSL distribution.
 * Wine 9 vs guest Wine 11.18 is a recorded confounder, not a backend-only claim.
 */
export async function withTemporaryRoot(temporaryRoot, action) {
  const root = resolve(temporaryRoot);
  await mkdir(root, { recursive: true });
  const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  // This standalone sequential harness restores its own process environment.
  // No Windows user/machine setting or shared shell environment is changed.
  process.env.TEMP = process.env.TMP = root;
  try { return await action(root); }
  finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

export async function runLegacyCompile(build, { temporaryRoot = join(build.directory, 'temp') } = {}) {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.MT5AGENT_WSL_DISTRO ?? 'MT5Agent', 'MT5Agent');
  const evidence = {
    backend: 'standalone MT5 plugin development WSL compiler', case: build.kind,
    budget: { compiler_ms: 300000, worker_ms: 330000, controller_ms: 600000, memory_bytes: 2147483648, swap_bytes: 0, tasks: 256, cpu_percent: 200 },
    compiler_sha256: expected.compiler, source_sha256: expected.source[build.kind],
    include_manifest_sha256: expected.includeManifest, manifest_sha256: build.manifest_sha256,
    expected_observed: false, windows_temporary_root: resolve(temporaryRoot),
  };
  const started = performance.now();
  try {
    const environment = { executeWorker: async (entry, payload, options) => {
      assert.equal(entry, 'backend/compiler-worker.js');
      const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs), ...(options.signal ? [options.signal] : [])]);
      return executeCompiler(payload, { signal, directory: resolve(temporaryRoot) });
    } };
    const result = await withTemporaryRoot(temporaryRoot,
      () => compileNative({ editor: build.editor }, build.directory, undefined, build.manifest_sha256, undefined, environment));
    evidence.wall_ms = performance.now() - started;
    evidence.compiler_success = result.success;
    const log = await readFile(join(build.directory, 'Experts/Strategy.log'));
    assert.equal(log.subarray(0, 2).toString('hex'), 'fffe');
    assert.equal(log.toString('utf16le').replace(/^\uFEFF/, ''), result.diagnostics);
    evidence.log_sha256 = sha256(log);
    evidence.log_bytes = log.length;
    if (build.kind === 'success') {
      assert.equal(result.success, true, result.diagnostics);
      assert.match(result.diagnostics, /Result: 0 errors, 0 warnings/);
      const artifact = await readFile(join(build.directory, 'Experts/Strategy.ex5'));
      assert.ok(artifact.length > 0 && artifact.length <= 32 * 1024 * 1024);
      assert.equal(nativeDigest(artifact), result.ex5_sha256);
      evidence.ex5_sha256 = sha256(artifact);
      evidence.product_ex5_digest = result.ex5_sha256;
      evidence.ex5_bytes = artifact.length;
    } else {
      assert.equal(result.success, false);
      assert.match(result.diagnostics, /undeclared identifier 'missing_compile_token'/);
      assert.match(result.diagnostics, /Result: 1 errors, 0 warnings/);
      assert.equal(result.ex5_sha256, null);
      await assert.rejects(readFile(join(build.directory, 'Experts/Strategy.ex5')), { code: 'ENOENT' });
      evidence.ex5_sha256 = null;
      evidence.ex5_bytes = 0;
    }
    evidence.expected_observed = true;
  } catch (error) {
    evidence.wall_ms ??= performance.now() - started;
    evidence.error = error.stack || error.message;
  }
  await writeFile(join(build.directory, 'legacy-result.json'), JSON.stringify(evidence, null, 2));
  return evidence;
}

export function validateLauncherTermination(events, launcherBackend, termination) {
  assert.equal(termination.forced_termination, false, 'Forced helper termination is not accepted cleanup');
  assert.equal(termination.helper_exited, true, 'Native helper did not fully exit');
  const started = events.filter(event => event.launcher === 'started');
  const finished = events.filter(event => event.launcher === 'finished');
  assert.equal(started.length, 1, 'Exactly one native launcher start is required');
  assert.equal(finished.length, 1, 'Exactly one native launcher finished event is required');
  assert.ok(events.indexOf(finished[0]) > events.indexOf(started[0]), 'Launcher cleanup must follow its start');
  assert.equal(started[0].backend, launcherBackend, 'Launcher changed the requested backend');
  assert.equal(started[0].appcontainer, launcherBackend === 'appcontainer');
  const result = finished[0];
  assert.equal(result.backend, launcherBackend);
  assert.equal(termination.helper_exit_signal, null);
  assert.equal(termination.helper_exit_code, result.exit_code);
  assert.equal(result.job_empty, true, 'The VM Job must be empty');
  assert.equal(result.held_processes_exited, true, 'Held VM process handles must be signaled');
  assert.ok(Number.isFinite(result.first_job_kill_to_empty_ms) && result.first_job_kill_to_empty_ms >= 0 && result.first_job_kill_to_empty_ms <= 2000,
    'The complete VM Job must terminate within two seconds of the first kill');
  assert.equal(result.scratch_deleted, true);
  assert.equal(result.profile_deleted, true);
  return { accepted: true, backend: launcherBackend, ...termination, finished: result };
}

/** Close the control channel first so the native owner can collect cleanup proof. */
export async function closeNativeLauncher(child, timeoutMs = 30000) {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000);
  const started = performance.now();
  let closed = child.exitCode !== null || child.signalCode !== null;
  closed &&= child.stdout.readableEnded && child.stderr.readableEnded;
  let resolveClose;
  const complete = new Promise(done => { resolveClose = done; });
  const onClose = () => { closed = true; resolveClose(); };
  if (!closed) child.once('close', onClose);
  const waitForClose = async duration => {
    if (closed) return;
    let timer;
    await Promise.race([complete, new Promise(done => { timer = setTimeout(done, duration); })]);
    clearTimeout(timer);
  };
  let forced = false;
  try {
    if (child.pid && !closed) {
      child.stdin.end();
      await waitForClose(timeoutMs);
      if (!closed) {
        forced = true;
        child.kill();
        await waitForClose(2000);
      }
    }
    return { forced_termination: forced, helper_exited: closed,
      helper_exit_code: child.exitCode, helper_exit_signal: child.signalCode,
      wait_ms: performance.now() - started };
  } finally { child.removeListener('close', onClose); }
}

export function validateCompilerReadiness(raw, expectedFiles, bootErrors = []) {
  assert.deepEqual(bootErrors, [], 'Kernel reported a failed initramfs; ready is not sufficient');
  assert.equal(raw.id, 'compiler-readiness');
  assert.equal(raw.exitCode, 0, raw.stderr || 'Compiler readiness request failed');
  assert.equal(raw.stopped, null);
  assert.equal(raw.stderr, '');
  assert.match(raw.metrics?.['cgroup.events'] ?? '', /(?:^|\n)populated 0(?:\n|$)/);
  const state = JSON.parse(raw.stdout);
  for (const [name, metadata] of Object.entries(expectedFiles)) {
    assert.deepEqual(state.files[name], metadata, `Compiler boot integrity mismatch: ${name}`);
  }
  return { accepted: true, verified_files: Object.keys(expectedFiles).length, ...state };
}

async function inspectCompilerGuest(vm, fixture, output) {
  const base = '/usr/share/sesame-compiler-p0';
  const expectedFiles = {};
  for (const [name, source] of [
    ['MetaEditor64.exe', fixture.editor], ['Fixture.mq5', join(fixture.root, 'Fixture.mq5')],
    ['frozen.json', join(fixture.root, 'frozen.json')],
    ['compile-guest.py', new URL('./compile-guest.py', import.meta.url)],
  ]) {
    const bytes = await readFile(source);
    expectedFiles[`${base}/${name}`] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  for (const [name, metadata] of Object.entries(fixture.frozen.includes)) expectedFiles[`${base}/Include/${name}`] = metadata;
  const script = `exec /usr/bin/python3 - <<'SESAME_P0_READINESS'\nimport hashlib,json,os\nfrom pathlib import Path\nfiles={}\nfor name in ${JSON.stringify(Object.keys(expectedFiles))}:\n    try:\n        path=Path(name)\n        with path.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()\n        files[name]={'bytes':path.stat().st_size,'sha256':digest}\n    except OSError as error: files[name]={'error':str(error)}\ncapacity={}\nfor name in ['/usr','/tmp','/work','/prefix']:\n    fs=os.statvfs(name)\n    capacity[name]={'block_size':fs.f_frsize,'total_bytes':fs.f_blocks*fs.f_frsize,'free_bytes':fs.f_bavail*fs.f_frsize,'inodes':fs.f_files,'free_inodes':fs.f_favail}\nprint(json.dumps({'files':files,'capacity':capacity,'meminfo':Path('/proc/meminfo').read_text(),'mountinfo':Path('/proc/self/mountinfo').read_text(),'cmdline':Path('/proc/cmdline').read_text()}))\nSESAME_P0_READINESS`;
  const raw = await vm.invoke({ id: 'compiler-readiness', profile: 'compiler', timeout: 120, script, files: {} });
  const record = { expectedFiles, bootErrors: vm.metadata.boot_errors, raw };
  await writeFile(join(output, 'guest-readiness.json'), JSON.stringify(record, null, 2));
  return validateCompilerReadiness(raw, expectedFiles, vm.metadata.boot_errors);
}

// The existing native launcher owns the selected host boundary/Job/socket lifetime. This small
// measurement client sends the same controlled protocol as benchmark.mjs; it
// does not add a backend or replace the production compiler implementation.
async function openGuest({ launcher, qemu, guest, output, accelerator, launcherBackend, launcherEvents, verboseBoot, temporaryRoot, memory = '4096', network = 'restricted', rootImage, rootImageSha256 }) {
  assert.ok(launcher, 'An explicit native launcher is required for the comparison');
  assert.ok(['1536', '4096'].includes(memory), 'Use a measured P0 guest memory profile');
  assert.ok(['restricted', 'unrestricted'].includes(network));
  assert.equal(Boolean(rootImage), Boolean(rootImageSha256), 'A root image and its SHA256 must be provided together');
  if (rootImage) assert.match(rootImageSha256, /^[a-f0-9]{64}$/);
  const hostCpuRate = Math.max(1, Math.floor(20000 / availableParallelism()));
  const vmArgs = ['-machine', 'q35', '-accel', accelerator === 'tcg' ? 'tcg,thread=multi' : 'whpx',
    '-cpu', 'max', '-smp', '2', '-m', memory, '-nodefaults', '-no-reboot', '-display', 'none', '-monitor', 'none',
    '-chardev', '@chardev', '-device', 'virtio-serial-pci', '-device', 'virtconsole,chardev=console',
    ...(network === 'unrestricted' ? ['-netdev', '@netdev', '-device', 'virtio-net-pci,netdev=network,mac=52:54:00:12:34:56'] : ['-nic', 'none']),
    '-kernel', '@input0', '-initrd', '@input1', '-append', `console=hvc0 rdinit=/init ${verboseBoot ? 'loglevel=7' : 'quiet'} panic=-1 sesame-p0=1${network === 'unrestricted' ? ' sesame-network=unrestricted' : ''}`,
    ...(rootImage ? ['-blockdev', '@root-file', '-blockdev', 'driver=raw,node-name=runtime-root,file=runtime-root-file,read-only=on,auto-read-only=off',
      '-device', 'virtio-blk-pci,drive=runtime-root'] : [])];
  const launchArgs = ['--launch', '--backend', launcherBackend, '--runtime', dirname(qemu), '--exe', qemu, '--transport', 'socket',
    ...(network === 'unrestricted' ? ['--network', 'unrestricted'] : []),
    ...(rootImage ? ['--root-image', resolve(rootImage), '--root-image-sha256', rootImageSha256] : []),
    '--memory-mib', memory === '4096' ? '8192' : '4096', '--cpu-rate', String(hostCpuRate), '--read-only', join(guest, 'vmlinuz'),
    '--read-only', join(guest, 'initramfs.cpio.gz'), '--', ...vmArgs];
  const log = createWriteStream(join(output, 'vm.log'));
  const started = performance.now();
  const child = spawn(launcher, launchArgs, { windowsHide: true, env: { ...process.env, TEMP: temporaryRoot, TMP: temporaryRoot }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => log.write(chunk));
  child.stderr.on('data', chunk => log.write(chunk));
  const lines = createInterface({ input: child.stdout });
  const diagnostics = createInterface({ input: child.stderr });
  diagnostics.on('line', line => {
    try { const event = JSON.parse(line); if (event.launcher || event.network_broker) launcherEvents.push(event); } catch { /* Other diagnostics remain in vm.log. */ }
  });
  let pending, ready, closing = false, failure;
  const bootErrors = [];
  const bootstrapEvents = [];
  const snapshotEvents = [];
  const readyPromise = new Promise((done, reject) => { ready = { done, reject }; });
  const fail = error => {
    if (closing) return;
    failure ??= error;
    ready.reject(error);
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; }
  };
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`Native launcher exited ${code ?? signal}; see vm.log`)));
  child.stdin.on('error', fail);
  child.stdout.on('error', fail);
  lines.on('error', fail);
  const bootTimer = setTimeout(() => fail(new Error('Guest boot exceeded 120 seconds')), 120000);
  lines.on('line', line => {
    if (/Initramfs unpacking failed:|Kernel panic|rootfs image is not initramfs/.test(line)) bootErrors.push(line);
    let value;
    try { value = JSON.parse(line); } catch { return; }
    if (value.type === 'bootstrap') bootstrapEvents.push(value);
    else if (value.type === 'boot_error') { clearTimeout(bootTimer); fail(new Error(value.message || 'Guest boot guard failed')); }
    else if (value.type === 'ready') { clearTimeout(bootTimer); ready.done(value); }
    else if (value.type === 'snapshot_ready') snapshotEvents.push(value);
    else if (value.type === 'output') { if (pending?.id === value.id) pending.onOutput?.(value); }
    else if (pending && (value.id === pending.id || value.type === 'error')) {
      const task = pending; pending = null; clearTimeout(task.timer); task.done(value);
    }
  });
  let closePromise;
  const close = () => closePromise ??= (async () => {
    closing = true; clearTimeout(bootTimer);
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Comparison closed')); pending = null; }
    const termination = await closeNativeLauncher(child);
    let evidence;
    try { evidence = validateLauncherTermination(launcherEvents, launcherBackend, termination); }
    catch (error) { evidence = { accepted: false, ...termination, error: error.stack || error.message }; }
    diagnostics.close(); lines.close(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    const logged = once(log, 'finish'); log.end(); await logged;
    await writeFile(join(output, 'launcher-events.json'), JSON.stringify(launcherEvents, null, 2));
    await writeFile(join(output, 'launcher-cleanup.json'), JSON.stringify(evidence, null, 2));
    return evidence;
  })();
  try {
    const info = await readyPromise;
    return {
      metadata: { launcher, launcherBackend, qemu, guest, accelerator, hostCpuRate, launchArgs, windows_temporary_root: temporaryRoot, boot_ms: performance.now() - started, guest_info: info, boot_errors: bootErrors, bootstrap_events: bootstrapEvents, snapshot_events: snapshotEvents },
      close,
      cancel(id) {
        assert.equal(pending?.id, id, 'Only the active probe can be canceled');
        child.stdin.write(`${JSON.stringify({ action: 'cancel', id })}\n`);
      },
      invoke(request, onOutput, frames) {
        if (failure) return Promise.reject(failure);
        assert.ok(!pending, 'Requests must remain sequential');
        // This Windows-native launcher harness has a 120s task / 130s host
        // watchdog. The Mac harness owns its separate 300s compiler profile.
        if (frames) assert.ok(request.action === 'compile_snapshot' && request.compilerBudget === 'standard');
        return new Promise((done, reject) => {
          const timer = setTimeout(() => {
            pending = undefined;
            reject(new Error(`Guest request exceeded 130 seconds: ${request.id}`));
            if (frames) child.stdin.end();
          }, 130000);
          pending = { id: request.id, done, reject, timer, onOutput };
          child.stdin.write(`${JSON.stringify(request)}\n`);
          if (frames) void (async () => {
            let encodedBytes = 0;
            for await (const frame of frames) {
              assert.equal(pending?.id, request.id, 'Frozen-input transfer outlived its active request');
              assert.ok(Buffer.isBuffer(frame) && frame.length > 0 && frame.length <= 1024 * 1024 && frame.at(-1) === 10);
              encodedBytes += frame.length;
              assert.ok(encodedBytes <= 768 * 1024 * 1024, 'Compiler transport exceeds its encoded-byte budget');
              // A write callback bounds queued data to one chunk even when TCG
              // decodes more slowly than the host reads a 115 MiB compiler.
              await new Promise((resolve, reject) => child.stdin.write(frame, error => error ? reject(error) : resolve()));
            }
          })().catch(error => { fail(error); child.stdin.end(); });
        });
      },
    };
  } catch (error) { await close(); throw error; }
}

// Share the same owner-managed launch/readiness/EOF cleanup for capacity probes.
export { openGuest as openCompilerGuest, inspectCompilerGuest };

export async function compareCompilers({ input, output, launcher, qemu, guest, accelerator = 'tcg', launcherBackend = 'appcontainer', preflightOnly = false, verboseBoot = false }) {
  assert.equal(process.platform, 'win32');
  assert.ok(['whpx', 'tcg'].includes(accelerator));
  assert.ok(['appcontainer', 'whpx'].includes(launcherBackend), 'launcher-backend must be appcontainer or whpx');
  assert.ok(launcherBackend !== 'whpx' || accelerator === 'whpx', 'The WHPX launcher requires --accel whpx');
  assert.ok(launcher, 'An explicit native launcher is required for the comparison');
  output = resolve(output);
  const fixture = await readFrozenFixture(input);
  await mkdir(output);
  const temporaryRoot = join(output, 'temp');
  await mkdir(temporaryRoot);
  const result = {
    purpose: 'Same-hardware product-path comparison; different Wine versions and input staging costs',
    platform: process.platform, arch: process.arch, node: process.version, preflight_only: preflightOnly,
    guest_wine: 'wine-11.18 (Staging)', compiler_sha256: expected.compiler, include_manifest_sha256: expected.includeManifest,
    plan: { cases: ['success', 'error'], pairs_per_case: 5, order: 'legacy then guest within each pair', input_preparation_timed: false, vm_boot_timed_separately: true },
    limitations: ['WSL Wine 9.0 differs from guest Wine 11.18', 'WSL production stages and verifies a private compiler copy for every request; guest uses its read-only preloaded frozen copy', 'Existing WSL and guest stay booted between samples; each compilation gets a fresh private Wine prefix', 'This is end-to-end path latency, not an isolated accelerator or CPU benchmark'],
    pairs: [], launcher_events: [], controlled_fixture_checks: 'NOT_COMPLETE',
  };
  const persist = () => writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2));
  let vm, failure;
  try {
    vm = await openGuest({ launcher: resolve(launcher), qemu: resolve(qemu), guest: resolve(guest), output, accelerator, launcherBackend, launcherEvents: result.launcher_events, verboseBoot, temporaryRoot });
    result.guest_launch = vm.metadata;
    await persist();
    result.guest_readiness = await inspectCompilerGuest(vm, fixture, output);
    await persist();
    if (!preflightOnly) result.legacy_runtime = execFileSync('wsl.exe', ['--distribution', 'MT5Agent', '--exec', '/bin/bash', '-lc',
      'uname -r; node --version; wine --version'], { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    for (const testCase of preflightOnly ? [] : await buildCompileCases()) {
      const kind = testCase.name.replace('compile-', '');
      for (let iteration = 0; iteration < 5; iteration++) {
        const sample = { case: kind, iteration, order: ['legacy', 'guest'] };
        result.pairs.push(sample);
        const legacy = await prepareLegacyBuild(fixture, join(output, `${kind}-${iteration}-legacy`), kind);
        sample.legacy = await runLegacyCompile(legacy, { temporaryRoot });
        await persist();
        assert.equal(sample.legacy.expected_observed, true, sample.legacy.error);
        const target = join(output, `${kind}-${iteration}-guest`);
        await mkdir(target);
        const before = performance.now();
        const raw = { ...await vm.invoke(testCase.request()), wall_ms: performance.now() - before };
        await writeFile(join(target, 'raw.json'), JSON.stringify(raw, null, 2));
        sample.guest = testCase.validate(raw);
        for (const [name, data] of Object.entries(raw.files)) {
          assert.ok(!/[\\/]/.test(name) && name !== '.' && name !== '..');
          await writeFile(join(target, name), Buffer.from(data, 'base64'));
        }
        await persist();
        console.log(JSON.stringify({ case: kind, iteration, legacy_ms: sample.legacy.wall_ms, guest_ms: sample.guest.wall_ms, expected_observed: true }));
      }
    }
  } catch (error) {
    result.error = error.stack || error.message;
    failure = error;
  } finally {
    try {
      if (vm) {
        result.launcher_cleanup = await vm.close();
        assert.equal(result.launcher_cleanup.accepted, true, result.launcher_cleanup.error);
      }
    } catch (error) {
      result.cleanup_error = error.stack || error.message;
      failure ??= error;
    }
    result.controlled_fixture_checks = preflightOnly && !failure ? 'NOT_RUN' : !failure && result.pairs.length === 10 ? 'PASS' : 'FAIL';
    await persist();
  }
  if (failure) throw failure;
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const input = option('--input');
  assert.ok(input, '--input must name the fixed compiler fixture');
  const output = option('--output');
  assert.ok(output, '--output must be a new task-owned directory');
  if (args.includes('--compare') || args.includes('--guest-preflight-only')) {
    for (const key of ['--launcher', '--qemu', '--guest']) assert.ok(option(key), `${key} is required`);
    await compareCompilers({ input, output, launcher: option('--launcher'), qemu: option('--qemu'), guest: option('--guest'), accelerator: option('--accel', 'tcg'), launcherBackend: option('--launcher-backend', 'appcontainer'), preflightOnly: args.includes('--guest-preflight-only'), verboseBoot: args.includes('--verbose-boot') });
    return;
  }
  assert.ok(args.includes('--prepare-only') || args.includes('--preflight-only'), 'Select --prepare-only, --preflight-only or --compare');
  const fixture = await readFrozenFixture(input);
  const build = await prepareLegacyBuild(fixture, output, option('--case', 'success'));
  if (args.includes('--prepare-only')) {
    console.log(JSON.stringify({ prepared: build, compiler_sha256: expected.compiler, include_manifest_sha256: expected.includeManifest, source_sha256: expected.source[build.kind], compilation_executed: false }));
    return;
  }
  const result = await runLegacyCompile(build);
  console.log(JSON.stringify(result));
  if (!result.expected_observed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
