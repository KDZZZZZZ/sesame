# Plugin API 1 publication

## Current policy

New GitHub Releases in `KDZZZZZZ/sesame` are reserved for **application versions**
(`vX.Y.Z`). New `plugins-*` Releases are disabled in both the workflow and the
publisher. The historical publisher may verify an already-published archive;
it cannot create or publish another plugin Release, including an existing draft.
Every main push checks the [application release plan](../../RELEASING.md).

Historical plugin Releases, tags, plans, review records and exact bytes remain
available. Sesame 0.2.2's plugin manager validates the existing repository/URL
format, and historical application locks download those archives. Deleting,
making them private, or replacing their URLs would break that compatibility.
`RELEASE-ASSETS.json` at the repository root is the historical 0.2.1 record, not
the plan for the next application version.

Plugin source contributions continue through **fork → dev**, with the owner's
same-repository work-branch exception, then an owner-merged **dev → main** PR.
See [CONTRIBUTING.md](../../CONTRIBUTING.md). A source merge does not update an
installed package or make a new package version available in the catalog.
The catalog may only select actual immutable publications compatible with its
client. Do not add a plan expecting the retired workflow to publish it.

New plugin publications use Cloudflare R2 through
`https://dl.sesame.bot/plugins/api-v1/catalog.json` (catalog schema 2).
Plugin-manager 2.3.0 downloads its catalog and package files from this domain,
while retaining schema 1 validation for historical data. Keep the old endpoint
and archives unchanged for existing clients. Existing Sesame 0.2.2 installations
can explicitly update the manager using their existing plugin tools; future app
builds use the R2 application pin. See [R2 distribution](R2-DISTRIBUTION.md) for
publication and migration, and the [ecosystem policy](../ECOSYSTEM.md) for scope.

Adding source or infrastructure alone does not publish an R2 catalog. The
reviewed plan and successful R2 workflow are the publication record.

## Historical publication protocol

The remainder documents how existing archives were published and how their
evidence is verified. It is retained for reproducibility, not as instructions to
create another plugin Release in this repository.

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

Before merging, run `Plugin semantic review gate` (on an owner's completed review
record, exact `/sesame-review` command, or PR-number workflow input). Ordinary
comments and bot progress messages do not run the final gate. This historical
gate accepts same-repository PRs into main; it is not the dev contribution check.
The trusted main-branch workflow
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

Under the historical workflow, merging the PR into main triggered `Plugin API 1
release`. It verified the merged
PR, successful GitHub Actions checks and completed semantic review on its exact
head before merge, immutable source bytes, and absence of unresolved
changes-requested reviews or code-review discussions. It created a draft release,
uploaded the archive, package lock, application pin, checksums and review record,
then published a prerelease. That publishing path is now disabled. Existing
published assets are never overwritten. Withdrawal remains a catalog
metadata change; it does not erase prior releases or rewrite their bytes.

`review.json` records actual check URLs and review authors/states. Automated
comments, self-approval and stale approvals do not count as human approval. If
there is no independent approval on the exact head, it says `not-recorded`.
GitHub's configured repository rules govern merging; the publisher does not
bypass them or claim a green check certifies safety. The legacy installation
catalog and the Plugin API 1 catalog remain separate.

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

## Distribution profiles

The core development 19 and optional development 13 plans from PR 44 were never
published. A Windows startup-path review arrived after merge, so the publisher
rejected the changed review-thread set. This follow-up supersedes those unpublished
plans with core development 20 and optional development 14; the source and failed
publication remain in Git and Actions history. The publisher does not permanently
reserve names for unpublished tags. Any future plan using such a name would still
require a new complete exact-head review and pre-merge gate; resolving the old
discussion does not authorize publication from its earlier review snapshot.

The distribution has a `core` profile for app-bundled foundational packages and
an `optional` profile for on-demand integrations and methods. `bundle-profile.json` belongs to
the immutable source and is validated before archive creation. New plans declare
`profile: "core"` or `profile: "optional"`; a plan/profile mismatch is rejected.
Profile-less historical source commits keep their original build behavior.
Historically, publishing the two reviewed groups separately preceded a
metadata-only catalog PR selecting their actual published source, archive, lock
and review hashes. Existing catalog entries retain those identities. Never use
the descriptive `inventory.json` as an installation catalog. Application release
status is checked independently of historical plugin archive publication.
