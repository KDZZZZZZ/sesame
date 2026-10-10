# Plugin catalog / API 1

The unified directory is
`https://raw.githubusercontent.com/KDZZZZZZ/sesame/main/plugins/api-v1/catalog.json`.
It lists 32 plugins: nine default and twenty-three optional, by exact publisher-qualified
name. Host compatibility is checked against each package's `engines.sesame`
range. The plugin-manager supports formal installation and explicit updates.
The historical catalog remains separate; its packages are not automatically
converted into API 1 packages.

## Fixed publication sources

[`catalog.sources.json`](catalog.sources.json) selects one published core release
and one published optional release by their exact tags, publication commits and
review asset hashes. The generator reads each
release plan at that commit, reconstructs its archive from the immutable source,
and verifies the archive, lock, package files and tree digests. It never imports
candidate JavaScript or executes package scripts. The generated catalog keeps
release/archive/lock/review identities alongside each package's file index.

These pins deliberately do not follow the latest release, current package source
or a floating branch. Selected releases are published by the main-branch workflow
after exact-head independent Agent review, static checks and the pre-merge
gate. Their downloaded assets are checked against GitHub digests and the
reconstructed archive bytes before this metadata update. Human approval is not recorded.
A later reviewed publication must explicitly advance the selected source release.

```sh
node plugins/api-v1/scripts/catalog.mjs --check
node plugins/api-v1/scripts/catalog.mjs --check --published
```

The second command also reads GitHub release metadata and checks that both
releases are published prereleases at the selected commit, and that the archive,
lock and review asset digests match. It executes no downloaded code. Maintainers
advance `catalog.sources.json` only after the new release is published, then run
`--write --published` and review the resulting catalog diff in a separate PR.
Never overwrite a released asset or rewrite an existing release plan to update
this directory. To withdraw an entry, record its exact ID in the source file's
`withdrawn` array and regenerate; the immutable source and review remain visible.

The release-level `profile` / `engines` fields are an optional shorthand, emitted
only when every package has exactly the profile's host range. A package may need
a newer host; then the generator omits that release-level shorthand and preserves
every entry's actual `engines` and `distribution`. Published readers otherwise
interpret the summary as exact equality and reject the entire directory, blocking
even compatible core updates. Source profile validation still runs before catalog
generation; fixed source, archive, lock and review pins remain unchanged. The host
checks the downloaded manifest at installation, so omitting the summary never
makes an incompatible package installable. No schema or published reader change
is required, and a uniform release matching its profile keeps the summary.

## Query, install and explicit update

`plugin_catalog({plugin_id:"sesame/mt5"})` returns the selected published version, its fixed
source/package/release information, and a digest of the complete catalog bytes.
The same directory supports native `sesame-native` packages and the four standard
`agent-plugins` MCP packages. It does not turn old stable factory IDs into API 1
aliases or grant permissions based on an `official` label.

For a missing package call `plugin_install_catalog` with the exact `plugin_id`,
returned `catalog_digest`, and a stable `command_id`. Its default action is
`install`. An installed different version requires an explicit update:

1. Use `plugin_inspect` to read the current installed digest and state.
2. Call `plugin_install_catalog` with `action:"update"`, that `expected_digest`,
   and the exact catalog identity/digest. Keep all parameters and `command_id`
   unchanged for retries of this operation.
3. Read the returned status, diagnostics and tool/resource loading result.

The downloader accepts only files in the declared package at its fixed Git
commit. It checks each size and SHA-256 and the package tree index, then delegates
to the ordinary host `plugin_test` and `plugin_install` or `plugin_update`. Native
tests are manifest/schema/JavaScript syntax checks. MCP tests execute the pinned
local server and its declared assertions through the host, as the current user.
No downloaded installer or arbitrary network script is evaluated by the catalog.

Updates pass `expected_digest` unchanged to the host. The host still enforces
version progression, running-operation checks, protected legacy builtins,
dependencies, and its existing migration grants. Official bundled native and MCP
updates require a host that supports explicit bundled overrides; this client
cannot grant that capability to an older host.

Identical version **and** digest returns `status:"already-installed"` without
redownloading, retesting or reinstalling. Identical version with different bytes
is rejected. A different version is never silently replaced by `install`;
downgrades require the separate explicit rollback mechanism. Disabled packages
stay disabled. Successful permitted loading refreshes the current session; a
replayed receipt is compared with the current installation before loading it.
A failed activation is reported, not described as a successful capability check.

The same verified files may instead be kept at the returned `draft_path` and used
with ordinary `plugin_test` / `plugin_update` tools. Environment preparation,
credentials and trading authorization remain separate from installing a package.

## Review and CI

`catalog.schema.json` documents the JSON structure. The trusted base validator
reconstructs the selected releases and compares the entire generated directory;
it does not execute candidate plugin factories. The workflow also checks public
release metadata. Automated byte checks, maintainer-recorded independent Agent
review, and actual human approval are distinct. Follow the fixed `review.json`
URL and hash for the publication evidence; static checks are not a safety verdict.

The trusted main validator checks this metadata PR against already published
releases. No package code, package lock, release plan or prior asset is changed by
selecting a new catalog source. The stable 0.1.4 and three-entry historical optional
catalogs retain their original bytes.

## Parser file boundaries

Published 2.0.2 `web-extract`, `rss-collect` and `market-data-parser` canonicalize
the trusted package root in the same way as the resolved input. A macOS `/var`
→ `/private/var` alias no longer rejects a bundled sample. Absolute inputs,
parent traversal and symlinks escaping the package remain rejected.
`quantskills-catalog` 2.1.0 retains its historical 214-entry reference snapshot and
routes requests to independently selected methods. It checks actual catalog
availability instead of claiming every external reference is installed or audited;
it has no caller-selected file resolver.

## Distribution and descriptive inventory

The nine core and twenty-three optional entries expose `distribution` and the minimum
`engines.sesame` range. MT5 and all other market/execution backends are optional.
`sesame/manual-trading` requires Sesame 0.2.1 or newer; the other selected packages
support Sesame 0.2.0 or newer, including their declared compatible development builds.
Always check the individual entry instead of assuming one minimum for the catalog.
The old `host-files`, `user-guide` and `research` names were merged into
`workspace`, `orchestration` and `data-access`, respectively; no installer aliases
pretend they are separate packages.

The eight method packages and the two research workflows are separate choices.
Installing `sesame/ict` does not install another technical method. CCXT provides
explicit-source public spot data; Backtrader runs a selected authored strategy
against fixed data. They do not add a default broker or trading authorization.
Backtrader's package and engine retain GPL-3.0-or-later licensing.
Agent manual trading coordinates explicit user instructions with an existing
supported trading backend; installing it does not grant ongoing trading authorization.

Catalog updates are independent of application installers. The application release record
[`RELEASE-ASSETS.json`](../../RELEASE-ASSETS.json) records the archives associated
with the published application; selecting newer catalog packages does not replace
the plugins already contained in that installer. Installed copies update only
through the explicit update flow above.

`inventory.json` is a descriptive snapshot marked `descriptive-inventory`. It
records compatible application versions. It is not an installation catalog:
it omits file/source hashes and cannot
select bytes to execute. Website copy buttons return exact names; the Agent
resolves the installation catalog and verifies its fixed digests.
