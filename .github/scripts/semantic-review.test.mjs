import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_MARKER, semanticReviewEvidence, readSemanticReview, validateGateSnapshot } from './semantic-review.mjs';

const sha = 'a'.repeat(40), merge = '2026-10-09T16:00:00Z';
const pr = () => ({ number: 10, merged: true, merged_at: merge, head: { sha } });
const record = () => ({ schemaVersion: 1, kind: 'agent', headSha: sha, decision: 'no-blocking-findings', independent: true, reviewer: 'Codex separate reviewer', reviewedAt: '2026-10-09T15:40:00Z', scope: 'Reviewed the entire proposed diff, source boundaries, failure paths, and relevant regression tests.', findings: [] });
const body = value => REVIEW_MARKER + '\n```json\n' + JSON.stringify(value) + '\n```';
const comment = () => ({ id: 99, user: { login: 'maintainer', type: 'User' }, body: body(record()), created_at: '2026-10-09T15:45:00Z', updated_at: '2026-10-09T15:45:00Z', html_url: 'https://github.com/KDZZZZZZ/sesame/pull/10#issuecomment-99' });
const roles = () => new Map([['maintainer', 'admin']]);
const check = (comments = [comment()], reviews = [], threads = []) => semanticReviewEvidence(pr(), reviews, comments, threads, roles());

test('a completed separate-agent record pins exact head, author, decision, body hash and pre-merge times', () => {
  const result = check(); assert.equal(result.kind, 'maintainer-recorded-agent'); assert.equal(result.humanApproval, false);
  assert.equal(result.headSha, sha); assert.equal(result.recordedBy.role, 'admin'); assert.match(result.bodySha256, /^[a-f0-9]{64}$/);
  assert.equal(semanticReviewEvidence({ ...pr(), merged: false }, [], [comment()], [], roles(), merge).headSha, sha);
});
test('missing, stale, untrusted, self-described human approval and unfinished decisions are rejected', () => {
  assert.throws(() => check([]), /Missing completed semantic/);
  for (const change of [{ headSha: 'b'.repeat(40) }, { decision: 'pending' }, { kind: 'human' }, { independent: false }, { scope: 'looks good' }, { findings: [{ status: 'open', explanation: 'The incorrect market symbol remains unfixed.' }] }, { reviewedAt: '2026-10-09T15:50:00Z' }]) assert.throws(() => check([{ ...comment(), body: body({ ...record(), ...change }) }]), /Missing completed semantic/);
  for (const user of [{ login: 'outsider', type: 'User' }, { login: 'maintainer', type: 'Bot' }]) assert.throws(() => check([{ ...comment(), user }]), /Missing completed semantic/);
  assert.throws(() => semanticReviewEvidence(pr(), [], [comment()], [], new Map([['maintainer', 'write']])), /Missing completed semantic/);
});
test('post-merge review or edits cannot be used to retroactively satisfy the release gate', () => {
  for (const change of [{ created_at: '2026-10-09T16:01:00Z', updated_at: '2026-10-09T16:01:00Z' }, { updated_at: '2026-10-09T16:01:00Z' }, { updated_at: 'invalid' }]) assert.throws(() => check([{ ...comment(), ...change }]), /Missing completed semantic/);
});
test('actual unresolved discussions and changes requested block an otherwise complete agent record', () => {
  assert.throws(() => check([comment()], [], [{ isResolved: false }]), /Unresolved code-review/);
  assert.throws(() => check([comment()], [{ user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED' }]), /changes-requested/);
  assert.equal(check([comment()], [], [{ isResolved: true }]).decision, 'no-blocking-findings');
});
test('only an allowlisted platform bot approval on the exact head before merge is accepted directly', () => {
  const review = { id: 5, user: { login: 'chatgpt-codex-connector[bot]', id: 199175422, type: 'Bot' }, state: 'APPROVED', commit_id: sha, submitted_at: '2026-10-09T15:40:00Z', html_url: 'https://github.com/KDZZZZZZ/sesame/pull/10#pullrequestreview-5' };
  assert.equal(check([], [review]).kind, 'platform-bot');
  for (const change of [{ state: 'COMMENTED' }, { state: 'PENDING' }, { commit_id: 'b'.repeat(40) }, { submitted_at: '2026-10-09T16:01:00Z' }, { user: { ...review.user, id: 1 } }]) assert.throws(() => check([], [{ ...review, ...change }]), /Missing completed semantic/);
});
test('review collection verifies thread pages and authenticated recorder role, without running PR code', async () => {
  const paths = [], cursors = [];
  const result = await readSemanticReview(pr(), [], async path => { paths.push(path); return path.includes('/comments') ? [comment()] : { permission: 'write', role_name: 'maintain' }; }, async ({ variables }) => { cursors.push(variables.cursor); return { data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: true }], pageInfo: { hasNextPage: variables.cursor === null, endCursor: 'next' } } } } } }; });
  assert.equal(result.recordedBy.role, 'maintain'); assert.deepEqual(cursors, [null, 'next']); assert(paths.includes('/collaborators/maintainer/permission'));
  await assert.rejects(() => readSemanticReview(pr(), [], async () => [], async () => ({ errors: [{ message: 'denied' }] })), /Cannot verify/);
});

test('publication requires trusted pre-merge workflow evidence of the resolved discussion set', () => {
  const semantic = { ...check(), resolvedThreadIds: ['thread-1'] };
  const snapshot = { schemaVersion: 1, repository: 'KDZZZZZZ/sesame', pullRequest: 10, headSha: sha, merged: false, checkedAt: '2026-10-09T15:46:30Z', semantic };
  const run = { id: 50, workflow_id: 20, path: '.github/workflows/plugin-semantic-review.yml', event: 'issue_comment', head_branch: 'main', head_sha: 'c'.repeat(40), status: 'completed', conclusion: 'success', run_started_at: '2026-10-09T15:46:00Z', updated_at: '2026-10-09T15:48:00Z', html_url: 'https://github.com/KDZZZZZZ/sesame/actions/runs/50' };
  const artifact = { id: 60, created_at: '2026-10-09T15:47:00Z' };
  assert.equal(validateGateSnapshot(pr(), semantic, snapshot, run, artifact, 20).runId, 50);
  for (const change of [{ workflow_id: 21 }, { event: 'pull_request_review' }, { head_branch: 'untrusted' }, { conclusion: 'failure' }]) assert.throws(() => validateGateSnapshot(pr(), semantic, snapshot, { ...run, ...change }, artifact, 20), /trusted main workflow/);
  for (const change of [{ updated_at: '2026-10-09T16:01:00Z' }, { run_started_at: '2026-10-09T15:47:00Z' }]) assert.throws(() => validateGateSnapshot(pr(), semantic, snapshot, { ...run, ...change }, artifact, 20), /before merge/);
  for (const change of [{ merged: true }, { headSha: 'b'.repeat(40) }, { pullRequest: 11 }]) assert.throws(() => validateGateSnapshot(pr(), semantic, { ...snapshot, ...change }, run, artifact, 20), /different or already merged/);
  // A thread first resolved after merge has no passing pre-merge snapshot;
  // a newly introduced discussion cannot borrow an older passing snapshot.
  assert.throws(() => validateGateSnapshot(pr(), { ...semantic, resolvedThreadIds: ['thread-1', 'late-thread'] }, snapshot, run, artifact, 20), /differs from the pre-merge/);
  assert.throws(() => validateGateSnapshot(pr(), semantic, { ...snapshot, checkedAt: '2026-10-09T16:01:00Z' }, { ...run, updated_at: '2026-10-09T16:02:00Z' }, { ...artifact, created_at: '2026-10-09T16:01:30Z' }, 20), /before merge/);
});
