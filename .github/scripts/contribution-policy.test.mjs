import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contributionRoute, REPOSITORY } from './contribution-policy.mjs';

const repository = () => ({ full_name: REPOSITORY });
const pullRequest = () => ({ repository: repository(), pull_request: {
  number: 51, user: { login: 'KDZZZZZZ', type: 'User' },
  base: { ref: 'dev', repo: repository() },
  head: { ref: 'fix/contribution', sha: 'a'.repeat(40), repo: repository() },
} });
test('fork contributions target dev without granting contributor code execution', () => {
  const event = pullRequest();
  event.pull_request.user.login = 'contributor';
  event.pull_request.head.repo = { full_name: 'contributor/sesame', fork: true };
  event.pull_request.head.ref = 'dev';
  assert.equal(contributionRoute(event).route, 'fork-to-dev');
  event.pull_request.base.ref = 'main';
  assert.throws(() => contributionRoute(event), /Only this repository's dev/);
});

test('only owner work branches enter dev from the same repository', () => {
  const event = pullRequest();
  assert.deepEqual(contributionRoute(event), { route: 'owner-work-to-dev', pullRequest: 51, headSha: 'a'.repeat(40) });
  event.pull_request.user.login = 'contributor';
  assert.throws(() => contributionRoute(event), /owner-authored/);
  event.pull_request.user.login = 'KDZZZZZZ';
  for (const ref of ['main', 'dev']) {
    event.pull_request.head.ref = ref;
    assert.throws(() => contributionRoute(event), /owner-authored/);
  }
});

test('release promotion requires canonical dev to main and rejects other targets', () => {
  const event = pullRequest();
  event.pull_request.base.ref = 'main';
  assert.throws(() => contributionRoute(event), /Only this repository's dev/);
  event.pull_request.head.ref = 'dev';
  assert.equal(contributionRoute(event).route, 'dev-to-main');
  event.pull_request.base.ref = 'release';
  assert.throws(() => contributionRoute(event), /Contributions must target dev/);
});

test('missing or foreign repository identities cannot pass the metadata gate', () => {
  for (const mutate of [
    event => { event.repository.full_name = 'other/sesame'; },
    event => { event.pull_request.base.repo.full_name = 'other/sesame'; },
    event => { event.pull_request.head.repo = null; },
    event => { event.pull_request.head.sha = 'dev'; },
    event => { event.pull_request.head.repo = { full_name: 'contributor/sesame', fork: false }; },
  ]) {
    const event = pullRequest(); mutate(event);
    assert.throws(() => contributionRoute(event));
  }
});

test('static workflows cover both integration branches and keep forks as data', () => {
  for (const name of ['plugin-ci.yml']) {
    const workflow = readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');
    assert.equal((workflow.match(/branches: \[main, dev\]/g) ?? []).length, 2);
    assert.doesNotMatch(workflow, /^\s*paths(?:-ignore)?:/m);
    assert.match(workflow, /repository: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \|\| github\.repository \}\}/);
    assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}/);
    assert.doesNotMatch(workflow, /\b(?:node|npm|bash|sh|python3?)\s+(?:\.\/)?candidate\//);
    assert.doesNotMatch(workflow, /contents: write|persist-credentials: true/);
  }
});

test('routing and semantic workflows execute trusted main with read-only permissions', () => {
  const routing = readFileSync(new URL('../workflows/contribution-policy.yml', import.meta.url), 'utf8');
  const semantic = readFileSync(new URL('../workflows/plugin-semantic-review.yml', import.meta.url), 'utf8');
  assert.match(routing, /ref: main/);
  assert.match(routing, /contribution-policy\.mjs --pull-request/);
  assert.match(semantic, /github\.ref == 'refs\/heads\/main'/);
  assert.match(semantic, /workflow_run:[\s\S]*workflows: \[Plugin CI\]/);
  assert.match(semantic, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(semantic, /release-plugins\.mjs --review-check/);
  for (const workflow of [routing, semantic]) assert.doesNotMatch(workflow, /contents: write|persist-credentials: true|pull_request\.head\.(?:sha|repo)/);
});
