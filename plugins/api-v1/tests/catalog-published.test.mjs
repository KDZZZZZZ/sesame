import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPublished } from '../scripts/catalog.mjs';

const release = {
  tag: 'plugins-api-v1-dev.21', releaseCommit: '1'.repeat(40),
  archive: { url: 'https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.21/plugins.tar.gz', sha256: '2'.repeat(64) },
  lock: { url: 'https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.21/official-plugins.lock.json', sha256: '3'.repeat(64) },
  review: { url: 'https://github.com/KDZZZZZZ/sesame/releases/download/plugins-api-v1-dev.21/review.json', sha256: '4'.repeat(64) },
};
const catalog = { releases: [release] };
const metadata = item => ({
  tag_name: item.tag, target_commitish: item.releaseCommit, draft: false, prerelease: true, published_at: '2026-10-09T22:39:52Z',
  assets: [item.archive, item.lock, item.review].map(asset => ({ browser_download_url: asset.url, digest: `sha256:${asset.sha256}`, size: 123 })),
});

async function withEnvironmentToken(token, callback) {
  const previous = process.env.GITHUB_TOKEN;
  if (token === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = token;
  try { await callback(); }
  finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  }
}

test('publication verification sends an explicit token only to the fixed GitHub API endpoint and refuses redirects', async () => {
  let calls = 0;
  await checkPublished(catalog, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/KDZZZZZZ/sesame/releases/tags/plugins-api-v1-dev.21');
    assert.equal(options.headers.Authorization, 'Bearer fixture-explicit-token');
    assert.equal(options.headers.Accept, 'application/vnd.github+json');
    assert.equal(options.redirect, 'error'); options.signal.throwIfAborted();
    return new Response(JSON.stringify(metadata(release)));
  }, { token: 'fixture-explicit-token' });
  assert.equal(calls, 1);
});

test('publication verification uses GITHUB_TOKEN by default and permits explicit override or anonymous access', async () => {
  await withEnvironmentToken('fixture-environment-token', async () => {
    for (const [options, authorization] of [[undefined, 'Bearer fixture-environment-token'], [{ token: 'fixture-override-token' }, 'Bearer fixture-override-token'], [{ token: '' }, undefined]]) {
      await checkPublished(catalog, async (_url, request) => {
        assert.equal(request.headers.Authorization, authorization);
        return new Response(JSON.stringify(metadata(release)));
      }, options);
    }
  });
  await withEnvironmentToken(undefined, async () => {
    await checkPublished(catalog, async (_url, request) => {
      assert.equal(Object.hasOwn(request.headers, 'Authorization'), false);
      return new Response(JSON.stringify(metadata(release)));
    });
  });
});

test('release tag input cannot change the credential destination or introduce a query or fragment', async () => {
  const unusual = { ...release, tag: '//example.invalid/release?redirect=https://example.invalid/#fragment' };
  await checkPublished({ releases: [unusual] }, async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.github.com');
    assert.equal(parsed.pathname, '/repos/KDZZZZZZ/sesame/releases/tags/' + encodeURIComponent(unusual.tag));
    assert.equal(parsed.search, ''); assert.equal(parsed.hash, '');
    assert.equal(parsed.username, ''); assert.equal(parsed.password, '');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    return new Response(JSON.stringify(metadata(unusual)));
  }, { token: 'fixture-token' });
});

test('HTTP failures remain failures without retry, anonymous fallback or credential-bearing response text', async () => {
  for (const status of [302, 401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(checkPublished(catalog, async (_url, options) => {
      calls++;
      assert.equal(options.redirect, 'error');
      return new Response('fixture-secret-do-not-log', { status, headers: { Location: 'https://example.invalid/token-receiver' } });
    }, { token: 'fixture-secret-do-not-log' }), error => {
      assert.equal(error.message, `Cannot confirm published release ${release.tag}: HTTP ${status}`);
      assert.equal(error.message.includes('fixture-secret-do-not-log'), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('authentication does not relax release identity and asset digest verification', async () => {
  const changed = metadata(release); changed.assets[0].digest = 'sha256:' + '0'.repeat(64);
  await assert.rejects(checkPublished(catalog, async () => new Response(JSON.stringify(changed)), { token: 'fixture-token' }), /Published asset differs/);
  const failure = new Error('network unavailable');
  await assert.rejects(checkPublished(catalog, async () => { throw failure; }, { token: 'fixture-token' }), error => error === failure);
});

test('CI scopes the read-only token to trusted publication verification and runs these regressions from trusted source', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/plugin-api-v1.yml', import.meta.url), 'utf8');
  assert.equal((workflow.match(/GITHUB_TOKEN:/g) ?? []).length, 1);
  assert.match(workflow, /permissions:\s+contents: read\s+jobs:/);
  assert.match(workflow, /env:\s+GITHUB_TOKEN: \$\{\{ github\.token \}\}\s+run: node trusted\/\.github\/scripts\/validate-api1-catalog\.mjs candidate --published/);
  assert.ok(workflow.includes('trusted/plugins/api-v1/tests/catalog-published.test.mjs'));
  assert.doesNotMatch(workflow, /\bnode\s+candidate\//);
});
