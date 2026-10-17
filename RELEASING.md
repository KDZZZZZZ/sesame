# Application releases

New Releases in this repository are Sesame desktop versions named `vX.Y.Z`.
Plugin GitHub Releases were retired during the 2026-10-16 history reset.
Plugins are distributed through the reviewed R2 catalog. Application Release
IDs and installer assets remain unchanged; historical application tags retain
their original source trees as parentless snapshots.

## Build, prepare, promote

1. Build and verify the chosen private application revision in the application
   repository. Test the required platforms and record the actual source revision
   and limitations. This public repository does not contain or build that source.
2. Prepare a **draft** application Release with the version's four installers:
   macOS ARM64 DMG, Windows x64 EXE, Linux x64 AppImage and DEB. Supply `INSTALL.md`
   and `SHA256SUMS.txt`. All three native builds must pass their tests, installer
   extraction and packaged server import before upload. Verify their exact source
   revision, plugin source and source-lock digest, platform, asset set and SHA-256.
   The `Publish verified installer artifacts` workflow accepts GitHub Actions
   artifacts. When private Actions storage is unavailable, the private build can
   stage the same verified files in private draft Releases; a maintainer validates
   and copies those bytes to the public draft. Private staging never publishes an
   application version or replaces the reviewed public promotion step.
   Versions from 0.2.4 use schema 2 with twelve assets: the six files above,
   Windows EXE and Linux DEB blockmaps, and one update feed and plan for each of
   Windows/Linux. `SHA256SUMS.txt` covers all eleven other files. AppImage's
   blockmap is embedded in its installer.
   Set the draft target to this public repository's `main`, and normally leave
   the version tag uncreated until promotion. The publisher will resolve that
   target and pin tag creation to the exact checked `main` commit.
3. Update [`.github/application-release.json`](.github/application-release.json)
   through the owner's work-branch → `dev` PR. Record the canonical repository,
   application tag, numeric draft Release ID, and each asset's exact filename,
   byte size and SHA-256. Review the build evidence alongside this change.
   Update the active README download links and installation guide to that version.
   Do not replace the historical 0.2.1 record in `RELEASE-ASSETS.json`.
4. Open `dev` → `main`. Check the full diff, tests, asset identities and actual
   validation evidence; resolve discussions. Only the owner merges.
5. The `main` push automatically starts the application release workflow. It
   checks the committed plan and source/catalog invariants, verifies the remote
   assets and checksum file, then publishes the matching draft as a normal
   application Release. The workflow explicitly runs the R2 mirror after a new
   publication; it does not rely on a token-generated `release` event.
6. After every immutable asset is mirrored and verified, deploy the website and
   download Worker, then explicitly promote each Windows/Linux update channel.
   Keep mutable manifests and missing-channel responses uncached. The private
   application's promotion script verifies the complete mirrored files before
   writing the channel manifest last; see [desktop updates](AUTO-UPDATES.md).

The main-triggered step is **automatic publication of prepared installers**.
It does not remotely start the private build or manufacture a version for every
documentation change. A future end-to-end build bridge needs separate private
repository permissions and platform build infrastructure.

## Verification and retries

Use Node.js 24+ from the repository root:

```sh
node .github/scripts/release-application.mjs --check .
node --test .github/scripts/release-application.test.mjs
```

The publisher rejects non-application tags, a mismatched Release ID, missing or
duplicate assets, differing sizes or SHA-256 values, and inconsistent installer
checksum entries. It compares GitHub's recorded upload digests and downloads the
small checksum file; it does not claim to rerun platform tests or download and
execute every installer. Actual build/installation evidence remains mandatory
before promotion.

Re-running the plan for an already-published version verifies the same bytes
and does not publish again or replace assets. A changed
asset under an existing version fails. A new draft older than the current latest
application version cannot become latest. Publication is restricted to the
canonical repository and current `main` revision; a stale workflow cannot publish
after main has moved.

Before publishing a draft, any existing lightweight or annotated version tag
must resolve to that exact workflow commit. A different commit, even an ancestor
of `main`, is rejected. Malformed, cyclic or excessively nested annotations fail
verification. If the tag does not exist, the draft's `target_commitish` must
resolve to the workflow commit, and the publication request replaces that target
with the fixed SHA. Already-published versions keep their historical tags and
remain a read-only verification and skip.

If a draft fails verification, fix the preparation or reviewed plan before
retrying. If publication succeeded and only the mirror failed, retry `Mirror
release to R2` with the application tag. A mirror retry must not recreate or
overwrite the GitHub Release. Never bypass a failed digest or overwrite published
assets to make a release pass.

## Plugin compatibility

Sesame **0.2.4** and its 54 published plugins use API 2; Kurumi is excluded.
Eight updated plugins require host >=0.2.4; each package declares its own range.
Release builds select an exact source commit from the rebuilt history and the
corresponding published R2 archive. API 1 hosts must upgrade before installing
API 2 plugins. Historical plugin GitHub URLs are no longer supported; retained
old application installers do not imply that their legacy plugin download
services remain available. Existing R2 objects stay immutable.

See [API 2 publication](plugins/api-v1/PUBLISHING.md) and
[R2 distribution](plugins/api-v1/R2-DISTRIBUTION.md). A new reviewed R2 plan must
record the new source identity after history migration; old PR review evidence
cannot authorize a new source or plan. Plugin publication does not replace
existing application installer bytes.
