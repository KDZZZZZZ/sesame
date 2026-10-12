# Application releases

New Releases in this repository are Sesame desktop versions named `vX.Y.Z`.
Historical `plugins-*` Releases remain public for existing clients and pinned
builds, but the plugin publisher cannot create or publish new ones.

## Build, prepare, promote

1. Build and verify the chosen private application revision in the application
   repository. Test the required platforms and record the actual source revision
   and limitations. This public repository does not contain or build that source.
2. Prepare a **draft** application Release with the version's four installers:
   macOS ARM64 DMG, Windows x64 EXE, Linux x64 AppImage and DEB. Supply `INSTALL.md`
   and `SHA256SUMS.txt`. The existing `Publish verified installer artifacts`
   workflow validates Windows/Linux artifact provenance and uploads to a draft;
   macOS verification/upload remains a separate build step.
3. Update [`.github/application-release.json`](.github/application-release.json)
   through the owner's work-branch → `dev` PR. Record the canonical repository,
   application tag, numeric draft Release ID, and each asset's exact filename,
   byte size and SHA-256. Review the build evidence alongside this change.
   Do not replace the historical 0.2.1 record in `RELEASE-ASSETS.json`.
4. Open `dev` → `main`. Check the full diff, tests, asset identities and actual
   validation evidence; resolve discussions. Only the owner merges.
5. The `main` push automatically starts the application release workflow. It
   checks the committed plan and source/catalog invariants, verifies the remote
   assets and checksum file, then publishes the matching draft as a normal
   application Release. The workflow explicitly runs the R2 mirror after a new
   publication; it does not rely on a token-generated `release` event.

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

The initial plan describes the already-published **0.2.2** assets. Re-running it
verifies the same bytes and does not publish again or replace assets. A changed
asset under an existing version fails. A new draft older than the current latest
application version cannot become latest. Publication is restricted to the
canonical repository and current `main` revision; a stale workflow cannot publish
after main has moved.

If a draft fails verification, fix the preparation or reviewed plan before
retrying. If publication succeeded and only the mirror failed, retry `Mirror
release to R2` with the application tag. A mirror retry must not recreate or
overwrite the GitHub Release. Never bypass a failed digest or overwrite published
assets to make a release pass.

## Plugin compatibility

The current plugin manager and old application locks require historical plugin
URLs and fixed source commits. Keep those assets, tags and source identities
available. Independent future plugin distribution needs compatible client and
catalog changes first; see [plugin publication policy](plugins/api-v1/PUBLISHING.md)
and [ecosystem design references](plugins/ECOSYSTEM.md).
