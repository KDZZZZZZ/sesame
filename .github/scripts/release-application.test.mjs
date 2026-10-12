import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateApplicationPlan, validateApplicationAssets, validateChecksums, assertPublicationContext, releaseApplication } from './release-application.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const head = 'a'.repeat(40);
const context = () => ({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'KDZZZZZZ/sesame', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: head, GITHUB_WORKFLOW_REF: 'KDZZZZZZ/sesame/.github/workflows/application-release.yml@refs/heads/main' });
function fixture() {
  const names = ['INSTALL.md', 'Sesame-0.2.3-linux-x64.AppImage', 'Sesame-0.2.3-linux-x64.deb', 'Sesame-0.2.3-mac-arm64.dmg', 'Sesame-0.2.3-win-x64.exe'];
  const assets = names.map(name => ({ name, size: 100, sha256: sha256(name) }));
  const sums = Buffer.from(assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(''));
  assets.push({ name: 'SHA256SUMS.txt', size: sums.length, sha256: sha256(sums) });
  const plan = { schemaVersion: 1, repository: 'KDZZZZZZ/sesame', tag: 'v0.2.3', releaseId: 42, assets };
  const release = { id: 42, tag_name: plan.tag, draft: true, prerelease: false, published_at: null, assets: assets.map((asset, i) => ({ id: i + 1, name: asset.name, size: asset.size, digest: `sha256:${asset.sha256}`, state: 'uploaded' })) };
  return { plan, release, sums };
}
function client(f = fixture(), { latest = { id: 41, tag_name: 'v0.2.2', draft: false, prerelease: false }, main = head, refreshed = f.release } = {}) {
  const calls = [], downloads = [];
  let reads = 0;
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (options.method === 'PATCH') return { ...refreshed, draft: false, prerelease: false, published_at: '2026-10-13T12:00:00Z' };
    if (path === '/releases/42') return structuredClone(++reads === 1 ? f.release : refreshed);
    if (path === '/releases/latest') return latest;
    if (path === '/git/ref/heads/main') return { object: { type: 'commit', sha: main } };
    throw new Error(`Unexpected request: ${path}`);
  };
  return { calls, downloads, options: { request, readChecksums: async asset => { downloads.push(asset.name); return f.sums; }, env: context(), localSha: head } };
}

test('manifest pins one stable application release and exactly the six required assets', () => {
  const { plan } = fixture();
  assert.equal(validateApplicationPlan(plan), plan);
  for (const patch of [{ schemaVersion: 2 }, { repository: 'other/repo' }, { tag: 'v01.2.3' }, { tag: 'plugins-api-v1-dev.22' }, { tag: 'v0.2.3-rc.1' }, { releaseId: 0 }, { releaseId: '42' }, { extra: true }]) assert.throws(() => validateApplicationPlan({ ...plan, ...patch }));
  for (const assets of [plan.assets.slice(1), [...plan.assets, plan.assets[0]], plan.assets.map((a, i) => i ? a : { ...a, name: '../INSTALL.md' }), plan.assets.map((a, i) => i ? a : { ...a, sha256: 'wrong' }), plan.assets.map((a, i) => i ? a : { ...a, size: -1 }), plan.assets.map((a, i) => i ? a : { ...a, size: 1.5 }), plan.assets.map((a, i) => i ? a : { ...a, extra: true })]) assert.throws(() => validateApplicationPlan({ ...plan, assets }));
});
test('remote release identity, uploaded state, exact asset set, sizes and GitHub digests must match', () => {
  const { plan, release } = fixture();
  validateApplicationAssets(plan, release);
  for (const patch of [{ id: 43 }, { tag_name: 'v0.2.4' }, { draft: undefined }, { prerelease: true }, { assets: release.assets.slice(1) }, { assets: [...release.assets, release.assets[0]] }]) assert.throws(() => validateApplicationAssets(plan, { ...release, ...patch }));
  for (const patch of [{ id: 0 }, { name: 'extra.zip' }, { size: 101 }, { digest: null }, { digest: 'sha256:' + 'b'.repeat(64) }, { state: 'new' }]) assert.throws(() => validateApplicationAssets(plan, { ...release, assets: release.assets.map((asset, i) => i ? asset : { ...asset, ...patch }) }));
  assert.throws(() => validateApplicationAssets(plan, { ...release, assets: release.assets.map((asset, i) => i === 1 ? { ...asset, id: 1 } : asset) }));
});
test('checksums authenticate the small file and independently cover all five payload assets', () => {
  const { plan, sums } = fixture();
  validateChecksums(plan, sums);
  assert.throws(() => validateChecksums(plan, Buffer.concat([sums, Buffer.from('x')])));
  const lines = sums.toString().trimEnd().split('\n');
  for (const changed of [lines.slice(1), [...lines, lines[0]], [lines[0].replace('INSTALL.md', '../INSTALL.md'), ...lines.slice(1)], [lines[0].replace(/^[a-f0-9]{64}/, 'f'.repeat(64)), ...lines.slice(1)]]) {
    const bytes = Buffer.from(changed.join('\n') + '\n');
    const manifest = { ...plan, assets: plan.assets.map(asset => asset.name === 'SHA256SUMS.txt' ? { ...asset, size: bytes.length, sha256: sha256(bytes) } : asset) };
    assert.throws(() => validateChecksums(manifest, bytes));
  }
});
test('publication is restricted to this exact main workflow, event and checked-out commit', () => {
  assertPublicationContext(context(), head);
  assertPublicationContext({ ...context(), GITHUB_EVENT_NAME: 'workflow_dispatch' }, head);
  for (const patch of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_REPOSITORY: 'fork/sesame' }, { GITHUB_REF: 'refs/heads/dev' }, { GITHUB_EVENT_NAME: 'pull_request_target' }, { GITHUB_WORKFLOW_REF: 'KDZZZZZZ/sesame/.github/workflows/other.yml@refs/heads/main' }, { GITHUB_SHA: 'main' }]) assert.throws(() => assertPublicationContext({ ...context(), ...patch }, head));
  assert.throws(() => assertPublicationContext(context(), 'b'.repeat(40)));
});
test('read-only verification downloads only checksums and never writes a draft', async () => {
  const f = fixture(), c = client(f);
  const result = await releaseApplication(f.plan, { ...c.options, mode: 'verify', env: {}, localSha: undefined });
  assert.equal(result.action, 'verified-draft');
  assert.deepEqual(c.downloads, ['SHA256SUMS.txt']);
  assert.equal(c.calls.some(call => call.method), false);
});
test('complete matching drafts publish once as stable/latest without editing tag or assets', async () => {
  const f = fixture(), c = client(f);
  const result = await releaseApplication(f.plan, { ...c.options, mode: 'publish' });
  assert.equal(result.action, 'published');
  assert.deepEqual(c.calls.filter(call => call.method), [{ path: '/releases/42', method: 'PATCH', body: { draft: false, prerelease: false, make_latest: 'true' } }]);
  assert.deepEqual(c.downloads, ['SHA256SUMS.txt']);
});
test('already published matching versions are verified and skipped without changing latest', async () => {
  const f = fixture(); f.release.draft = false; f.release.published_at = '2026-10-13T12:00:00Z';
  const c = client(f, { latest: { id: 50, tag_name: 'v0.3.0', draft: false, prerelease: false } });
  assert.equal((await releaseApplication(f.plan, { ...c.options, mode: 'publish' })).action, 'already-published');
  assert.equal(c.calls.some(call => call.method), false);
  assert.deepEqual(c.downloads, ['SHA256SUMS.txt']);
});
test('newer latest, wrong latest identity, or main advancing prevents publication', async () => {
  for (const options of [{ latest: { id: 50, tag_name: 'v0.3.0', draft: false, prerelease: false } }, { latest: { id: 50, tag_name: 'v0.2.3', draft: false, prerelease: false } }, { main: 'b'.repeat(40) }]) {
    const f = fixture(), c = client(f, options);
    await assert.rejects(releaseApplication(f.plan, { ...c.options, mode: 'publish' }));
    assert.equal(c.calls.some(call => call.method), false);
  }
});
test('incomplete assets, wrong checksum bytes and drafts changed during verification never write', async () => {
  for (const change of ['asset', 'checksums', 'changed']) {
    const f = fixture();
    if (change === 'asset') f.release.assets.pop();
    if (change === 'checksums') f.sums = Buffer.from('tampered');
    const refreshed = structuredClone(f.release); if (change === 'changed') refreshed.assets[0].size++;
    const c = client(f, { refreshed });
    await assert.rejects(releaseApplication(f.plan, { ...c.options, mode: 'publish' }));
    assert.equal(c.calls.some(call => call.method), false);
  }
});
test('a concurrent completed publication is validated then skipped', async () => {
  const f = fixture(), c = client(f, { refreshed: { ...f.release, draft: false, published_at: '2026-10-13T12:00:00Z' } });
  assert.equal((await releaseApplication(f.plan, { ...c.options, mode: 'publish' })).action, 'already-published');
  assert.equal(c.calls.some(call => call.method), false);
});
test('the first stable release can publish without an existing latest', async () => {
  const f = fixture(), c = client(f, { latest: null });
  assert.equal((await releaseApplication(f.plan, { ...c.options, mode: 'publish' })).action, 'published');
});
