// Compare cold startup and real compiler work for the immutable P0 block fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openCompilerGuest, inspectCompilerGuest, readFrozenFixture } from './benchmark-compiler-compare.mjs';
import { buildCompileCases } from './compile-cases.mjs';
import { buildGuestHardeningCase } from './guest-hardening-cases.mjs';
import { buildPosixToolCases } from './posix-tool-cases.mjs';

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
for (const key of ['--output', '--guest', '--launcher']) assert.ok(option(key), `${key} is required`);
const backend = option('--backend', 'appcontainer');
assert.ok(['appcontainer', 'whpx'].includes(backend));
const output = resolve(option('--output')), guest = resolve(option('--guest'));
await mkdir(output);
const temporaryRoot = join(output, 'temp'); await mkdir(temporaryRoot);
const rootImage = join(guest, 'runtime.squashfs');
const result = { purpose: 'P0 cold block-root compiler proof; not product or performance acceptance',
  backend, status: 'INCOMPLETE', launcher_events: [], cases: [],
  measurement: 'Host image check, private-copy preparation and boot plus first compile; no readiness prewarming before compilation' };
const persist = () => writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2));
let vm, failure;
try {
  const sources = JSON.parse(await readFile(join(guest, 'sources.json'), 'utf8'));
  assert.equal(sources.build_validation, 'PASS');
  assert.equal(sources.expanded_manifest_sha256, '12163da84d345298309555ffd31e38e5eff6f8e72a656b96ee6d7f7444d18eac');
  assert.equal(sources.build_tree.types.file, 4667);
  assert.deepEqual(sources.build_tree, sources.readback_tree);
  assert.equal(sources.host_modules_loaded, false);
  assert.equal(sources.host_mounts_created, false);
  result.image = { root: sources.image, initrd: sources.tiny_initrd, kernel_sha256: sources.kernel_sha256 };
  const coldStarted = performance.now();
  assert.equal(await hashFile(rootImage), sources.image.sha256);
  assert.equal(await hashFile(join(guest, 'initramfs.cpio.gz')), sources.tiny_initrd.sha256);
  assert.equal(await hashFile(join(guest, 'vmlinuz')), '5cd6898e71f247e0dd820bcbae669a5b5d35bd736cbe3c2e6834ff2381525e5d');
  result.host_input_verification_ms = performance.now() - coldStarted;
  vm = await openCompilerGuest({ launcher: resolve(option('--launcher')), guest, output,
    qemu: resolve(option('--qemu', 'build/runtime-probes/qemu/qemu-system-x86_64.exe')),
    accelerator: backend === 'whpx' ? 'whpx' : 'tcg', launcherBackend: backend,
    launcherEvents: result.launcher_events, temporaryRoot, rootImage, rootImageSha256: sources.image.sha256 });
  result.guest_launch = vm.metadata;
  assert.deepEqual(vm.metadata.boot_errors, []);
  assert.deepEqual(vm.metadata.bootstrap_events, [{ type: 'bootstrap', stage: 'block_mounted',
    format: 'squashfs', read_only: true, host_verified_image_sha256: sources.image.sha256,
    build_verified_files: 4667, run_tmpfs_bytes: 16777216 }]);
  const verifiedRoots = result.launcher_events.filter(event => event.launcher === 'root_image_verified');
  assert.equal(verifiedRoots.length, 1);
  assert.equal(verifiedRoots[0].sha256, sources.image.sha256);
  assert.equal(verifiedRoots[0].readonly_lease_held, true);
  assert.equal(verifiedRoots[0].file_and_raw_readonly, true);
  assert.equal(verifiedRoots[0].auto_readonly, false);
  await persist();
  for (const [index, item] of (await buildCompileCases({ hostPlatform: 'win32' })).entries()) {
    const before = performance.now();
    const raw = { ...await vm.invoke(item.request()), wall_ms: performance.now() - before };
    if (index === 0) result.host_verify_boot_first_compile_ms = performance.now() - coldStarted;
    const directory = join(output, item.name); await mkdir(directory);
    await writeFile(join(directory, 'raw.json'), JSON.stringify(raw, null, 2));
    const record = { name: item.name, evidence: item.validate(raw) }; result.cases.push(record);
    await persist();
    console.log(JSON.stringify({ name: item.name, wall_ms: raw.wall_ms, accepted: true }));
  }
  result.readiness = await inspectCompilerGuest(vm, await readFrozenFixture(option('--input', 'build/runtime-probes/compiler-compare-inputs')), output);
  const security = buildGuestHardeningCase();
  const raw = await vm.invoke(security.request);
  result.security = { raw, proof: security.validate(raw) };
  const readonly = await vm.invoke({ id: 'block-readonly', timeout: 15, files: {}, script: `exec python3 - <<'PY'
import errno,json,os
state=os.statvfs('/usr')
try:
 with open('/usr/.sesame-p0-denied','wb') as target: target.write(b'denied')
 denied=False; error=0
except OSError as failure:
 denied=True; error=failure.errno
print(json.dumps({'readonly':bool(state.f_flag & os.ST_RDONLY),'write_denied':denied,'errno':error}))
PY` });
  assert.equal(readonly.exitCode, 0, readonly.stderr);
  assert.equal(readonly.stopped, null); assert.deepEqual(readonly.files, {});
  assert.match(readonly.metrics['cgroup.events'], /populated 0/); assert.ok(readonly.cleanup_ms <= 2000);
  assert.deepEqual(JSON.parse(readonly.stdout), { readonly: true, write_denied: true, errno: 30 });
  result.readonly = readonly;
  for (const item of await buildPosixToolCases()) {
    const raw = await vm.invoke(item.request());
    result.cases.push({ name: item.name, raw, proof: item.validate(raw) }); await persist();
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
console.log(JSON.stringify({ status: result.status, backend, boot_ms: result.guest_launch?.boot_ms,
  host_verify_boot_first_compile_ms: result.host_verify_boot_first_compile_ms,
  cases: result.cases.map(x => x.name), error: result.error, cleanup_accepted: result.cleanup?.accepted }));
if (failure) process.exitCode = 1;
