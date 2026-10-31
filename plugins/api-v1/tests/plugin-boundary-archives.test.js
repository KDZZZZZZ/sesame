import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildLock, createArchive, packageFiles, treeDigest } from '../scripts/plugin-lock.mjs';
import { applyApprovedRetirements } from '../scripts/verify-plugin-boundaries.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const baseline = JSON.parse(readFileSync(new URL('./fixtures/plugin-boundaries-baseline.json', import.meta.url), 'utf8'));
const retirements = JSON.parse(readFileSync(new URL('./fixtures/plugin-boundaries-retirements.json', import.meta.url), 'utf8'));
const active = applyApprovedRetirements(root, baseline, retirements);
const selected = process.env.SESAME_BOUNDARY_PACKAGES?.split(',');
if (selected) for (const id of selected) assert.ok(active.packages.some(item => item.manifest.id === id), `Not in active scope: ${id}`);
for (const item of active.packages.filter(item => !selected || selected.includes(item.manifest.id))) {
  test(`${item.manifest.id}: independent archive restores exact bytes and imports without neighboring packages`, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'sesame-boundary-archive-'));
    t.after(() => { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true }); });
    const name = item.manifest.id.split('/')[1], stage = join(directory, 'source'), unpacked = join(directory, 'installed');
    mkdirSync(join(stage, 'packages'), { recursive: true }); mkdirSync(unpacked);
    cpSync(join(root, item.sourcePath), join(stage, 'packages', name), { recursive: true });
    const lock = buildLock(stage), archive = join(directory, 'plugin.tar.gz');
    assert.equal(lock.packages.length, 1);
    writeFileSync(archive, createArchive(stage, lock));
    // GNU tar treats C: in an archive argument as a remote host. Resolve the
    // isolated fixture directory via cwd and pass portable relative names.
    execFileSync('tar', ['-xzf', 'plugin.tar.gz', '-C', 'installed'], { cwd: directory, windowsHide: true, stdio: 'pipe' });
    assert.deepEqual(readdirSync(unpacked).sort(), [name, 'official-plugins.lock.json'].sort());
    assert.deepEqual(JSON.parse(readFileSync(join(unpacked, 'official-plugins.lock.json'), 'utf8')), lock);
    const installed = join(unpacked, name);
    assert.equal(treeDigest(packageFiles(installed)), treeDigest(lock.packages[0].files));
    const manifest = JSON.parse(readFileSync(join(installed, 'plugin.json'), 'utf8'));
    if (manifest.entry) {
      const module = await import(pathToFileURL(join(installed, manifest.entry)));
      assert.equal(typeof module.createCapabilities, 'function');
    }
  });
}
