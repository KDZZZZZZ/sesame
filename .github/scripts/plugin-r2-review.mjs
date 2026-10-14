import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, allReviews, graphql, trustedChecks, reviewEvidence } from './release-plugins.mjs';
import { readSemanticReview, validateGateSnapshot } from './semantic-review.mjs';

const repository = 'KDZZZZZZ/sesame';
const check = (value, message) => { if (!value) throw new Error(message); };
const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });

// The existing pre-merge semantic gate is shared with R2 publication. Its
// artifact is evidence from trusted main, never a file supplied by the PR.
export async function publicationReview(root, plan, planPath) {
  const pr = await api(`/pulls/${plan.pullRequest}`);
  check(pr.merged && pr.base.ref === 'main' && pr.head.ref === 'dev' && pr.head.repo.full_name === repository, 'R2 publication requires the merged dev-to-main PR');
  git(root, ['merge-base', '--is-ancestor', plan.sourceCommit, pr.head.sha]);
  git(root, ['merge-base', '--is-ancestor', pr.merge_commit_sha, 'HEAD']);
  const localPlan = readFileSync(join(root, planPath));
  check(git(root, ['show', `${pr.head.sha}:${planPath}`]).equals(localPlan) && git(root, ['show', `${pr.merge_commit_sha}:${planPath}`]).equals(localPlan), 'R2 plan differs from the reviewed publishing PR');
  const reviews = await allReviews(pr.number);
  const evidence = reviewEvidence({ ...plan, tag: `r2-${plan.id}` }, pr, reviews, await trustedChecks(pr));
  const semantic = await readSemanticReview(pr, reviews, api, graphql);
  const workflow = await api('/actions/workflows/plugin-semantic-review.yml');
  const name = `plugin-semantic-review-${pr.number}`;
  const { artifacts } = await api(`/actions/artifacts?name=${name}&per_page=100`);
  const candidates = artifacts.filter(item => item.name === name && !item.expired && Date.parse(item.created_at) <= Date.parse(pr.merged_at)).sort((a, b) => b.id - a.id);
  let gate;
  for (const artifact of candidates) {
    const run = await api(`/actions/runs/${artifact.workflow_run.id}`);
    if (run.conclusion !== 'success' || Date.parse(run.updated_at) > Date.parse(pr.merged_at)) continue;
    const directory = mkdtempSync(join(tmpdir(), 'sesame-r2-review-'));
    try {
      execFileSync('gh', ['run', 'download', String(run.id), '--repo', repository, '--name', name, '--dir', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
      const snapshot = JSON.parse(readFileSync(join(directory, 'review-gate.json'), 'utf8'));
      gate = validateGateSnapshot(pr, semantic, snapshot, run, artifact, workflow.id);
      git(root, ['merge-base', '--is-ancestor', run.head_sha, pr.merge_commit_sha]);
      break;
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  check(gate, 'No successful semantic review snapshot completed before merge');
  return { ...evidence, id: plan.id, semantic, gate, publication: {
    commit: pr.merge_commit_sha,
    workflow: `https://github.com/${repository}/blob/${pr.merge_commit_sha}/.github/workflows/plugin-r2.yml`,
    trigger: 'Reviewed dev-to-main plan; immutable R2 objects verified before catalog promotion',
  } };
}
