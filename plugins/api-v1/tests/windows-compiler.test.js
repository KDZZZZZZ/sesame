import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { digest } from '../packages/mt5/backend/support.js';
import { createWindowsBackend } from '../packages/mt5/backend/runners/windows.js';

const tempRoot = resolve('.test-output/compiler');
const bundle = { platform: 'win32', arch: 'x64', protocolVersion: 1,
  paths: Object.fromEntries(['windows_launcher', 'qemu', 'compiler_kernel', 'compiler_initrd', 'compiler_root_image'].map(key => [key, resolve('.test-output/fake-bundle', key === 'qemu' ? 'qemu-system-x86_64.exe' : key)])),
  entryHashes: { compiler_root_image: 'a'.repeat(64) } };
const metrics = { 'memory.max': '402653184', 'memory.swap.max': '0', 'pids.max': '64', 'cpu.max': '100000 100000', 'cgroup.events': 'populated 0' };
function launcher(handler, { cleanup = true } = {}) {
  const state = { calls: [], frames: [], ended: false };
  state.spawn = (command, args, options) => {
    state.calls.push({ command, args, options });
    const child = new EventEmitter(); child.pid = 42; child.exitCode = null; child.signalCode = null;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const emit = value => child.stdout.write(JSON.stringify(value) + '\n');
    const close = () => {
      if (state.ended) return;
      state.ended = true;
      if (cleanup) {
        child.stderr.write(JSON.stringify({ network_broker: 'finished', scratch_deleted: true, unified_task_job_empty: true, held_processes_exited: true, first_job_kill_to_empty_ms: 1 }) + '\n');
        child.stderr.write(JSON.stringify({ launcher: 'finished', backend: 'appcontainer', exit_code: 125, job_empty: true, held_processes_exited: true, first_job_kill_to_empty_ms: 1, profile_deleted: true, scratch_deleted: true }) + '\n');
      }
      child.exitCode = 125; child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit('close', 125, null));
    };
    child.kill = () => { child.signalCode = 'SIGTERM'; close(); };
    child.stdin = new Writable({ write(bytes, encoding, callback) {
      try {
        for (const line of bytes.toString().trim().split('\n')) {
          const frame = JSON.parse(line); state.frames.push(frame); handler(frame, emit, state);
        }
        callback();
      } catch (error) { callback(error); }
    }, final(callback) { close(); callback(); } });
    child.stdin.once('close', close);
    setImmediate(() => {
      child.stderr.write(JSON.stringify({ launcher: 'started', backend: 'appcontainer', appcontainer: true }) + '\n');
      child.stderr.write(JSON.stringify({ network_broker: 'ready', mode: 'unrestricted' }) + '\n');
      emit({ type: 'ready', protocol_version: 1, network: { enabled: true } });
    });
    return child;
  };
  return state;
}
async function directory(t) {
  await mkdir(tempRoot, { recursive: true });
  const path = await mkdtemp(join(tempRoot, 'windows-backend-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('bundled Windows compile streams the frozen manifest and verifies production EX5 result', async t => {
  const root = await directory(t), frozen = join(root, 'frozen');
  await mkdir(join(frozen, '.compiler'), { recursive: true });
  const editor = Buffer.from('MZ never executed'), manifest = JSON.stringify({ compiler_sha256: digest(editor), files: { '.compiler/MetaEditor64.exe': { bytes: editor.length, sha256: digest(editor) } } });
  await writeFile(join(frozen, '.compiler/MetaEditor64.exe'), editor); await writeFile(join(frozen, 'manifest.json'), manifest);
  const ex5 = Buffer.from('EX5 fixture'), expected = { success: true, diagnostics: 'Result: 0 errors, 0 warnings\r\n', ex5_sha256: digest(ex5) };
  const state = launcher((frame, emit, current) => {
    if (frame.action === 'compile_snapshot') current.request = frame;
    if (frame.type === 'end') emit({ id: current.request.id, exitCode: 0, stopped: null, stdout: '', stderr: '', cleanup_ms: 1,
      metrics: { ...metrics, 'memory.max': '2147483648', 'pids.max': '256', 'cpu.max': '200000 100000' },
      files: { 'compile-result.json': Buffer.from(JSON.stringify(expected)).toString('base64'), 'Strategy.ex5': ex5.toString('base64') } });
  });
  const backend = createWindowsBackend(bundle, { directory: root, spawnProcess: state.spawn });
  assert.deepEqual(await backend.compile(frozen, digest(manifest)), { ...expected, ex5: ex5.toString('base64') });
  assert.ok(state.calls[0].args.includes(bundle.paths.compiler_root_image));
  assert.ok(state.calls[0].args.includes(bundle.paths.compiler_kernel));
  assert.ok(state.calls[0].args.includes(bundle.paths.compiler_initrd));
  assert.equal(state.frames[0].compilerBudget, 'standard'); assert.equal(state.frames[0].manifest_sha256, digest(manifest));
  assert.equal(state.frames.at(-1).type, 'end'); assert.equal(state.ended, true);
  assert.equal(await readFile(join(frozen, '.compiler/MetaEditor64.exe'), 'utf8'), editor.toString());
});
