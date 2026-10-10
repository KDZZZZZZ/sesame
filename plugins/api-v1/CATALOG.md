# Plugin catalog for Sesame 0.2.0 / API 1

The unified directory is
`https://raw.githubusercontent.com/KDZZZZZZ/sesame/main/plugins/api-v1/catalog.json`.
It lists nine default and twenty-two optional plugins by exact publisher-qualified name.
All require `engines.sesame: ">=0.2.0-0"`: compatible development builds are allowed,
with formal minimum 0.2.0. The published plugin-manager 2.1.1 reads this directory
and supports formal install and explicit update. Use the [application release
page](https://github.com/KDZZZZZZ/sesame/releases/tag/v0.2.0) for installer availability.
Sesame 0.1.4 and its historical catalog are unchanged. After upgrading the app,
install the required API 1 versions by name; the old plugins are not converted.

The catalog retains `channel:"development"` as its existing publication-channel
identity. Compatibility is determined by each package's `engines.sesame` range,
which accepts the formal 0.2.0 application. Keeping the existing tags, catalog
bytes and application pins avoids changing already verified package identities.

## Fixed publication sources

`catalog.sources.json` selects **core dev.14** and **optional dev.8** by their
exact publication commits and review asset hashes. The generator reads each
release plan at that commit, reconstructs its archive from the immutable source,
and verifies the archive, lock, package files and tree digests. It never imports
candidate JavaScript or executes package scripts. The generated catalog keeps
release/archive/lock/review identities alongside each package's file index.

These pins deliberately do not follow the latest release, current package source
or a floating branch. Both releases were published by the main-branch workflow
after PR27's and PR31's exact-head independent Agent reviews, static checks and pre-merge
gate. Their actual downloaded assets were checked against GitHub digests and the
host package verifier before this metadata update. Human approval is not recorded.
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

## Query, install and explicit update

`plugin_catalog({plugin_id:"sesame/mt5"})` returns version 1.2.0, its fixed
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

The nine core and twenty-two optional entries expose `distribution` and the minimum
`engines.sesame` range. MT5 and all other market/execution backends are optional.
The old `host-files`, `user-guide` and `research` names were merged into
`workspace`, `orchestration` and `data-access`, respectively; no installer aliases
pretend they are separate packages.

The eight method packages and the two research workflows are separate choices.
Installing `sesame/ict` does not install another technical method. CCXT provides
explicit-source public spot data; Backtrader runs a selected authored strategy
against fixed data. They do not add a default broker or trading authorization.
Backtrader's package and engine retain GPL-3.0-or-later licensing.

`inventory.json` is a descriptive snapshot marked `descriptive-inventory`. It
records the minimum compatible application version, not application release
status. It is not an installation catalog: it omits file/source hashes and cannot
select bytes to execute. Website copy buttons return exact names; the Agent
resolves the installation catalog and verifies its fixed digests. The application
release page remains the source of installer availability.
