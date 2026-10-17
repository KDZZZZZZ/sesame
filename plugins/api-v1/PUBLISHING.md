# Plugin API 2 publication

The source directories retain the names `plugins/api-v1` and
`plugins/optional-api-v1`; their current manifests, capabilities and locks use
**API 2**. Updated packages for the 0.2.4 release require Sesame **>=0.2.4**;
unchanged packages retain **>=0.2.3**. Each manifest's `engines.sesame` is authoritative.
Every plugin explicitly declares its
capabilities, input/output schemas, consumers, dependencies and usage guidance.
Preserve each package's license, author and third-party provenance.

GitHub Releases are reserved for application versions (`vX.Y.Z`). The
owner-authorized 2026-10-16 history reset removes plugin GitHub Releases and
their historical publication plans. Application installers remain unchanged;
historical application tags retain their original source trees without old
ancestors. Old plugin GitHub URLs and API 1 installation flows are retired.

## Source and distribution

Contributions use fork → dev, or an owner work branch → dev, followed by an
owner-merged dev → main PR. Required checks are `package-static-review`,
`catalog-static-review` and `contribution-policy`. Candidate packages are data:
trusted-base validators check identities, explicit capabilities, licenses,
paths, module boundaries and every locked byte without executing candidate code.
PR checks do not rerun the old base validator's own unit tests. Validator
regressions run once on the actual main revision before plugin publication.
Behavior, external dependencies and platform integration require separate tests.

The R2 catalog is
[`https://dl.sesame.bot/plugins/api-v1/catalog.json`](https://dl.sesame.bot/plugins/api-v1/catalog.json).
Its schema is 2 and `apiVersion` is `2`; the URL path is a stable transport name.
The source inventory is descriptive and never authorizes installation.

1. Freeze a public source commit from the current Git history. Both committed
   source locks must match it. Changes to already-published package bytes require
   a new package version.
2. Prepare `.github/plugin-r2-api2/dev.N.json`, with a new increasing sequence,
   exact source SHA, publishing dev → main PR number, explicit core/optional IDs,
   and independently rebuilt archive and lock SHA-256 values. Only selected
   packages enter publication. Kurumi is excluded from this release.
3. Validate the plan with `node .github/scripts/plugin-r2.mjs --check .`, finish
   independent review on the final PR head and resolve all discussions. Run the
   trusted `Plugin semantic review gate` before merge.
4. Merge dev → main. The R2 publisher verifies the actual merged PR, exact-head
   static checks, pre-merge review snapshot and unchanged plan bytes. It writes
   immutable objects, reads them back, verifies public download access and then
   conditionally promotes the catalog. Main must still match the workflow SHA.

Reusing an unchanged package version is valid only with identical package bytes.
A history migration needs a new source identity and publication sequence; old
PR review evidence cannot authorize the replacement plan. Never overwrite an
existing archive, package object or review record.

## Independent review record

An allowlisted platform-bot `APPROVED` review or an authenticated maintainer
record of a separate reviewing agent can satisfy the semantic gate. A progress
comment, pending review or thumbs-up alone cannot. The author cannot describe
their own implementation work as an independent review.

After the separate review actually finishes, a maintainer records:

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
  "scope": "Describe the reviewed diff, failure paths, tests and limitations.",
  "findings": []
}
```
````

Each finding must be fixed or explained as not applicable. Both creation and
last edit of the record must precede merge. The gate binds the final head,
review identities/states/timestamps, dismissal events and resolved discussion
set. A changed head requires a fresh review. A later discussion or post-merge
gate cannot repair an early merge. The publisher checks the registered trusted
workflow, its successful pre-merge completion and its stored snapshot against
current GitHub evidence.

This is an authenticated record of agent review, not independent human approval
or a guarantee of runtime safety. The publication's `review.json` records actual
checks, review scope and evidence. Do not fabricate review or test results.

## Host bundles and installation

The core profile contains nine default plugins. The optional profile is selected
explicitly and is not automatically assembled into the application. Host builds
pin the published core archive, source commit and lock digest; optional test
fixtures pin their selected archive separately.

API 1 hosts must upgrade before using these packages. Existing installed package
state is not silently overwritten. Package install/update and loading remain
separate from configuring accounts or installing external runtimes.

See [R2 distribution](R2-DISTRIBUTION.md), [contribution rules](../../CONTRIBUTING.md)
and [application releases](../../RELEASING.md).
