import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { compilerSnapshotFrames } from '../compiler-snapshot.js';
import { taskRunId } from '../support.js';
import { digest } from '../support.js';
import { assertPortableTree } from '@sesame/plugin-sdk/transport/portable-tree';
import { base64Bytes, cleanupFailure, requireGuest, runGuest } from '@sesame/plugin-sdk/transport/guest-client';

const MiB = 1024 * 1024;
const roles = ['windows_launcher', 'qemu', 'compiler_kernel', 'compiler_initrd', 'compiler_root_image'];
function tree(value, compiler = false) {
  requireGuest(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 256, 'Invalid guest file tree');
  const files = {}; let bytes = 0;
  for (const [name, encoded] of Object.entries(value)) {
    requireGuest(Buffer.byteLength(name) <= 1024 && name.split('/').length <= 64, 'Guest file path exceeds its bound');
    const data = base64Bytes(encoded, (compiler ? 32 : 8) * MiB);
    bytes += data.length; requireGuest(bytes <= (compiler ? 40 : 16) * MiB, 'Guest file tree exceeds its bound');
    Object.defineProperty(files, name, { value: data, enumerable: true });
  }
  assertPortableTree(files); return files;
}
function validateResult(raw, compiler) {
  requireGuest(raw && raw.stopped === null && Number.isInteger(raw.exitCode), `Guest execution ended: ${raw?.stopped ?? 'invalid result'}`);
  const limits = { 'memory.max': compiler ? '2147483648' : '402653184', 'memory.swap.max': '0',
    'pids.max': compiler ? '256' : '64', 'cpu.max': compiler ? '200000 100000' : '100000 100000' };
  for (const [name, value] of Object.entries(limits)) requireGuest(raw.metrics?.[name] === value, 'Guest resource limits were not confirmed');
  if (!/(?:^|\n)populated 0(?:\n|$)/.test(raw.metrics?.['cgroup.events'] ?? '')
      || !Number.isFinite(raw.cleanup_ms) || raw.cleanup_ms < 0 || raw.cleanup_ms > 2000) {
    throw cleanupFailure('Guest task cleanup was not confirmed');
  }
}
function validateCleanup(events, termination) {
  const started = events.filter(event => event.launcher === 'started'), ended = events.filter(event => event.launcher === 'finished');
  const brokers = events.filter(event => event.network_broker === 'finished');
  requireGuest(started.length === 1 && ended.length === 1 && brokers.length === 1, 'Missing native lifecycle evidence');
  requireGuest(started[0].backend === 'appcontainer' && started[0].appcontainer === true, 'Unexpected native process isolation');
  const final = ended[0], broker = brokers[0];
  requireGuest(final.backend === 'appcontainer' && final.exit_code === termination.helper_exit_code && termination.helper_exit_signal === null
    && final.job_empty === true && final.held_processes_exited === true && final.profile_deleted === true && final.scratch_deleted === true
    && Number.isFinite(final.first_job_kill_to_empty_ms) && final.first_job_kill_to_empty_ms >= 0 && final.first_job_kill_to_empty_ms <= 2000,
  'Native VM lifecycle cleanup failed');
  requireGuest(broker.scratch_deleted === true && broker.unified_task_job_empty === true && broker.held_processes_exited === true
    && Number.isFinite(broker.first_job_kill_to_empty_ms) && broker.first_job_kill_to_empty_ms >= 0 && broker.first_job_kill_to_empty_ms <= 2000,
  'Native network broker cleanup failed');
}
function argumentsFor(paths, imageHash, compiler) {
  const memory = compiler ? '4096' : '1536';
  return ['--launch', '--backend', 'appcontainer', '--runtime', dirname(paths.qemu), '--exe', paths.qemu,
    '--transport', 'socket', '--network', 'unrestricted', '--root-image', paths.compiler_root_image, '--root-image-sha256', imageHash,
    '--memory-mib', compiler ? '8192' : '4096', '--cpu-rate', String(Math.max(1, Math.min(10000, Math.floor(20000 / availableParallelism())))),
    '--read-only', paths.compiler_kernel, '--read-only', paths.compiler_initrd, '--',
    '-machine', 'q35', '-accel', 'tcg,thread=multi', '-cpu', 'max', '-smp', '2', '-m', memory,
    '-nodefaults', '-no-reboot', '-display', 'none', '-monitor', 'none', '-chardev', '@chardev',
    '-device', 'virtio-serial-pci', '-device', 'virtconsole,chardev=console',
    '-netdev', '@netdev', '-device', 'virtio-net-pci,netdev=network,mac=52:54:00:12:34:56',
    '-kernel', '@input0', '-initrd', '@input1', '-append', 'console=hvc0 rdinit=/init quiet panic=-1 sesame-p0=1 sesame-network=unrestricted',
    '-blockdev', '@root-file', '-blockdev', 'driver=raw,node-name=runtime-root,file=runtime-root-file,read-only=on,auto-read-only=off',
    '-device', 'virtio-blk-pci,drive=runtime-root'];
}

export function createWindowsBackend(bundle, { directory, spawnProcess = spawn } = {}) {
  requireGuest(bundle?.platform === 'win32' && bundle.arch === 'x64'
    && roles.every(role => typeof bundle.paths?.[role] === 'string' && isAbsolute(bundle.paths[role]))
    && /^[a-f0-9]{64}$/.test(bundle.entryHashes?.compiler_root_image ?? '') && typeof directory === 'string' && isAbsolute(directory),
  'Windows runtime bundle is missing verified entries or its private data directory');
  const paths = { ...bundle.paths }, imageHash = bundle.entryHashes.compiler_root_image;
  async function run(request, options, compiler, frames) {
    if (options.signal?.aborted) throw new Error('代码执行结束：canceled');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const parent = await realpath(directory), temporary = await mkdtemp(join(parent, 'sesame-runtime-'));
    let retain = false;
    try {
      return await runGuest({ command: paths.windows_launcher, args: argumentsFor(paths, imageHash, compiler),
        env: { ...process.env, TEMP: temporary, TMP: temporary }, cwd: temporary, request, frames,
        signal: options.signal, timeoutMs: options.timeoutMs, onData: options.onData, validateCleanup,
        validateReady: value => requireGuest(value.protocol_version === 1 && value.network?.enabled === true,
          'Guest runtime protocol or full networking is unavailable'), spawnProcess });
    } catch (error) {
      retain = error.code === 'runtime_cleanup_failed';
      throw error;
    } finally {
      // This directory is ours; the helper verifies and removes its own child
      // scratch before success. Keep failed cleanup visible to the task owner.
      const child = relative(parent, resolve(temporary));
      if (!child || child.startsWith('..') || isAbsolute(child)) throw cleanupFailure('Invalid private runtime cleanup path');
      try { if (!retain) await rm(temporary, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); }
      catch (error) { throw cleanupFailure('Private runtime directory cleanup failed', error); }
    }
  }
  return {
    async compile(frozen, manifestDigest, { signal, runId } = {}) {
      if (signal?.aborted) throw new Error('代码执行结束：canceled');
      if (runId) taskRunId(runId);
      requireGuest(/^sha256:[a-f0-9]{64}$/.test(manifestDigest), 'Invalid frozen manifest digest');
      const request = { action: 'compile_snapshot', id: randomUUID(), compilerBudget: 'standard', manifest_sha256: manifestDigest };
      const { result } = await run(request, { signal, timeoutMs: 180000 }, true,
        internalSignal => compilerSnapshotFrames(frozen, manifestDigest, { signal: internalSignal }));
      validateResult(result, true); requireGuest(result.exitCode === 0, 'Guest compiler entry failed');
      const files = tree(result.files, true), raw = files['compile-result.json'];
      requireGuest(raw && raw.length <= 8 * MiB, 'Missing or oversized compiler result');
      let compiled;
      try { compiled = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(raw)); }
      catch { throw new Error('Invalid compiler result JSON'); }
      requireGuest(compiled && typeof compiled.success === 'boolean' && typeof compiled.diagnostics === 'string'
        && Object.keys(compiled).sort().join(',') === 'diagnostics,ex5_sha256,success', 'Invalid compiler result fields');
      const ex5 = files['Strategy.ex5'];
      requireGuest(Object.keys(files).sort().join(',') === (compiled.success ? 'Strategy.ex5,compile-result.json' : 'compile-result.json'),
        'Unexpected compiler output files');
      requireGuest(compiled.success ? ex5?.length > 0 && digest(ex5) === compiled.ex5_sha256 : compiled.ex5_sha256 === null,
        'Compiler EX5 digest mismatch');
      return { ...compiled, ex5: compiled.success ? result.files['Strategy.ex5'] : null };
    },
  };
}
