import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, reviewEvidence } from './release-plugins.mjs';

const sha = 'a'.repeat(40);
const plan = () => ({ schemaVersion: 1, sourceCommit: sha, sourceRoot: 'plugins/api-v1', tag: 'plugins-api-v1-dev.4', title: 'Development bundle 4', archive: { name: 'sesame-official-plugins-api-v1-dev.4.tar.gz', sha256: 'b'.repeat(64) }, lockSha256: 'c'.repeat(64), pullRequest: 5 });
const pr = () => ({ merged: true, base: { ref: 'main' }, head: { sha, repo: { full_name: 'KDZZZZZZ/sesame' } }, user: { id: 1 }, merge_commit_sha: 'd'.repeat(40), merged_by: { login: 'maintainer' } });
const checks = () => ['package-static-review', 'catalog-static-review'].map((name, id) => ({ id, name, head_sha: sha, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' }));

test('release plans pin only allowed development roots, exact bytes and PRs', () => {
  assert.equal(validatePlan(plan()).tag, 'plugins-api-v1-dev.4');
  for (const change of [{ sourceCommit: 'main' }, { sourceRoot: '../../private' }, { tag: 'v1.0.0' }, { archive: { name: '../asset', sha256: 'b'.repeat(64) } }, { pullRequest: 0 }]) assert.throws(() => validatePlan({ ...plan(), ...change }));
});
test('publication requires exact-head checks and a merged PR; automated comments are not approval', () => {
  const automatic = { user: { login: 'bot', type: 'Bot', id: 2 }, state: 'COMMENTED', commit_id: sha };
  assert.equal(reviewEvidence(plan(), pr(), [automatic], checks()).human.status, 'not-recorded');
  assert.throws(() => reviewEvidence(plan(), { ...pr(), merged: false }, [], checks()), /merged/);
  assert.throws(() => reviewEvidence(plan(), pr(), [], checks().map(item => ({ ...item, head_sha: 'old' }))), /exact reviewed head/);
  assert.throws(() => reviewEvidence(plan(), pr(), [], checks().map(item => ({ ...item, conclusion: 'failure' }))), /successful/);
});
test('self/bot/stale approvals do not qualify and unresolved change requests stop publication', () => {
  const review = { user: { login: 'reviewer', type: 'User', id: 3 }, state: 'APPROVED', commit_id: sha };
  assert.equal(reviewEvidence(plan(), pr(), [review], checks()).human.status, 'approved');
  for (const other of [{ ...review, user: { ...review.user, id: 1 } }, { ...review, user: { ...review.user, type: 'Bot' } }, { ...review, commit_id: 'old' }]) assert.equal(reviewEvidence(plan(), pr(), [other], checks()).human.status, 'not-recorded');
  assert.throws(() => reviewEvidence(plan(), pr(), [{ ...review, state: 'CHANGES_REQUESTED' }], checks()), /unresolved/);
});
