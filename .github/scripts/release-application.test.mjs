import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateApplicationPlan, validateApplicationAssets, validateChecksums, assertPublicationContext, releaseApplication } from './release-application.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const head = 'a'.repeat(40);
const context = () => ({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'KDZZZZZZ/sesame', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: head, GITHUB_WORKFLOW_REF: 'KDZZZZZZ/sesame/.github/workflows/application-release.yml@refs/heads/main' });
function fixture({ schemaVersion = 1, tag = schemaVersion === 1 ? 'v0.2.3' : 'v0.2.4' } = {}) {
  const version = tag.slice(1);
  const names = ['INSTALL.md', `Sesame-${version}-linux-x64.AppImage`, `Sesame-${version}-linux-x64.deb`, `Sesame-${version}-mac-arm64.dmg`, `Sesame-${version}-win-x64.exe`];
  if (schemaVersion === 2) names.push(`Sesame-${version}-win-x64.exe.blockmap`, `Sesame-${version}-linux-x64.deb.blockmap`, 'update-feed-win32-x64.yml', 'update-plan-win32-x64.json', 'update-feed-linux-x64.yml', 'update-plan-linux-x64.json');
  const assets = names.map(name => ({ name, size: 100, sha256: sha256(name) }));
  const sums = Buffer.from(assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(''));
  assets.push({ name: 'SHA256SUMS.txt', size: sums.length, sha256: sha256(sums) });
  const plan = { schemaVersion, repository: 'KDZZZZZZ/sesame', tag, releaseId: 42, assets };
  const release = { id: 42, tag_name: plan.tag, target_commitish: 'main', draft: true, prerelease: false, published_at: null, assets: assets.map((asset, i) => ({ id: i + 1, name: asset.name, size: asset.size, digest: `sha256:${asset.sha256}`, state: 'uploaded' })) };
  return { plan, release, sums };
}
function client(f = fixture(), { latest = { id: 41, tag_name: 'v0.2.2', draft: false, prerelease: false }, main = head, refreshed = f.release, tag = { ref: `refs/tags/${f.plan.tag}`, object: { type: 'commit', sha: head } }, annotations = new Map(), target = { sha: head } } = {}) {
  const calls = [], downloads = [];
  let reads = 0;
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (options.method === 'PATCH') return { ...refreshed, draft: false, prerelease: false, published_at: '2026-10-13T12:00:00Z' };
    if (path === '/releases/42') return structuredClone(++reads === 1 ? f.release : refreshed);
    if (path === '/releases/latest') return latest;
    if (path === '/git/ref/heads/main') return { object: { type: 'commit', sha: main } };
    if (path === `/git/ref/tags/${f.plan.tag}`) return tag;
    if (path.startsWith('/git/tags/') && annotations.has(path.slice('/git/tags/'.length))) return annotations.get(path.slice('/git/tags/'.length));
    if (path === `/commits/${encodeURIComponent(refreshed.target_commitish)}`) return target;
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

test('schema 2 requires exactly twelve assets including both platform update feeds, plans and blockmaps', () => {
  const { plan } = fixture({ schemaVersion: 2 });
  assert.equal(validateApplicationPlan(plan), plan);
  assert.equal(plan.assets.length, 12);
  for (const asset of plan.assets) {
    assert.throws(() => validateApplicationPlan({ ...plan, assets: plan.assets.filter(candidate => candidate !== asset) }));
    assert.throws(() => validateApplicationPlan({ ...plan, assets: [...plan.assets, asset] }));
    for (const patch of [{ name: `extra-${asset.name}` }, { sha256: 'invalid' }, { size: 0 }]) {
      assert.throws(() => validateApplicationPlan({ ...plan, assets: plan.assets.map(candidate => candidate === asset ? { ...asset, ...patch } : candidate) }));
    }
  }
  assert.throws(() => validateApplicationPlan({ ...plan, schemaVersion: 3 }));
});

test('the updater release boundary cannot be bypassed by selecting the legacy schema', () => {
  for (const tag of ['v0.2.4', 'v0.2.10', 'v0.3.0', 'v0.10.0', 'v1.0.0']) {
    assert.throws(() => validateApplicationPlan(fixture({ schemaVersion: 1, tag }).plan), /schemaVersion 2/);
    validateApplicationPlan(fixture({ schemaVersion: 2, tag }).plan);
  }
  for (const tag of ['v0.1.99', 'v0.2.2', 'v0.2.3']) {
    validateApplicationPlan(fixture({ schemaVersion: 1, tag }).plan);
    assert.throws(() => validateApplicationPlan(fixture({ schemaVersion: 2, tag }).plan), /v0\.2\.4/);
  }
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

test('schema 2 checksums must authenticate all eleven payloads, including every update attachment', () => {
  const { plan, sums } = fixture({ schemaVersion: 2 });
  validateChecksums(plan, sums);
  assert.throws(() => validateChecksums(plan, Buffer.concat([sums, Buffer.from('x')])));
  const lines = sums.toString().trimEnd().split('\n');
  assert.equal(lines.length, 11);
  const checksumPlan = bytes => ({ ...plan, assets: plan.assets.map(asset => asset.name === 'SHA256SUMS.txt' ? { ...asset, size: bytes.length, sha256: sha256(bytes) } : asset) });
  for (let index = 0; index < lines.length; index++) {
    for (const changed of [
      lines.filter((_, i) => i !== index),
      [...lines, lines[index]],
      lines.map((line, i) => i === index ? line.replace(/^[a-f0-9]{64}/, 'f'.repeat(64)) : line),
      lines.map((line, i) => i === index ? line.replace('  ', '  ../') : line),
    ]) {
      const bytes = Buffer.from(changed.join('\n') + '\n');
      assert.throws(() => validateChecksums(checksumPlan(bytes), bytes));
    }
  }
  const duplicated = Buffer.from([...lines.slice(0, -1), lines[0]].join('\n') + '\n');
  assert.throws(() => validateChecksums(checksumPlan(duplicated), duplicated));
});

test('schema 2 remote attachment integrity is rechecked before publication and failures never write', async () => {
  const original = fixture({ schemaVersion: 2 });
  validateApplicationAssets(original.plan, original.release);
  for (const asset of original.release.assets) {
    for (const changed of [
      original.release.assets.filter(candidate => candidate.id !== asset.id),
      [...original.release.assets, asset],
      ...[{ name: 'extra.zip' }, { size: asset.size + 1 }, { digest: `sha256:${'b'.repeat(64)}` }, { state: 'new' }].map(patch => original.release.assets.map(candidate => candidate.id === asset.id ? { ...asset, ...patch } : candidate)),
    ]) {
      const f = fixture({ schemaVersion: 2 }), c = client(f, { refreshed: { ...f.release, assets: changed } });
      await assert.rejects(releaseApplication(f.plan, { ...c.options, mode: 'publish' }));
      assert.equal(c.calls.some(call => call.method), false);
    }
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
  f.release.target_commitish = 'b'.repeat(40);
  const c = client(f, { latest: { id: 50, tag_name: 'v0.3.0', draft: false, prerelease: false }, tag: { ref: `refs/tags/${f.plan.tag}`, object: { type: 'commit', sha: f.release.target_commitish } } });
  assert.equal((await releaseApplication(f.plan, { ...c.options, mode: 'publish' })).action, 'already-published');
  assert.equal(c.calls.some(call => call.method), false);
  assert.deepEqual(c.calls.map(call => call.path), ['/releases/42']);
  assert.deepEqual(c.downloads, ['SHA256SUMS.txt']);
});

test('existing lightweight and annotated tags must resolve to the workflow commit before any write', async () => {
  const wrong = 'b'.repeat(40), annotation = 'c'.repeat(40);
  for (const object of [{ type: 'commit', sha: wrong }, { type: 'tag', sha: annotation }]) {
    const f = fixture(), c = client(f, { tag: { ref: `refs/tags/${f.plan.tag}`, object }, annotations: new Map([[annotation, { sha: annotation, object: { type: 'commit', sha: wrong } }]]) });
    await assert.rejects(releaseApplication(f.plan, { ...c.options, mode: 'publish' }), /tag.*workflow commit/);
    assert.equal(c.calls.some(call => call.method), false);
  }
});

test('matching nested annotated tags publish without resolving or changing ignored target_commitish', async () => {
  const f = fixture(), first = 'c'.repeat(40), second = 'd'.repeat(40);
  f.release.target_commitish = 'old-branch';
  const c = client(f, { tag: { ref: `refs/tags/${f.plan.tag}`, object: { type: 'tag', sha: first } }, annotations: new Map([[first, { sha: first, object: { type: 'tag', sha: second } }], [second, { sha: second, object: { type: 'commit', sha: head } }]]), target: { sha: 'b'.repeat(40) } });
  assert.equal((await releaseApplication(f.plan, { ...c.options, mode: 'publish' })).action, 'published');
  assert.deepEqual(c.calls.filter(call => call.path.startsWith('/git/tags/')).map(call => call.path), [`/git/tags/${first}`, `/git/tags/${second}`]);
  assert.equal(c.calls.some(call => call.path.startsWith('/commits/')), false);
  assert.deepEqual(c.calls.slice(-2).map(call => call.path), ['/git/ref/heads/main', '/releases/42']);
  assert.deepEqual(c.calls.filter(call => call.method), [{ path: '/releases/42', method: 'PATCH', body: { draft: false, prerelease: false, make_latest: 'true' } }]);
});

test('an absent tag rejects a draft target that resolves away from the workflow commit without writing', async () => {
  const f = fixture(); f.release.target_commitish = 'other-branch';
  const c = client(f, { tag: null, target: { sha: 'b'.repeat(40) } });
  await assert.rejects(releaseApplication(f.plan, { ...c.options, mode: 'publish' }), /target.*workflow commit/);
  assert.equal(c.calls.some(call => call.method), false);
});

test('an absent tag resolves the refreshed draft target and pins tag creation to the exact workflow SHA', async () => {
  for (const target of ['main', 'release/application', head]) {
    const f = fixture(), refreshed = { ...f.release, target_commitish: target }, c = client(f, { tag: null, refreshed });
    assert.equal((await releaseApplication(f.plan, { ...c.options, mode: 'publish' })).action, 'published');
    assert.ok(c.calls.some(call => call.path === `/commits/${encodeURIComponent(target)}`));
    assert.deepEqual(c.calls.filter(call => call.method), [{ path: '/releases/42', method: 'PATCH', body: { draft: false, prerelease: false, make_latest: 'true', target_commitish: head } }]);
  }
});

test('malformed, cyclic and over-deep tag objects fail within a bounded number of reads and never write', async () => {
  const f = fixture(), first = 'c'.repeat(40), second = 'd'.repeat(40), ref = `refs/tags/${f.plan.tag}`;
  const chain = Array.from({ length: 9 }, (_, i) => (i + 1).toString(16).padStart(40, '0'));
  const scenarios = [
    { tag: {} },
    { tag: { ref: 'refs/tags/v0.0.1', object: { type: 'commit', sha: head } } },
    ...[{ type: 'blob', sha: head }, { type: 'commit', sha: 'bad' }].map(object => ({ tag: { ref, object } })),
    { tag: { ref, object: { type: 'tag', sha: first } }, annotations: new Map([[first, { sha: second, object: { type: 'commit', sha: head } }]]) },
    { tag: { ref, object: { type: 'tag', sha: first } }, annotations: new Map([[first, { sha: first, object: null }]]) },
    { tag: { ref, object: { type: 'tag', sha: first } }, annotations: new Map([[first, { sha: first, object: { type: 'tag', sha: second } }], [second, { sha: second, object: { type: 'tag', sha: first } }]]) },
    { tag: { ref, object: { type: 'tag', sha: chain[0] } }, annotations: new Map(chain.map((sha, i) => [sha, { sha, object: { type: i + 1 === chain.length ? 'commit' : 'tag', sha: chain[i + 1] ?? head } }])) },
  ];
  for (const scenario of scenarios) {
    const c = client(f, scenario);
    await assert.rejects(releaseApplication(f.plan, { ...c.options, mode: 'publish' }), /tag|annotation/i);
    assert.equal(c.calls.some(call => call.method), false);
    assert.ok(c.calls.filter(call => call.path.startsWith('/git/tags/')).length <= 8);
  }
});

test('an absent tag requires a valid target_commitish and resolved commit before any write', async () => {
  for (const target_commitish of [undefined, null, '', '.', '..']) {
    const f = fixture(); f.release.target_commitish = target_commitish;
    const c = client(f, { tag: null });
    await assert.rejects(releaseApplication(f.plan, { ...c.options, mode: 'publish' }), /target/);
    assert.equal(c.calls.some(call => call.method), false);
  }
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

test('schema 2 verification stays read-only and publication uses the same trusted main path', async () => {
  const f = fixture({ schemaVersion: 2 }), verify = client(f), publish = client(f, { tag: null });
  assert.equal((await releaseApplication(f.plan, { ...verify.options, mode: 'verify', env: {} })).action, 'verified-draft');
  assert.equal(verify.calls.some(call => call.method), false);
  assert.deepEqual(verify.downloads, ['SHA256SUMS.txt']);
  assert.equal((await releaseApplication(f.plan, { ...publish.options, mode: 'publish' })).action, 'published');
  assert.deepEqual(publish.calls.filter(call => call.method), [{ path: '/releases/42', method: 'PATCH', body: { draft: false, prerelease: false, make_latest: 'true', target_commitish: head } }]);
  assert.deepEqual(publish.downloads, ['SHA256SUMS.txt']);
});

test('schema 2 cannot publish a downgrade, another release identity, an untrusted checkout or stale main', async () => {
  const f = fixture({ schemaVersion: 2 });
  for (const latest of ['v0.2.5', 'v0.2.10', 'v0.3.0', 'v1.0.0', f.plan.tag]) {
    const c = client(f, { latest: { id: 50, tag_name: latest, draft: false, prerelease: false } });
    for (const mode of ['verify', 'publish']) await assert.rejects(releaseApplication(f.plan, { ...c.options, mode }), /downgrade|different release ID/);
    assert.equal(c.calls.some(call => call.method), false);
  }
  for (const options of [{ main: 'b'.repeat(40) }, { tag: { ref: `refs/tags/${f.plan.tag}`, object: { type: 'commit', sha: 'b'.repeat(40) } } }]) {
    const c = client(f, options);
    await assert.rejects(releaseApplication(f.plan, { ...c.options, mode: 'publish' }), /Main advanced|tag.*workflow commit/);
    assert.equal(c.calls.some(call => call.method), false);
  }
  const c = client(f);
  await assert.rejects(releaseApplication(f.plan, { ...c.options, mode: 'publish', env: { ...context(), GITHUB_REF: 'refs/heads/dev' } }), /main branch in GitHub Actions/);
  assert.deepEqual(c.calls, []);
});
