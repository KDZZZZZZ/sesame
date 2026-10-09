// Real Windows compiler transfer: no MT5 binary, Include or source is in the image.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { compilerSnapshotFrames } from '../../../../plugins/mt5/backend/compiler-snapshot.js';
import { digest } from '../../../../modules/agent/store.js';
import { openCompilerGuest, prepareLegacyBuild, readFrozenFixture } from './benchmark-compiler-compare.mjs';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
for (const name of ['--output', '--guest', '--launcher']) assert.ok(option(name), `${name} is required`);
assert.equal(process.platform, 'win32');
const output = resolve(option('--output')), guest = resolve(option('--guest'));
await mkdir(output);
const temporaryRoot = join(output, 'temp'); await mkdir(temporaryRoot);
const result = { purpose: 'P1/P2 real frozen-input streaming proof; not production or performance acceptance',
  status: 'INCOMPLETE', launcher_events: [], cases: [], limits: { memory: 2147483648, swap: 0, tasks: 256, cpu: '200000 100000',
    task_deadline_seconds: 120, snapshot_bytes: 512 * 1024 * 1024, snapshot_chunk_bytes: 256 * 1024 } };
const persist = () => writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2));
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
let vm, failure;
try {
  const sources = JSON.parse(await readFile(join(guest, 'sources.json'), 'utf8'));
  assert.equal(sources.build_validation, 'PASS');
  assert.equal(sources.prepared_tree_unchanged, true);
  assert.deepEqual(sources.build_tree, sources.readback_tree);
  assert.equal(sources.prepared_manifest_sha256, 'f588222728e3b0e81a7963eba89a8ccaac98906266039b420789e57af7c9b8d5');
  assert.equal(sources.host_mounts_created, false);
  assert.equal(sources.task_limits_changed, false);
  for (const [name, expected] of [['runtime.squashfs', sources.image.sha256], ['initramfs.cpio.gz', sources.tiny_initrd.sha256], ['vmlinuz', sources.kernel_sha256]]) {
    assert.equal(await hashFile(join(guest, name)), expected, name);
  }
  const fixture = await readFrozenFixture(option('--input', 'build/runtime-probes/compiler-compare-inputs'));
  result.image = sources;
  vm = await openCompilerGuest({ launcher: resolve(option('--launcher')), guest, output,
    qemu: resolve(option('--qemu', 'build/runtime-probes/qemu-x86-fixture/qemu-system-x86_64.exe')),
    accelerator: 'tcg', launcherBackend: 'appcontainer', launcherEvents: result.launcher_events, temporaryRoot,
    rootImage: join(guest, 'runtime.squashfs'), rootImageSha256: sources.image.sha256 });
  result.guest_launch = vm.metadata;
  assert.deepEqual(vm.metadata.boot_errors, []);
  assert.equal(vm.metadata.bootstrap_events.length, 1);
  assert.equal(vm.metadata.bootstrap_events[0].build_verified_files, sources.build_tree.types.file);
  const rootLease = result.launcher_events.find(event => event.launcher === 'root_image_verified');
  assert.equal(rootLease?.readonly_lease_held, true);
  assert.equal(rootLease?.file_and_raw_readonly, true);
  await persist();
  for (const kind of ['success', 'error']) {
    const build = await prepareLegacyBuild(fixture, join(output, `frozen-${kind}`), kind);
    const started = performance.now();
    const request = { action: 'compile_snapshot', id: `stream-${kind}`, compilerBudget: 'standard', manifest_sha256: build.manifest_sha256 };
    const raw = await vm.invoke(request, undefined, compilerSnapshotFrames(build.directory, build.manifest_sha256));
    const wall_ms = performance.now() - started;
    await writeFile(join(output, `${kind}-raw.json`), JSON.stringify(raw, null, 2));
    const transfer = vm.metadata.snapshot_events.find(event => event.id === request.id);
    assert.equal(transfer?.manifest_sha256, build.manifest_sha256);
    assert.equal(transfer?.file_count, 9);
    assert.ok(transfer.total_bytes >= 115827176);
    assert.equal(raw.id, request.id);
    assert.equal(raw.exitCode, 0, raw.stderr || raw.message);
    assert.equal(raw.stopped, null);
    assert.match(raw.metrics['cgroup.events'], /(?:^|\n)populated 0(?:\n|$)/);
    for (const [name, expected] of Object.entries({ 'memory.max': '2147483648', 'memory.swap.max': '0', 'pids.max': '256', 'cpu.max': '200000 100000' })) assert.equal(raw.metrics[name], expected);
    assert.match(raw.metrics['memory.events'], /(?:^|\n)oom_kill 0(?:\n|$)/);
    assert.ok(raw.cleanup_ms <= 2000);
    assert.deepEqual(Object.keys(raw.files).sort(), kind === 'success' ? ['Strategy.ex5', 'compile-result.json'] : ['compile-result.json']);
    const compiled = JSON.parse(Buffer.from(raw.files['compile-result.json'], 'base64'));
    assert.equal(compiled.success, kind === 'success', compiled.diagnostics);
    assert.match(compiled.diagnostics, kind === 'success' ? /Result: 0 errors, 0 warnings/ : /undeclared identifier 'missing_compile_token'/);
    if (compiled.success) {
      const artifact = Buffer.from(raw.files['Strategy.ex5'], 'base64');
      assert.ok(artifact.length > 0 && artifact.length <= 32 * 1024 * 1024);
      assert.equal(digest(artifact), compiled.ex5_sha256);
    } else assert.equal(compiled.ex5_sha256, null);
    const row = { kind, wall_ms, transfer, result: compiled, metrics: raw.metrics, cleanup_ms: raw.cleanup_ms, expected_observed: true };
    result.cases.push(row); await persist();
    console.log(JSON.stringify({ kind, accepted: true, wall_ms, transfer_ms: transfer.transfer_ms }));
  }
  result.status = 'PASS';
} catch (error) { failure = error; result.status = 'FAIL'; result.error = error.stack || String(error); }
finally {
  if (vm) {
    result.cleanup = await vm.close();
    if (!result.cleanup.accepted) { result.status = 'FAIL'; failure ??= new Error(result.cleanup.error); }
  }
  await persist();
}
console.log(JSON.stringify({ status: result.status, cases: result.cases.length, error: result.error, cleanup_accepted: result.cleanup?.accepted }));
if (failure) process.exitCode = 1;
