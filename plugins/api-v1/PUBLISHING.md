# Development plugin publication

Plugin changes are proposed through a pull request. CI checks the submitted files
as data with the validator from the trusted base commit; it never imports a
candidate plugin or runs its setup hooks. New validators must reach the base in a
separate infrastructure PR before package submissions depend on them.

To request a release, commit a JSON plan under `.github/plugin-releases/` with the
development tag, exact public source commit, package root, archive filename and
SHA-256, lock SHA-256, and the publishing PR number. The deterministic archive
builder must reproduce both digests. Source commits and the release plan are part
of the reviewed PR. Include behavior/platform evidence in package documentation;
the static workflow does not replace those checks.

Archives use deterministic tar entries and a fixed gzip container with stored
DEFLATE blocks. This deliberately avoids zlib-version-dependent compressed bytes;
the package locks and extraction format are unchanged.

The release tag identifies the main-branch publishing revision, which contains
the reviewed release plan and publisher. The archive and application pin retain
the plan's exact package `sourceCommit`; `review.json` records both identities.
This uses GitHub's normal contents-write token without requesting workflow-write
credentials for a historical commit whose workflow files differ from main.

Before merging, finish the semantic code review on the final PR head and resolve
every review discussion. A source or release-plan change requires a fresh review
of the new head. `Plugin semantic review gate` checks an actual allowlisted
platform-bot `APPROVED` review, or a maintainer's public record of an actual,
separate reviewing agent. A bot comment, pending review, or thumbs-up reaction
alone does not prove an exact-head approval and does not satisfy the gate.

When a separate agent performs the review, a repository administrator or
maintainer records its result as a PR comment in this format **only after the
review was actually completed**. The recorder may also be the PR author; this is
an authenticated maintainer attestation to agent work, not an independent human
approval. Record the reviewing agent, what it inspected, and dispositions for
findings. Do not manufacture an approval or describe the author's own coding as
independent review.

````text
<!-- sesame:agent-review:v1 -->
```json
{
  "schemaVersion": 1,
  "kind": "agent",
  "headSha": "FINAL_40_CHARACTER_PR_HEAD",
  "decision": "no-blocking-findings",
  "independent": true,
  "reviewer": "ACTUAL_SEPARATE_REVIEWING_AGENT",
  "reviewedAt": "ACTUAL_UTC_COMPLETION_TIME",
  "scope": "Describe the complete reviewed diff, failure paths, tests and practical limitations.",
  "findings": []
}
```
````

Each finding, if any, needs `status: fixed` or `status: not-applicable` and a
concrete `explanation`; open findings fail the gate. The publisher verifies the
recorder's repository role via GitHub, the exact PR head, decision and timestamps,
and the current unresolved-discussion state. Both the comment's creation and
last edit must precede the merge. `review.json` preserves its URL, author,
reviewer, times, scope, findings, and body SHA-256. This authenticates who recorded
the review; it cannot independently prove the quality of an agent's reasoning.

Before merging, run `Plugin semantic review gate` (automatically on PR comment
events or with its PR-number workflow input). The trusted main-branch workflow
stores an artifact identifying the open PR head, actual review, resolved
discussion IDs, formal review IDs/states/commits/submission times, and GitHub's
observable dismissal events (review ID, previous state, actor and time). The
publisher matches this entire set against publication-time GitHub data; a later
request for changes cannot be erased by dismissing it after merge. Malformed
maintainer records are ignored without masking a later valid record. The
publisher verifies the registered workflow identity, main
revision, successful completion and artifact times **before merge**, then matches
the current review and discussion set to that snapshot. It does not infer when a
thread was resolved from its current `isResolved` flag; GitHub does not expose a
resolution timestamp through this thread API. A post-merge gate run, post-merge
resolution without a passing earlier snapshot, or new discussion absent from the
snapshot cannot repair an early merge.

For a local read-only preview, run `node .github/scripts/release-plugins.mjs
--review-check . PR_NUMBER` with a GitHub read token; this cannot replace the
trusted workflow artifact. Confirm the returned head is still current before
merging. A review written or edited after merge is rejected; use a new reviewed
PR instead of retroactively filling in evidence. After publication, the durable
release review record preserves the gate identity and snapshot; historical
retries do not depend on the workflow artifact's 90-day retention period.

Merging the PR into main triggers `Plugin API 1 release`. It verifies the merged
PR, successful GitHub Actions checks and completed semantic review on its exact
head before merge, immutable source bytes, and absence of unresolved
changes-requested reviews or code-review discussions. It creates a draft release,
uploads the archive, package lock, application pin, checksums and review record,
then publishes a prerelease. Existing published assets are never overwritten.
Use a new version and tag for changed packages. Withdrawal remains a catalog
metadata change; it does not erase prior releases or rewrite their bytes.

`review.json` records actual check URLs and review authors/states. Automated
comments, self-approval and stale approvals do not count as human approval. If
there is no independent approval on the exact head, it says `not-recorded`.
GitHub's configured repository rules govern merging; the publisher does not
bypass them or claim a green check certifies safety. The stable 0.1.4 catalog and
API 1 development releases remain separate.

## Historical release boundary

Official development 4–5 and optional development 1–2 were published with the
earlier **static-check-only** gate. In [PR 9](https://github.com/KDZZZZZZ/sesame/pull/9),
the semantic bot review arrived at 2026-10-09 15:49:34 UTC, after the 15:48:39 UTC
merge and the [publication run](https://github.com/KDZZZZZZ/sesame/actions/runs/37954492972).
It found the AKShare 920-series Beijing routing defect. Those releases must not
be described as having passed semantic review before publication. Their original
`review.json` and assets stay immutable; the defect is fixed by a new package
version and prerelease. Every new publication under the updated publisher uses
the pre-merge semantic gate above, while retries of already published releases
only verify their historical bytes and evidence.
