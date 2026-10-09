import { createHash } from 'node:crypto';

export const REVIEW_MARKER = '<!-- sesame:agent-review:v1 -->';
const BOTS = new Map([['chatgpt-codex-connector[bot]', 199175422]]);
const assert = (value, message) => { if (!value) throw new Error(message); };
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;

/** A maintainer records an actual, separate agent's review. This is an audit
 * attestation by that account, not a GitHub human approval or proof of safety. */
export function parseAgentReview(body) {
  if (typeof body !== 'string' || !body.startsWith(REVIEW_MARKER)) return null;
  const match = body.slice(REVIEW_MARKER.length).match(/^\s*```json\s*\n([\s\S]*?)\n```\s*$/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

export function semanticReviewEvidence(pr, reviews, comments, threads, permissions, now = new Date().toISOString()) {
  const cutoff = time(pr.merged ? pr.merged_at : now);
  assert(Number.isFinite(cutoff) && /^[a-f0-9]{40}$/.test(pr.head.sha), 'Semantic review requires a fixed head and valid merge/check time');
  const latest = new Map();
  for (const review of reviews) if (!['COMMENTED', 'PENDING'].includes(review.state)) latest.set(review.user.login, review);
  assert(![...latest.values()].some(review => review.state === 'CHANGES_REQUESTED'), 'An unresolved changes-requested review prevents publication');
  assert(threads.every(thread => thread.isResolved === true), 'Unresolved code-review discussions prevent publication');
  const approved = reviews.filter(review => review.user?.type === 'Bot' && BOTS.get(review.user.login) === review.user.id && review.state === 'APPROVED' && review.commit_id === pr.head.sha && Number.isFinite(time(review.submitted_at)) && time(review.submitted_at) <= cutoff).sort((a, b) => time(b.submitted_at) - time(a.submitted_at))[0];
  if (approved) return { kind: 'platform-bot', decision: 'approved', headSha: pr.head.sha, reviewer: approved.user.login, submittedAt: approved.submitted_at, url: approved.html_url, reviewId: approved.id, humanApproval: false };
  const candidates = [];
  for (const comment of comments) {
    const role = permissions.get(comment.user?.login), record = parseAgentReview(comment.body);
    if (!['admin', 'maintain'].includes(role) || comment.user?.type !== 'User' || !record) continue;
    const created = time(comment.created_at), updated = time(comment.updated_at), reviewed = time(record.reviewedAt);
    if (![created, updated, reviewed].every(Number.isFinite) || reviewed > created || created > updated || updated > cutoff) continue;
    if (record.schemaVersion !== 1 || record.kind !== 'agent' || record.headSha !== pr.head.sha || record.decision !== 'no-blocking-findings' || record.independent !== true) continue;
    if (typeof record.reviewer !== 'string' || record.reviewer.length < 3 || record.reviewer.length > 200 || typeof record.scope !== 'string' || record.scope.length < 40 || record.scope.length > 16000) continue;
    if (!Array.isArray(record.findings) || record.findings.length > 100 || record.findings.some(finding => !['fixed', 'not-applicable'].includes(finding.status) || typeof finding.explanation !== 'string' || finding.explanation.length < 20)) continue;
    candidates.push({ kind: 'maintainer-recorded-agent', decision: record.decision, headSha: record.headSha, reviewer: record.reviewer, reviewedAt: record.reviewedAt, recordedAt: comment.created_at, updatedAt: comment.updated_at, recordedBy: { login: comment.user.login, role }, url: comment.html_url, commentId: comment.id, bodySha256: createHash('sha256').update(comment.body).digest('hex'), scope: record.scope, findings: record.findings, humanApproval: false, provenance: 'The authenticated repository maintainer attests to a separate agent review; this is not an independent human approval.' });
  }
  candidates.sort((a, b) => time(b.recordedAt) - time(a.recordedAt));
  assert(candidates.length > 0, 'Missing completed semantic review on the exact PR head before merge (approved platform bot or maintainer-recorded separate agent review)');
  return candidates[0];
}

export async function readSemanticReview(pr, reviews, api, graphql) {
  const comments = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api(`/issues/${pr.number}/comments?per_page=100&page=${page}`); comments.push(...batch);
    if (batch.length < 100) break;
    assert(page < 10, 'Semantic review comment pagination exceeded budget');
  }
  const threads = []; let cursor = null;
  for (let page = 0; page < 10; page++) {
    const result = await graphql({ query: 'query($number:Int!,$cursor:String){repository(owner:"KDZZZZZZ",name:"sesame"){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id isResolved} pageInfo{hasNextPage endCursor}}}}}', variables: { number: pr.number, cursor } });
    const connection = result.data?.repository?.pullRequest?.reviewThreads;
    assert(!result.errors && connection && Array.isArray(connection.nodes), 'Cannot verify code-review discussion state');
    threads.push(...connection.nodes); if (!connection.pageInfo.hasNextPage) break;
    assert(page < 9 && connection.pageInfo.endCursor, 'Code-review thread pagination exceeded budget'); cursor = connection.pageInfo.endCursor;
  }
  const authors = [...new Set(comments.filter(comment => comment.body?.startsWith(REVIEW_MARKER)).map(comment => comment.user.login))];
  assert(authors.length <= 30, 'Too many semantic review recorders');
  const permissions = new Map(await Promise.all(authors.map(async author => {
    const result = await api(`/collaborators/${encodeURIComponent(author)}/permission`, { allowMissing: true });
    return [author, ['admin', 'maintain'].find(role => result?.permission === role || result?.role_name === role) ?? result?.permission];
  })));
  const evidence = semanticReviewEvidence(pr, reviews, comments, threads, permissions);
  return { ...evidence, resolvedThreadIds: threads.map(thread => thread.id).sort() };
}

export function validateGateSnapshot(pr, semantic, snapshot, run, artifact, workflowId) {
  const merged = time(pr.merged_at), checked = time(snapshot.checkedAt), started = time(run.run_started_at), completed = time(run.updated_at), created = time(artifact.created_at);
  assert(pr.merged === true && Number.isFinite(merged), 'Published review gate needs an actual merge time');
  assert(run.workflow_id === workflowId && run.path === '.github/workflows/plugin-semantic-review.yml' && ['issue_comment', 'workflow_dispatch'].includes(run.event) && run.head_branch === 'main' && run.status === 'completed' && run.conclusion === 'success', 'Semantic gate must come from the successful trusted main workflow');
  assert([checked, started, completed, created].every(Number.isFinite) && started <= checked && checked <= created && created <= completed && completed <= merged, 'Semantic gate must complete before merge; post-merge resolution cannot repair it');
  assert(snapshot.schemaVersion === 1 && snapshot.repository === 'KDZZZZZZ/sesame' && snapshot.pullRequest === pr.number && snapshot.headSha === pr.head.sha && snapshot.merged === false, 'Semantic gate snapshot identifies a different or already merged PR');
  assert(JSON.stringify(snapshot.semantic) === JSON.stringify(semantic), 'Semantic review or resolved discussion set differs from the pre-merge snapshot');
  return { runId: run.id, url: run.html_url, workflowId, workflowRevision: run.head_sha, checkedAt: snapshot.checkedAt, completedAt: run.updated_at, artifactId: artifact.id };
}
