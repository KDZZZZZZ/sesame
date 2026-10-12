import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REVIEW_MARKER } from './semantic-review.mjs';

export const REPOSITORY = 'KDZZZZZZ/sesame';
const OWNER = REPOSITORY.split('/')[0];
const same = (left, right) => typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

// Read GitHub's event metadata only. No candidate package, workflow or script is loaded.
export function contributionRoute(event) {
  const pr = event?.pull_request;
  assert(same(event?.repository?.full_name, REPOSITORY) && same(pr?.base?.repo?.full_name, REPOSITORY), 'Contribution policy requires a PR into the canonical repository');
  assert(Number.isSafeInteger(pr.number) && pr.number > 0 && /^[a-f0-9]{40}$/.test(pr.head?.sha ?? ''), 'Contribution policy requires a fixed PR identity and head');
  assert(typeof pr.head?.ref === 'string' && pr.head.ref && typeof pr.head.repo?.full_name === 'string', 'The contributor branch and repository must still exist');
  const local = same(pr.head.repo.full_name, REPOSITORY);
  let route;
  if (pr.base.ref === 'main') {
    assert(local && pr.head.ref === 'dev', 'Only this repository\'s dev branch may propose a release into main');
    route = 'dev-to-main';
  } else {
    assert(pr.base.ref === 'dev', 'Contributions must target dev; releases use dev to main');
    if (local) {
      assert(same(pr.user?.login, OWNER) && pr.user?.type === 'User' && !['main', 'dev'].includes(pr.head.ref), 'Same-repository contributions to dev require an owner-authored work branch');
      route = 'owner-work-to-dev';
    } else {
      assert(pr.head.repo.fork === true, 'External contributions to dev must come from a fork');
      route = 'fork-to-dev';
    }
  }
  return { route, pullRequest: pr.number, headSha: pr.head.sha };
}

// This authorizes taking a snapshot, not the review decision. The existing
// semantic validator still checks the exact head, reviewer and open discussions.
export function semanticReviewRequested(eventName, event, actor, ref) {
  if (!same(event?.repository?.full_name, REPOSITORY) || !same(actor, OWNER) || ref !== 'refs/heads/main') return false;
  if (eventName === 'workflow_dispatch') {
    const number = event.inputs?.pull_request;
    return /^[1-9][0-9]*$/.test(number ?? '') && Number.isSafeInteger(Number(number));
  }
  if (eventName !== 'issue_comment' || !['created', 'edited'].includes(event.action) || !event.issue?.pull_request || !same(event.comment?.user?.login, OWNER) || event.comment.user.type !== 'User') return false;
  const body = event.comment.body;
  return typeof body === 'string' && (body.startsWith(REVIEW_MARKER) || body === '/sesame-review');
}

function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (process.argv[2] === '--semantic-event') {
    assert(semanticReviewRequested(process.env.GITHUB_EVENT_NAME, event, process.env.GITHUB_ACTOR, process.env.GITHUB_REF), 'Only an explicit owner review request on trusted main may create a semantic snapshot');
    console.log('Authorized final semantic review request; substantive review checks still apply.');
  } else {
    assert(process.argv[2] === '--pull-request' && process.env.GITHUB_EVENT_NAME === 'pull_request_target', 'Use --pull-request with trusted pull_request_target metadata');
    console.log(JSON.stringify(contributionRoute(event), null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
