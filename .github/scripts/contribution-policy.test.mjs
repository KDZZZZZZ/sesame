import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contributionRoute, semanticReviewRequested, REPOSITORY } from './contribution-policy.mjs';
import { REVIEW_MARKER } from './semantic-review.mjs';

const repository = () => ({ full_name: REPOSITORY });
const pullRequest = () => ({ repository: repository(), pull_request: {
  number: 51, user: { login: 'KDZZZZZZ', type: 'User' },
  base: { ref: 'dev', repo: repository() },
  head: { ref: 'fix/contribution', sha: 'a'.repeat(40), repo: repository() },
} });
const comment = body => ({ repository: repository(), action: 'created', issue: { number: 51, pull_request: {} }, comment: { user: { login: 'KDZZZZZZ', type: 'User' }, body } });
const requested = event => semanticReviewRequested('issue_comment', event, 'KDZZZZZZ', 'refs/heads/main');

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

test('ordinary review requests, bot updates and marker mentions do not request a final gate', () => {
  for (const body of ['@codex review', '<!-- codex-pull-request-review-summary -->', `Discuss ${REVIEW_MARKER}`, '/sesame-review later', '', ' /sesame-review']) {
    assert.equal(requested(comment(body)), false, body);
  }
  const event = comment(REVIEW_MARKER); event.comment.user = { login: 'reviewer[bot]', type: 'Bot' };
  assert.equal(requested(event), false);
});

test('owner attestations and the exact explicit command can request substantive review', () => {
  for (const body of [REVIEW_MARKER + '\n```json\n{}\n```', '/sesame-review']) {
    const event = comment(body);
    assert.equal(requested(event), true);
    event.action = 'edited';
    assert.equal(requested(event), true);
    event.action = 'deleted';
    assert.equal(requested(event), false);
  }
});

test('a comment cannot authorize a gate from another actor, issue, repository or branch', () => {
  const event = comment('/sesame-review');
  assert.equal(semanticReviewRequested('issue_comment', event, 'contributor', 'refs/heads/main'), false);
  assert.equal(semanticReviewRequested('issue_comment', event, 'KDZZZZZZ', 'refs/heads/dev'), false);
  assert.equal(semanticReviewRequested('pull_request_review', event, 'KDZZZZZZ', 'refs/heads/main'), false);
  delete event.issue.pull_request;
  assert.equal(requested(event), false);
  const foreign = comment('/sesame-review'); foreign.repository.full_name = 'other/sesame';
  assert.equal(requested(foreign), false);
});

test('manual dispatch still requires owner, trusted main and an actual PR number', () => {
  const event = { repository: repository(), inputs: { pull_request: '51' } };
  assert.equal(semanticReviewRequested('workflow_dispatch', event, 'KDZZZZZZ', 'refs/heads/main'), true);
  assert.equal(semanticReviewRequested('workflow_dispatch', event, 'contributor', 'refs/heads/main'), false);
  for (const value of ['0', '-1', '51; echo injected', '9007199254740992']) {
    event.inputs.pull_request = value;
    assert.equal(semanticReviewRequested('workflow_dispatch', event, 'KDZZZZZZ', 'refs/heads/main'), false);
  }
});

test('static workflows cover both integration branches and keep forks as data', () => {
  for (const name of ['plugin-api-v1.yml', 'plugin-catalog.yml']) {
    const workflow = readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');
    assert.equal((workflow.match(/branches: \[main, dev\]/g) ?? []).length, 2);
    assert.doesNotMatch(workflow, /^\s*paths(?:-ignore)?:/m);
    assert.match(workflow, /repository: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \|\| github\.repository \}\}/);
    if (name === 'plugin-catalog.yml') assert.match(workflow, /repository: KDZZZZZZ\/sesame\s+ref: e91f45bdaaf1e0b02304f590656878ae8d23254f\s+path: trusted/);
    else assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}/);
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
  assert.match(semantic, /github\.actor == 'KDZZZZZZ'/);
  assert.match(semantic, /contribution-policy\.mjs --semantic-event/);
  assert.match(semantic, /release-plugins\.mjs --review-check/);
  for (const workflow of [routing, semantic]) assert.doesNotMatch(workflow, /contents: write|persist-credentials: true|pull_request\.head\.(?:sha|repo)/);
});
