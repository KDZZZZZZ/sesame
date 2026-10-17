# Sesame plugin distribution

Current API 2 packages, with per-package Sesame compatibility ranges, are distributed at
[`https://dl.sesame.bot/plugins/api-v1/catalog.json`](https://dl.sesame.bot/plugins/api-v1/catalog.json).
The Sesame website Worker serves this domain with its `sesame-releases` R2
binding. Packages download from R2 and exact Git source references supply
provenance. The catalog has schemaVersion 2 and apiVersion 2; `api-v1` remains
in the URL for transport continuity. Plugin GitHub Releases were retired during
the history reset. API 1 hosts must upgrade before using the current catalog.

## Publication

1. Land and verify infrastructure through work branch → dev → main before a
   separate PR uses its new validator. Review plugin behavior separately from
   the data-only static checks.
2. Pin a public source commit in `.github/plugin-r2-api2/dev.N.json`. Select the exact
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

## Installations and app bundles

Use Sesame >=0.2.3 and its bundled API 2 plugin manager. Ask for exact plugin IDs;
the manager resolves the published catalog, validates fixed bytes and checks the
declared host requirements. It uses the registered installation and update
capabilities, preserving current-digest checks and disabled state. Follow the
[installation guide](https://sesame.bot/plugins/install.md). Do not attempt to
bootstrap the API 2 manager into Sesame 0.2.2 or an older API 1 host.

Application builds select
`releases/dev.N/core/application-official-plugins.lock.json` as their root
`official-plugins.lock.json`. The existing assembler accepts HTTPS archives and
verifies archive, lock and package hashes. Publishing plugins does not rewrite
already-released application installers or claim that they bundle the new manager.

Verification commands:

```sh
node --test .github/scripts/plugin-r2.test.mjs .github/scripts/publish-plugin-r2.test.mjs plugins/api-v1/tests/plugin-catalog.test.mjs
node .github/scripts/plugin-r2.mjs --check .
```
