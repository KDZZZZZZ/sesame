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

Merging the PR into main triggers `Plugin API 1 release`. It verifies the merged
PR, successful GitHub Actions checks on its exact head, immutable source bytes,
and absence of unresolved changes-requested reviews. It creates a draft release,
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
