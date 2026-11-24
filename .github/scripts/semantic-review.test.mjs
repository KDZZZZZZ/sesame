import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticReviewEvidence, readSemanticReview, validateGateSnapshot } from './semantic-review.mjs';

const sha = 'a'.repeat(40), merge = '2026-10-09T16:00:00Z';
const pr = () => ({ number: 10, merged: true, merged_at: merge, head: { sha }, user: { id: 1 } });
const review = () => ({ id: 42, state: 'APPROVED', commit_id: sha, submitted_at: '2026-10-09T15:30:00Z',
  user: { login: 'maintainer', type: 'User', id: 9 }, html_url: 'https://github.com/example/review/42' });
const check = (reviews = [review()], role = 'maintain', threads = []) =>
  semanticReviewEvidence(pr(), reviews, threads, new Map([['maintainer', role]]));
test('a native independent maintainer approval is bound to the current commit and pre-merge time', () => {
  assert.equal(check().kind, 'github-review');
  assert.equal(check().humanApproval, true);
  for (const patch of [{ state: 'DISMISSED' }, { commit_id: 'c'.repeat(40) }, { state: 'COMMENTED' },
    { submitted_at: '2026-10-09T16:01:00Z' }, { user: {...review().user, id:1} }, { user: {...review().user,type:'Bot'} }]) {
    assert.throws(() => check([{...review(),...patch}]), /native Approve/);
  }
  assert.throws(() => check([review()], 'write'), /native Approve/);
  assert.throws(() => check([review(), {...review(), id:43, state:'CHANGES_REQUESTED'}]), /changes-requested/);
  assert.throws(() => check([review()], 'admin', [{isResolved:false}]), /Unresolved/);
});
test('review collection verifies thread pages and authenticated recorder role, without running PR code', async () => {
  const paths = [], cursors = [];
  const reviews = [review(), { id: 31, user: { login: 'reviewer', type: 'User' }, state: 'DISMISSED', commit_id: sha, submitted_at: '2026-10-09T15:10:00Z' }];
  const result = await readSemanticReview(pr(), reviews, async path => { paths.push(path); return { permission: 'write', role_name: 'maintain' }; }, async ({ query, variables }) => {
    if (query.includes('timelineItems')) return { data: { repository: { pullRequest: { timelineItems: { nodes: [{ id: 'dismissal-1', createdAt: '2026-10-09T15:20:00Z', actor: { login: 'maintainer' }, previousReviewState: 'CHANGES_REQUESTED', review: { databaseId: 31, commit: { oid: sha } }, url: 'https://github.com/example/dismissal' }], pageInfo: { hasNextPage: false } } } } } };
    cursors.push(variables.cursor); return { data: { repository: { pullRequest: { reviewThreads: { nodes: [{ id: variables.cursor ?? 'first', isResolved: true }], pageInfo: { hasNextPage: variables.cursor === null, endCursor: 'next' } } } } } };
  });
  assert.equal(result.role, 'maintain'); assert.deepEqual(cursors, [null, 'next']); assert(paths.includes('/collaborators/maintainer/permission'));
  assert.deepEqual(result.reviewStates.map(item => item.id), [31, 42]);
  assert.deepEqual(result.reviewStates[0], { id: 31, author: 'reviewer', authorType: 'User', state: 'DISMISSED', commit: sha, submittedAt: '2026-10-09T15:10:00Z' });
  assert.equal(result.reviewDismissals[0].dismissedAt, '2026-10-09T15:20:00Z'); assert.equal(result.reviewDismissals[0].reviewId, 31);
  await assert.rejects(() => readSemanticReview(pr(), [], async () => [], async () => ({ errors: [{ message: 'denied' }] })), /Cannot verify/);
});

test('publication requires trusted pre-merge workflow evidence of the resolved discussion set', () => {
  const semantic = { ...check(), resolvedThreadIds: ['thread-1'] };
  const snapshot = { schemaVersion: 1, repository: 'KDZZZZZZ/sesame', pullRequest: 10, headSha: sha, merged: false, checkedAt: '2026-10-09T15:46:30Z', semantic };
  const run = { id: 50, workflow_id: 20, path: '.github/workflows/plugin-semantic-review.yml', event: 'workflow_run', head_branch: 'main', head_sha: 'c'.repeat(40), status: 'completed', conclusion: 'success', run_started_at: '2026-10-09T15:46:00Z', updated_at: '2026-10-09T15:48:00Z', html_url: 'https://github.com/KDZZZZZZ/sesame/actions/runs/50' };
  const artifact = { id: 60, created_at: '2026-10-09T15:47:00Z' };
  assert.equal(validateGateSnapshot(pr(), semantic, snapshot, run, artifact, 20).runId, 50);
  for (const change of [{ workflow_id: 21 }, { event: 'pull_request_review' }, { head_branch: 'untrusted' }, { conclusion: 'failure' }]) assert.throws(() => validateGateSnapshot(pr(), semantic, snapshot, { ...run, ...change }, artifact, 20), /trusted main workflow/);
  for (const change of [{ updated_at: '2026-10-09T16:01:00Z' }, { run_started_at: '2026-10-09T15:47:00Z' }]) assert.throws(() => validateGateSnapshot(pr(), semantic, snapshot, { ...run, ...change }, artifact, 20), /before merge/);
  for (const change of [{ merged: true }, { headSha: 'b'.repeat(40) }, { pullRequest: 11 }]) assert.throws(() => validateGateSnapshot(pr(), semantic, { ...snapshot, ...change }, run, artifact, 20), /different or already merged/);
  // A thread first resolved after merge has no passing pre-merge snapshot;
  // a newly introduced discussion cannot borrow an older passing snapshot.
  assert.throws(() => validateGateSnapshot(pr(), { ...semantic, resolvedThreadIds: ['thread-1', 'late-thread'] }, snapshot, run, artifact, 20), /differs from the pre-merge/);
  assert.throws(() => validateGateSnapshot(pr(), semantic, { ...snapshot, checkedAt: '2026-10-09T16:01:00Z' }, { ...run, updated_at: '2026-10-09T16:02:00Z' }, { ...artifact, created_at: '2026-10-09T16:01:30Z' }, 20), /before merge/);
  // A request for changes introduced after the gate and dismissed after merge
  // must not disappear when publication reads only its latest DISMISSED state.
  const reviewed = { ...semantic, reviewStates: [], reviewDismissals: [] };
  const afterDismissal = { ...reviewed, reviewStates: [{ id: 9, author: 'reviewer', state: 'DISMISSED', commit: sha, submittedAt: '2026-10-09T15:59:00Z' }], reviewDismissals: [{ id: 'dismissal-9', reviewId: 9, dismissedAt: '2026-10-09T16:01:00Z' }] };
  assert.throws(() => validateGateSnapshot(pr(), afterDismissal, { ...snapshot, semantic: reviewed }, run, artifact, 20), /differs from the pre-merge/);
  for (const field of ['reviewStates', 'reviewDismissals']) assert.throws(() => validateGateSnapshot(pr(), { ...reviewed, [field]: afterDismissal[field] }, { ...snapshot, semantic: reviewed }, run, artifact, 20), /differs from the pre-merge/);
});
