import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as publication from './release-plugins.mjs';
import { publicationReview } from './plugin-r2-review.mjs';
import { publishObjects } from './publish-plugin-r2.mjs';
import { API2_PLAN_DIRECTORY } from './plugin-r2.mjs';

const historicalCommit = '2aeb09c9d5d4a8e78572e1d7e23afe574570597e';
const workflow = name => readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');

test('current API 2 source and historical API 1 publication checks use separate trusted validators', () => {
  const source = workflow('plugin-api-v1.yml');
  assert.match(source, /package-static-review:\s+runs-on: ubuntu-latest\s+timeout-minutes: 15/);
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}[\s\S]*?path: trusted/);
  assert.match(source, new RegExp(`repository: KDZZZZZZ/sesame\\s+ref: ${historicalCommit}\\s+path: historical\\s+persist-credentials: false`));
  for (const root of ['api-v1', 'optional-api-v1']) assert.ok(source.includes(`node trusted/plugins/api-v1/scripts/plugin-lock.mjs --check --source candidate/plugins/${root}`));
  for (const command of ['validate-api1-catalog.mjs candidate --published', 'release-plugins.mjs --check candidate', 'plugin-r2.mjs --check candidate']) {
    assert.ok(source.includes(`node historical/.github/scripts/${command}`));
    if (!command.startsWith('plugin-r2.mjs')) assert.equal(source.includes(`node trusted/.github/scripts/${command}`), false);
  }
  assert.ok(source.includes('node trusted/.github/scripts/plugin-r2.mjs --check candidate'));
  assert.ok(source.includes('trusted/.github/scripts/plugin-r2.test.mjs'));
  assert.ok(source.includes('historical/.github/scripts/api1-catalog.test.mjs historical/.github/scripts/plugin-r2.test.mjs'));
  assert.ok(source.includes('trusted/.github/scripts/dev-source-ci.test.mjs'));
  assert.doesNotMatch(source, /node candidate\/|--publish(?:\s|$)|contents: write/);
});

test('legacy catalog checks stay pinned and dev pushes have no publication trigger', () => {
  const catalog = workflow('plugin-catalog.yml');
  assert.match(catalog, new RegExp(`repository: KDZZZZZZ/sesame\\s+ref: ${historicalCommit}\\s+path: trusted\\s+persist-credentials: false`));
  assert.ok(catalog.includes('node trusted/.github/scripts/validate-catalog.mjs candidate'));
  assert.match(catalog, /CATALOG_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \|\| github\.sha \}\}/);
  assert.doesNotMatch(catalog, /node candidate\/|--publish(?:\s|$)|contents: write/);
  for (const name of ['application-release.yml', 'plugin-r2.yml']) {
    const publisher = workflow(name);
    assert.match(publisher, /push:\s+branches: \[main\]/);
    assert.match(publisher, /github\.ref == 'refs\/heads\/main'/);
    assert.doesNotMatch(publisher, /branches: \[[^\]]*dev/);
  }
});

test('shared R2 review imports retain the upstream publication helper exports', () => {
  for (const name of ['api', 'allReviews', 'graphql', 'trustedChecks', 'reviewEvidence']) assert.equal(typeof publication[name], 'function', name);
  assert.equal(typeof publicationReview, 'function');
  assert.equal(typeof publishObjects, 'function');
});

test('new API 2 plans and API 1 history have separate validation and publication paths', () => {
  assert.equal(API2_PLAN_DIRECTORY, '.github/plugin-r2-api2');
  const publisher = workflow('plugin-r2.yml');
  assert.ok(publisher.includes("paths: ['.github/plugin-r2-api2/**']"));
  assert.ok(publisher.includes('node historical/.github/scripts/plugin-r2.mjs --check .'));
  assert.ok(publisher.includes('node .github/scripts/plugin-r2.mjs --check .'));
  for (const name of ['application-release.yml', 'plugin-api1-release.yml']) {
    const source = workflow(name);
    assert.ok(source.includes(`ref: ${historicalCommit}`));
    assert.ok(source.includes('node historical/.github/scripts/validate-api1-catalog.mjs . --published'));
    assert.doesNotMatch(source, /node plugins\/api-v1\/scripts\/catalog\.mjs --check/);
  }
});
