# Review and withdrawal

Plugin PRs target `dev`. The trusted base checks the candidate’s package declarations, module boundaries, paths, licenses, evaluation fixtures, inventory and distribution digests. Authors provide separate runtime evidence for integrations and external effects. Review actual permission changes, third-party provenance and negative cases in the PR.

Maintainers promote packages with a fixed source commit and a reviewed `dev` → `main` PR. See [publication and review](api-v1/PUBLISHING.md) for the release command and GitHub review procedure.

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
