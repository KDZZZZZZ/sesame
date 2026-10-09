import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import * as fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createMacOSBackend } from '../packages/mt5/backend/runners/macos.js';

const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
async function fixture(t) {
  const parent = fileURLToPath(new URL('./.test-output/compiler/', import.meta.url));
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(join(parent, 'macos-backend-'));
  t.after(async () => { assert.equal(dirname(root), parent.replace(/[\\/]$/, '')); await fs.rm(root, { recursive: true, force: true }); });
  const bundleRoot = join(root, 'bundle');
  await fs.mkdir(bundleRoot);
  const roles = ['launcher', 'qemu', 'qemu_bios', 'kernel', 'initramfs', 'compiler_kernel', 'compiler_initramfs', 'compiler_root_image'];
  const paths = Object.fromEntries(roles.map(role => [role, join(bundleRoot, role)]));
  for (const path of Object.values(paths)) await fs.writeFile(path, 'trusted-test-component');
  return { root, directory: join(root, 'runtime'), bundle: { root: bundleRoot, platform: 'darwin', arch: 'arm64', protocolVersion: 1, paths } };
}
function transport({ compiler = false, clean = true, changeInputs = false } = {}) {
  const observed = { frames: [] };
  const spawn = (command, args, options) => {
    Object.assign(observed, { command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const emit = value => child.stdout.write(JSON.stringify(value) + '\n');
    const result = () => {
      const request = observed.request;
      let files = request.files ?? {};
      if (compiler) {
        const ex5 = Buffer.from('compiled-artifact');
        const value = { success: true, diagnostics: 'Result: 0 errors, 0 warnings', ex5_sha256: sha(ex5) };
        files = { 'Strategy.ex5': ex5.toString('base64'), 'compile-result.json': Buffer.from(JSON.stringify(value)).toString('base64') };
      } else {
        emit({ type: 'output', id: request.id, channel: 'stderr', data: Buffer.from('stderr-first\n').toString('base64') });
        emit({ type: 'output', id: request.id, channel: 'stdout', data: Buffer.from('stdout-second\n').toString('base64') });
        if (changeInputs) files = { ...files, 'inputs/data': Buffer.from('changed').toString('base64') };
      }
      emit({ id: request.id, exitCode: compiler ? 0 : 1, stopped: null, files, cleanup_ms: 1,
        stdout: compiler ? '' : 'stdout-second\n', stderr: compiler ? '' : 'stderr-first\n',
        metrics: { 'memory.max': compiler ? '2147483648' : '402653184', 'memory.swap.max': '0',
          'pids.max': compiler ? '256' : '64', 'cpu.max': compiler ? '200000 100000' : '100000 100000', 'cgroup.events': 'populated 0\n' } });
    };
    let buffer = '';
    child.stdin = new Writable({
      write(chunk, _encoding, done) {
        buffer += chunk.toString();
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
          if (!observed.request) {
            observed.request = value;
            if (!compiler) setImmediate(result);
          } else if (value.action === 'shutdown') {
            observed.shutdown = value;
          } else {
            observed.frames.push(value);
            if (value.type === 'end') {
              emit({ type: 'snapshot_ready', id: observed.request.id, manifest_sha256: observed.request.manifest_sha256 });
              setImmediate(result);
            }
          }
        }
        done();
      },
      final(done) {
        // QEMU virtconsole does not deliver host stdin EOF to the guest.
        // A successful one-shot compiler must explicitly request poweroff.
        if (compiler) assert.deepEqual(observed.shutdown, { action: 'shutdown' });
        if (!compiler && clean) child.stderr.write(JSON.stringify({ schema: 'sesame.macos-runtime.v1', event: 'cleanup',
          vm_stopped: true, broker_reaped: true, accepted: true, elapsed_ms: 2 }) + '\n');
        done();
        setImmediate(() => { child.stdout.end(); child.stderr.end(); child.emit('close', 0, null); });
      },
    });
    child.kill = () => { throw new Error('Unexpected forced termination in a clean protocol fixture'); };
    setImmediate(() => emit({ type: 'ready', protocol_version: 1, network: { enabled: !compiler } }));
    return child;
  };
  return { spawn, observed };
}

test('Mac compiler streams the production snapshot generator and verifies EX5 before returning', async t => {
  const f = await fixture(t), fake = transport({ compiler: true });
  const directory = join(f.root, 'frozen');
  const content = { '.compiler/MetaEditor64.exe': Buffer.alloc(300001, 73), 'Experts/Strategy.mq5': Buffer.from('void OnTick() {}') };
  const files = {};
  for (const [name, data] of Object.entries(content)) {
    await fs.mkdir(dirname(join(directory, name)), { recursive: true }); await fs.writeFile(join(directory, name), data);
    files[name] = { bytes: data.length, sha256: sha(data) };
  }
  const raw = Buffer.from(JSON.stringify({ compiler_sha256: files['.compiler/MetaEditor64.exe'].sha256, files }));
  await fs.writeFile(join(directory, 'manifest.json'), raw);
  const backend = createMacOSBackend(f.bundle, { directory: f.directory, spawnProcess: fake.spawn });
  const result = await backend.compile(directory, sha(raw));
  assert.equal(result.success, true);
  assert.equal(sha(Buffer.from(result.ex5, 'base64')), result.ex5_sha256);
  assert.equal(fake.observed.request.action, 'compile_snapshot');
  assert.equal(fake.observed.request.compilerBudget, 'macos');
  assert.equal(fake.observed.frames[0].type, 'begin');
  assert.equal(fake.observed.frames.at(-1).type, 'end');
  const chunks = fake.observed.frames.filter(item => item.type === 'chunk');
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every(item => Buffer.from(item.data, 'base64').length <= 256 * 1024));
  assert.equal(fake.observed.command, '/usr/bin/sandbox-exec');
  assert.equal(fake.observed.args.includes(directory), false);
  assert.deepEqual(await fs.readdir(f.directory), []);
});
