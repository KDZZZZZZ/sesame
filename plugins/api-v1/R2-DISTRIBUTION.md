# Sesame plugin distribution

Plugin-manager 2.3.0 reads
[`https://dl.sesame.bot/plugins/api-v1/catalog.json`](https://dl.sesame.bot/plugins/api-v1/catalog.json).
The domain is served by the Sesame website Worker with the `sesame-releases`
R2 binding. Package downloads no longer require GitHub; GitHub source URLs in
the catalog are provenance links. The historical schema 1 catalog and archives
remain unchanged for older clients.

## Publication

1. Land and verify infrastructure through work branch → dev → main before a
   separate PR uses its new validator. Review plugin behavior separately from
   the data-only static checks.
2. Pin a public source commit in `.github/plugin-r2/dev.N.json`. Select the exact
   IDs in both `core` and `optional` profiles, their deterministic archive and
   lock SHA-256 values, and the publishing dev → main PR number. Source packages
   that are not selected never enter an archive, file object or catalog entry.
   The builder checks the complete source lock before constructing either subset.
3. Run `node .github/scripts/plugin-r2.mjs --check .`. Complete an independent
   review on the final publishing PR head, record its actual result, and run
   the existing `Plugin semantic review gate` before merging. The R2 publisher
   verifies both static checks and the trusted pre-merge artifact, including
   resolved discussions. It does not claim human approval from an agent record.
4. Merge dev → main. `Publish plugins to Sesame R2` uses the existing
   `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` repository
   secrets. It writes only under `plugins/api-v1/` in `sesame-releases`.
   The workflow can also be retried on current main.

Immutable objects use conditional S3 writes and are read back byte-for-byte.
Existing differing bytes fail. Public archive, lock, review and manager files
must be readable before the catalog changes. The catalog promotion compares the
previous ETag and rejects older or altered revisions; a failed upload leaves
the previous catalog available. The workflow rechecks main before promotion.

| Object | Location below `https://dl.sesame.bot/` | Cache |
| --- | --- | --- |
| Current directory | `plugins/api-v1/catalog.json` | `no-store, max-age=0` |
| Package files | `plugins/api-v1/packages/<tree-sha256>/<file>` | Immutable |
| Profile archive and lock | `plugins/api-v1/releases/dev.N/<core-or-optional>/` | Immutable |
| Review, plan and catalog snapshot | `plugins/api-v1/releases/dev.N/` | Immutable |

The catalog pins each file's size and SHA-256 plus the full package tree digest.
The manager permits only the exact Sesame download origin and expected paths,
rejects redirects, and performs the existing `plugin_test` and formal install
or update. Existing installed versions, disabled state and explicit update
checks keep their existing behavior. The download does not run setup hooks.

This uses the documented R2 [conditional S3 operations](https://developers.cloudflare.com/r2/api/s3/api/)
and [cache controls](https://developers.cloudflare.com/r2/reference/consistency/).
The website Worker must honor the current directory's no-store policy; an
immutable cache policy on that path would hide new publications.

## Existing installations and future app bundles

Sesame 0.2.2 already supports updates to its bundled plugin-manager. Follow the
[installation guide](https://sesame.bot/plugins/install.md): read the R2 catalog,
download its pinned core archive, verify the archive SHA-256, and extract it to
a fresh workspace draft. Inspect the installed manager, test the extracted
`plugin-manager` directory, compare the tested version and tree digest to the
catalog, then call `plugin_update` with the current `expected_digest` and finally
`plugin_load`. This is an explicit package update, with the original retained
for rollback. Use the host's existing tools and available OS download utilities;
no separate Node.js or Python installation is required by this guide.

Future application builds select
`releases/dev.N/core/application-official-plugins.lock.json` as their root
`official-plugins.lock.json`. The existing assembler accepts HTTPS archives and
verifies archive, lock and package hashes. Publishing plugins does not rewrite
already-released application installers or claim that they bundle the new manager.

Verification commands:

```sh
node --test .github/scripts/plugin-r2.test.mjs .github/scripts/publish-plugin-r2.test.mjs plugins/api-v1/tests/plugin-catalog.test.mjs
node .github/scripts/plugin-r2.mjs --check .
```
