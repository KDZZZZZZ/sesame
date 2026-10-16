import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as publication from './release-plugins.mjs';
import { publicationReview } from './plugin-r2-review.mjs';
import { publishObjects } from './publish-plugin-r2.mjs';
import { API2_PLAN_DIRECTORY } from './plugin-r2.mjs';

const workflow = name => readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');

test('required API 2 checks use trusted base validators without deleted Git or release history', () => {
  const source = workflow('plugin-api-v1.yml');
  assert.match(source, /package-static-review:\s+runs-on: ubuntu-latest\s+timeout-minutes: 15/);
  for (const name of ['plugin-api-v1.yml', 'plugin-catalog.yml']) {
    const text = workflow(name);
    assert.match(text, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}[\s\S]*?path: trusted/);
    assert.match(text, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}[\s\S]*?path: candidate/);
    assert.doesNotMatch(text, /node candidate\/|--publish(?:\s|$)|contents: write|if test -f/);
  }
  for (const root of ['api-v1', 'optional-api-v1']) assert.ok(source.includes(`node trusted/plugins/api-v1/scripts/plugin-lock.mjs --check --source candidate/plugins/${root}`));
  assert.ok(source.includes('node trusted/.github/scripts/plugin-r2.mjs --check candidate'));
  assert.ok(source.includes('node trusted/.github/scripts/release-application.mjs --check candidate'));
  assert.ok(source.includes('trusted/.github/scripts/plugin-r2.test.mjs'));
  assert.ok(source.includes('trusted/.github/scripts/dev-source-ci.test.mjs'));
  const catalog = workflow('plugin-catalog.yml');
  assert.match(catalog, /catalog-static-review:/);
  assert.ok(catalog.includes('node trusted/.github/scripts/validate-catalog.mjs candidate'));
  assert.ok(catalog.includes('trusted/.github/scripts/catalog.test.mjs'));
  for (const name of readdirSync(new URL('../workflows/', import.meta.url)).filter(name => name.endsWith('.yml'))) {
    assert.doesNotMatch(workflow(name), /2aeb09c9d5d4a8e78572e1d7e23afe574570597e|historical\/|CATALOG_BASE_SHA|validate-api1-catalog\.mjs|api1-catalog\.test\.mjs|api1-required-catalog\.test\.mjs|release-plugins\.mjs --check/, name);
  }
  assert.equal(existsSync(new URL('../workflows/plugin-api1-release.yml', import.meta.url)), false, 'Retire the API 1 release workflow');
});

test('main-only publication retains current API 2 validation and has no dev publication trigger', () => {
  for (const name of ['application-release.yml', 'plugin-r2.yml']) {
    const publisher = workflow(name);
    assert.match(publisher, /push:\s+branches: \[main\]/);
    assert.match(publisher, /github\.ref == 'refs\/heads\/main'/);
    assert.match(publisher, /ref: \$\{\{ github\.sha \}\}/);
    assert.doesNotMatch(publisher, /branches: \[[^\]]*dev/);
    assert.ok(publisher.includes('node .github/scripts/validate-catalog.mjs .'));
  }
  assert.equal(API2_PLAN_DIRECTORY, '.github/plugin-r2-api2');
  assert.ok(workflow('plugin-r2.yml').includes("paths: ['.github/plugin-r2-api2/**']"));
  assert.ok(workflow('contribution-policy.yml').includes('contribution-policy:'));
});

test('shared R2 review imports retain the upstream publication helper exports', () => {
  for (const name of ['api', 'allReviews', 'graphql', 'trustedChecks', 'reviewEvidence']) assert.equal(typeof publication[name], 'function', name);
  assert.equal(typeof publicationReview, 'function');
  assert.equal(typeof publishObjects, 'function');
});

test('current publication still requires successful pull_request_target checks on the reviewed head', () => {
  const review = readFileSync(new URL('./release-plugins.mjs', import.meta.url), 'utf8');
  assert.match(review, /item\.workflow\.event === 'pull_request_target'/);
  assert.match(review, /item\.head_sha === pr\.head\.sha/);
});
