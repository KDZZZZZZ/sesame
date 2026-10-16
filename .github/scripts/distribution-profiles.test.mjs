import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildLock, readProfile } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { buildR2Profile } from './plugin-r2.mjs';

const lockBytes = lock => Buffer.from(JSON.stringify(lock, null, 2) + '\n');
function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'sesame-profile-infra-'));
  t.after(() => { assert.equal(dirname(resolve(repo)), resolve(tmpdir())); rmSync(repo, { recursive: true, force: true }); });
  const root = join(repo, 'plugins/api-v1'), pkg = join(root, 'packages/example');
  mkdirSync(pkg, { recursive: true });
  const manifest = { id: 'sesame/example', apiVersion: '2', version: '1.0.0', license: 'MIT', default_state: 'mounted',
    entry: 'index.js', capability_manifest: 'capabilities.json', engines: { sesame: '>=0.2.3' } };
  const declaration = { schemaVersion: 1, apiVersion: '2', capabilities: [{ id: 'read', kind: 'function', consumers: ['agent', 'host'], execution: 'immediate',
    inputSchema: {}, outputSchema: {}, binding: { type: 'native', name: 'read' }, usage: { purpose: 'Read example', inputs: 'Empty object', outputs: 'Example record', prerequisites: [], limitations: [] } }],
    sources: [], views: [], services: [], knowledge: [], hooks: [], stateCollections: [], artifactSchemas: [] };
  const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  json(join(pkg, 'plugin.json'), manifest);
  json(join(pkg, 'package.json'), { version: '1.0.0', type: 'module', license: 'MIT' });
  json(join(pkg, 'capabilities.json'), declaration);
  writeFileSync(join(pkg, 'LICENSE'), 'MIT test fixture');
  writeFileSync(join(pkg, 'index.js'), "throw new Error('candidate code must not execute');\n");
  const profile = { schemaVersion: 1, kind: 'core', engines: { sesame: '>=0.2.0-0' }, packages: [manifest.id] };
  json(join(root, 'bundle-profile.json'), profile);
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  const lock = buildLock(root);
  writeFileSync(join(root, 'official-plugins.lock.json'), lockBytes(lock));
  git('add', '.'); git('commit', '-qm', 'fixed source');
  const draft = { sourceCommit: git('rev-parse', 'HEAD'), sourceRoot: 'plugins/api-v1', profile: 'core', id: 'dev.5',
    packages: [manifest.id], archiveSha256: '0'.repeat(64), lockSha256: '0'.repeat(64) };
  const built = buildR2Profile(repo, draft, { verifyDigests: false });
  const plan = { ...draft, archiveSha256: built.archiveSha256, lockSha256: built.lockSha256 };
  return { repo, root, pkg, json, manifest, declaration, profile, plan, git };
}

test('API 2 profile release reconstruction uses the exact reviewed source commit', t => {
  const f = fixture(t);
  const first = buildR2Profile(f.repo, f.plan);
  assert.equal(first.pin.apiVersion, '2');
  assert.equal(first.pin.packages.length, 1);
  writeFileSync(join(f.pkg, 'index.js'), 'changed working tree');
  assert.equal(buildR2Profile(f.repo, f.plan).archiveSha256, first.archiveSha256);
  assert.throws(() => buildR2Profile(f.repo, { ...f.plan, profile: undefined }), /profile/);
  assert.throws(() => buildR2Profile(f.repo, { ...f.plan, profile: 'optional' }), /profile/);
});

test('API 2 profiles reject altered engines, membership, activation and legacy grants', t => {
  const f = fixture(t);
  for (const engines of [undefined, { sesame: '>=0.1.4' }]) {
    f.json(join(f.pkg, 'plugin.json'), { ...f.manifest, engines });
    assert.throws(() => buildLock(f.root), /engine/);
  }
  f.json(join(f.pkg, 'plugin.json'), { ...f.manifest, migration: { collections: ['old'] } });
  assert.throws(() => buildLock(f.root), /legacy/);
  f.json(join(f.pkg, 'plugin.json'), f.manifest);
  f.json(join(f.root, 'bundle-profile.json'), { ...f.profile, kind: 'optional' });
  assert.throws(() => buildLock(f.root), /default state/);
  f.json(join(f.root, 'bundle-profile.json'), { ...f.profile, packages: ['sesame/other'] });
  assert.throws(() => buildLock(f.root), /Package set/);
  f.json(join(f.root, 'bundle-profile.json'), f.profile);
  writeFileSync(join(f.pkg, 'index.js'), 'host.storage.legacy.list("old")');
  assert.throws(() => buildLock(f.root), /private storage/);
});

test('current R2 publication requires the profile in its fixed source', t => {
  const f = fixture(t);
  f.git('rm', 'plugins/api-v1/bundle-profile.json'); f.git('commit', '-qm', 'remove profile');
  assert.throws(() => buildR2Profile(f.repo, { ...f.plan, sourceCommit: f.git('rev-parse', 'HEAD') }), /profile is missing/);
});

test('API 2 MCP capabilities require explicit server bindings and host engines', t => {
  const f = fixture(t);
  const manifest = { ...f.manifest, execution: 'mcp', entry: undefined };
  const declaration = { ...f.declaration, capabilities: [{ ...f.declaration.capabilities[0], binding: { type: 'mcp', server: 'analysis', name: 'read' } }] };
  f.json(join(f.pkg, 'plugin.json'), manifest);
  f.json(join(f.pkg, 'capabilities.json'), declaration);
  f.json(join(f.pkg, 'mcp.json'), { mcpServers: { analysis: { command: 'node', args: ['server.js'] } } });
  assert.equal(buildLock(f.root).packages.length, 1);
  f.json(join(f.pkg, 'plugin.json'), { ...manifest, engines: undefined });
  assert.throws(() => buildLock(f.root), /engine/);
  f.json(join(f.pkg, 'plugin.json'), manifest);
  f.json(join(f.pkg, 'mcp.json'), { mcpServers: {} });
  assert.throws(() => buildLock(f.root), /undeclared MCP server/);
});

test('profile and inventory changes always trigger both required static checks', () => {
  for (const name of ['plugin-api-v1.yml', 'plugin-catalog.yml']) {
    const workflow = readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');
    assert.equal((workflow.match(/branches: \[main, dev\]/g) ?? []).length, 2);
    assert.doesNotMatch(workflow, /^\s*paths(?:-ignore)?:/m);
  }
});

test('a profile symlink cannot read outside candidate metadata', t => {
  const f = fixture(t), path = join(f.root, 'bundle-profile.json'), outside = join(f.repo, 'outside.json');
  f.json(outside, f.profile); rmSync(path); symlinkSync(outside, path);
  assert.throws(() => readProfile(f.root), /ordinary file/);
});
