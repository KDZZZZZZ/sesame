const assert = (value, message) => { if (!value) throw new Error(message); };
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const decisive = reviews => reviews.filter(review => !['COMMENTED', 'PENDING'].includes(review.state))
  .sort((a, b) => time(a.submitted_at) - time(b.submitted_at) || a.id - b.id);

export function semanticReviewEvidence(pr, reviews, threads, permissions, now = new Date().toISOString()) {
  const cutoff = time(pr.merged ? pr.merged_at : now);
  assert(Number.isFinite(cutoff) && /^[a-f0-9]{40}$/.test(pr.head.sha), 'Approval requires a fixed head and valid merge/check time');
  const latest = new Map(decisive(reviews).map(review => [review.user.id, review]));
  assert(![...latest.values()].some(review => review.state === 'CHANGES_REQUESTED'), 'An unresolved changes-requested review prevents publication');
  assert(threads.every(thread => thread.isResolved === true), 'Unresolved code-review discussions prevent publication');
  const approval = [...latest.values()].reverse().find(review =>
    review.state === 'APPROVED' && review.commit_id === pr.head.sha &&
    review.user.type === 'User' && Number.isSafeInteger(review.user.id) && Number.isSafeInteger(pr.user?.id) &&
    review.user.id !== pr.user.id && Number.isFinite(time(review.submitted_at)) && time(review.submitted_at) <= cutoff &&
    ['maintain','admin'].includes(permissions.get(review.user.login)));
  assert(approval, 'A native Approve review from a different repository maintainer on the current head is required before merge');
  return { kind: 'github-review', decision: 'approved', headSha: pr.head.sha, reviewer: approval.user.login,
    role: permissions.get(approval.user.login), submittedAt: approval.submitted_at, url: approval.html_url, reviewId: approval.id, humanApproval: true };
}

export async function readSemanticReview(pr, reviews, api, graphql) {
  const threads = []; let cursor = null;
  for (let page = 0; page < 10; page++) {
    const result = await graphql({ query: 'query($number:Int!,$cursor:String){repository(owner:"KDZZZZZZ",name:"sesame"){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id isResolved} pageInfo{hasNextPage endCursor}}}}}', variables: { number: pr.number, cursor } });
    const connection = result.data?.repository?.pullRequest?.reviewThreads;
    assert(!result.errors && connection && Array.isArray(connection.nodes), 'Cannot verify code-review discussion state');
    threads.push(...connection.nodes); if (!connection.pageInfo.hasNextPage) break;
    assert(page < 9 && connection.pageInfo.endCursor, 'Code-review thread pagination exceeded budget'); cursor = connection.pageInfo.endCursor;
  }
  const dismissals = []; cursor = null;
  for (let page = 0; page < 10; page++) {
    const result = await graphql({ query: 'query($number:Int!,$cursor:String){repository(owner:"KDZZZZZZ",name:"sesame"){pullRequest(number:$number){timelineItems(itemTypes:[REVIEW_DISMISSED_EVENT],first:100,after:$cursor){nodes{... on ReviewDismissedEvent{id createdAt actor{login} previousReviewState review{databaseId commit{oid}} url}} pageInfo{hasNextPage endCursor}}}}}', variables: { number: pr.number, cursor } });
    const connection = result.data?.repository?.pullRequest?.timelineItems;
    assert(!result.errors && connection && Array.isArray(connection.nodes), 'Cannot verify review dismissal history');
    dismissals.push(...connection.nodes.map(event => ({ id: event.id, dismissedAt: event.createdAt, actor: event.actor?.login ?? null, previousState: event.previousReviewState, reviewId: event.review?.databaseId ?? null, commit: event.review?.commit?.oid ?? null, url: event.url })));
    if (!connection.pageInfo.hasNextPage) break;
    assert(page < 9 && connection.pageInfo.endCursor, 'Review dismissal pagination exceeded budget'); cursor = connection.pageInfo.endCursor;
  }
  const authors = [...new Set(reviews.filter(review => review.state === 'APPROVED' && review.commit_id === pr.head.sha &&
    review.user?.type === 'User' && review.user.id !== pr.user?.id).map(review => review.user.login))];
  const permissions = new Map(await Promise.all(authors.map(async author => {
    const result = await api(`/collaborators/${encodeURIComponent(author)}/permission`, { allowMissing: true });
    return [author, ['admin', 'maintain'].find(role => result?.permission === role || result?.role_name === role)];
  })));
  const evidence = semanticReviewEvidence(pr, reviews, threads, permissions);
  const reviewStates = reviews.filter(review => !['COMMENTED', 'PENDING'].includes(review.state)).map(review => ({ id: review.id, author: review.user.login, authorType: review.user.type, state: review.state, commit: review.commit_id, submittedAt: review.submitted_at })).sort((a, b) => a.id - b.id);
  return { ...evidence, resolvedThreadIds: threads.map(thread => thread.id).sort(), reviewStates, reviewDismissals: dismissals.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function validateGateSnapshot(pr, semantic, snapshot, run, artifact, workflowId) {
  const merged = time(pr.merged_at), checked = time(snapshot.checkedAt), started = time(run.run_started_at), completed = time(run.updated_at), created = time(artifact.created_at);
  assert(pr.merged === true && Number.isFinite(merged), 'Published review gate needs an actual merge time');
  assert(run.workflow_id === workflowId && run.path === '.github/workflows/plugin-semantic-review.yml' && ['workflow_run', 'workflow_dispatch'].includes(run.event) && run.head_branch === 'main' && run.status === 'completed' && run.conclusion === 'success', 'Semantic gate must come from the successful trusted main workflow');
  assert([checked, started, completed, created].every(Number.isFinite) && started <= checked && checked <= created && created <= completed && completed <= merged, 'Semantic gate must complete before merge; post-merge resolution cannot repair it');
  assert(snapshot.schemaVersion === 1 && snapshot.repository === 'KDZZZZZZ/sesame' && snapshot.pullRequest === pr.number && snapshot.headSha === pr.head.sha && snapshot.merged === false, 'Semantic gate snapshot identifies a different or already merged PR');
  assert(JSON.stringify(snapshot.semantic) === JSON.stringify(semantic), 'Semantic review or resolved discussion set differs from the pre-merge snapshot');
  return { runId: run.id, url: run.html_url, workflowId, workflowRevision: run.head_sha, checkedAt: snapshot.checkedAt, completedAt: run.updated_at, artifactId: artifact.id };
}
