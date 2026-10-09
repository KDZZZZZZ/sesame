// P0-only Windows capacity driver. Uses the comparison client's native owner.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { readFrozenFixture, openCompilerGuest, inspectCompilerGuest } from './benchmark-compiler-compare.mjs';
import { buildCompilerTransportCases } from './compiler-transport-cases.mjs';

const OVERLAY_SHA256 = 'c853471d5f1721b58683754e2082bc9576a24c3098fa421d0b9c168fb9a7bc78';
const GUEST_SCRIPT_SHA256 = '90e0dc7761b0fd17554b3996b441e0a221beb2cb0a4f2027c62dee734252073d';

async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function runCompilerTransport({ input, output, guest, launcher, qemu, accelerator, launcherBackend }) {
  assert.equal(process.platform, 'win32');
  assert.ok(launcher, 'An explicit native launcher is required');
  assert.ok(['appcontainer', 'whpx'].includes(launcherBackend), 'Explicit launcher-backend required');
  assert.ok(['tcg', 'whpx'].includes(accelerator), 'Explicit accelerator required');
  assert.ok(launcherBackend !== 'whpx' || accelerator === 'whpx', 'WHPX backend requires WHPX acceleration');
  for (const name of [input, output, guest, qemu]) assert.equal(typeof name, 'string');
  output = resolve(output);
  guest = resolve(guest);
  await mkdir(output);
  const temporaryRoot = join(output, 'temp');
  await mkdir(temporaryRoot);
  const result = { purpose: 'Controlled compiler output capacity; synthetic EX5 bytes are not a real compilation',
    platform: process.platform, arch: process.arch, node: process.version,
    launcher_events: [], cases: [], controlled_fixture_checks: 'NOT_COMPLETE',
    compiler_execution: 'NOT_RUN', input_bundle_acceptance: 'NOT_RUN', production_acceptance: 'NOT_RUN' };
  const persist = () => writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2));
  let vm, failure;
  try {
    const source = JSON.parse(await readFile(join(guest, 'sources.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(guest, 'expanded-manifest.json'), 'utf8'));
    assert.equal(source.overlay_sha256, OVERLAY_SHA256);
    assert.equal(source.runtime_rootfs_bytes, 2147483648);
    assert.equal(source.runtime_regular_files, 2727);
    assert.equal(manifest.files['guest.py'].sha256, GUEST_SCRIPT_SHA256);
    assert.equal(await fileHash(join(guest, 'initramfs.cpio.gz')), source.archive_sha256);
    assert.equal(await fileHash(join(guest, 'vmlinuz')), source.kernel_sha256);
    result.image = { archive_sha256: source.archive_sha256, archive_bytes: source.archive_bytes,
      kernel_sha256: source.kernel_sha256, overlay_sha256: source.overlay_sha256,
      guest_script_sha256: GUEST_SCRIPT_SHA256, runtime_regular_files: source.runtime_regular_files,
      runtime_rootfs_bytes: source.runtime_rootfs_bytes };
    const frozen = await readFrozenFixture(input);
    await persist();
    vm = await openCompilerGuest({ launcher: resolve(launcher), qemu: resolve(qemu), guest, output,
      accelerator, launcherBackend, launcherEvents: result.launcher_events, verboseBoot: false, temporaryRoot });
    result.guest_launch = vm.metadata;
    assert.deepEqual(vm.metadata.bootstrap_events, [{ type: 'bootstrap', stage: 'verified',
      rootfs_limit_bytes: 2147483648, verified_files: 2727, segments: 5 }]);
    result.guest_readiness = await inspectCompilerGuest(vm, frozen, output);
    assert.equal(result.guest_readiness.capacity['/usr'].total_bytes, 2147483648);
    assert.ok(result.guest_readiness.capacity['/usr'].free_bytes >= 256*1024*1024);
    await persist();
    for (const fixture of await buildCompilerTransportCases({ hostPlatform: 'win32' })) {
      const directory = join(output, fixture.name);
      await mkdir(directory);
      const before = performance.now();
      const raw = { ...await vm.invoke(fixture.request()), wall_ms: performance.now() - before };
      // Keep failures reviewable without duplicating large raw base64 in JSON.
      await writeFile(join(directory, 'response.json'), JSON.stringify({ ...raw,
        files: Object.fromEntries(Object.entries(raw.files ?? {}).map(([name, value]) => [name,
          { encoding: 'base64', characters: typeof value === 'string' ? value.length : null }])) }, null, 2));
      const evidence = fixture.validate(raw);
      for (const [name, value] of Object.entries(raw.files)) {
        assert.ok(!/[\\/]/.test(name) && name !== '.' && name !== '..');
        await writeFile(join(directory, name), Buffer.from(value, 'base64'));
      }
      await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
      result.cases.push(evidence);
      await persist();
      console.log(JSON.stringify({ type: 'compiler-transport-contract', ...evidence }));
    }
  } catch (error) {
    result.error = error.stack || error.message;
    failure = error;
  } finally {
    try {
      result.launcher_cleanup = vm ? await vm.close()
        : JSON.parse(await readFile(join(output, 'launcher-cleanup.json'), 'utf8'));
      assert.equal(result.launcher_cleanup.accepted, true, result.launcher_cleanup.error);
    } catch (error) {
      result.cleanup_error = error.stack || error.message;
      failure ??= error;
    }
    const passed = !failure && result.guest_readiness?.accepted && result.launcher_cleanup?.accepted
      && result.cases.length === 5 && result.cases.every(item => item.expected_observed === true);
    result.controlled_fixture_checks = passed ? 'PASS' : 'FAIL';
    await persist();
  }
  if (failure) throw failure;
  assert.equal(result.controlled_fixture_checks, 'PASS');
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.includes('--run'), 'Explicit --run is required; this launches a controlled Windows VM');
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
  await runCompilerTransport({ input: option('--input'), output: option('--output'), guest: option('--guest'),
    launcher: option('--launcher'), launcherBackend: option('--launcher-backend'), accelerator: option('--accel'),
    qemu: option('--qemu', 'build/runtime-probes/qemu/qemu-system-x86_64.exe') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
