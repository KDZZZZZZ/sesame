# Review and withdrawal

## Automated review

The `Plugin catalog / catalog-static-review` job validates names, versions,
compatibility, author/license/provenance presence, immutable Git source,
regular file modes, safe paths, size limits, the complete file list and hashes,
package tree digests, declared stdio entrypoints and obvious secret markers.
It compares the candidate package with the pinned source and rejects native
host factories advertised as installable MCP packages. The candidate's own
validator, scripts, setup hooks and plugin code are never run by PR review.
Actions have read-only repository permissions, no stored checkout credentials,
and no release or deployment secrets.

The result is a static validation result. It cannot prove a package is safe,
correct, useful or free of undiscovered secrets. It is not a human review.

## Maintainer review

Before publishing or updating an entry, verify author control and distribution
rights; inspect source changes, external calls and capabilities; check the
minimum app version, static tool schema, prompt/skill instructions and license
notices; and exercise it in a disposable isolated runtime. Preserve the test
command and actual result in the PR. Never run untrusted code with repository
tokens, release credentials, host mounts or production account access.

The initial official export records `human: not-recorded`. Maintainer publication
and agent-assisted static inspection do not become an invented human approval.
An explicit human approval may be recorded using `human: approved`, a real
`reference` to a GitHub PR review, `reviewer` and `reviewedCommit`. The validator
verifies the review against GitHub and the configured maintainer. It is still
not a safety certification. Re-review each released version's changed source.

## Report, withdraw, restore

[Open an issue](https://github.com/KDZZZZZZ/sesame/issues/new) with the exact ID,
version, expected and observed behavior, and public reproduction steps. Do not
include keys, account credentials or private workspace material. Use GitHub's
private vulnerability reporting when enabled for sensitive vulnerabilities.

A maintainer can immediately set `status: withdrawn`, add `withdrawalReason`
and merge an urgent PR. Retain the ID, version, source hashes, author and issue
reference as a tombstone. Website results and the Agent exclude withdrawn
entries from normal discovery and installation. Existing installed copies are
not silently deleted or replaced. Investigate and publish a corrected, tested
version through the same review path before restoring active status.

Changes to this policy, the validator, workflow and CODEOWNERS require special
care: the trusted validator is the enforcement boundary. A workflow is bootstrapped
only after its initial maintainer merge; subsequent PRs run the base version.
