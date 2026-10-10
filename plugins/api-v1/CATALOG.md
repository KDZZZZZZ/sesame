# Plugin API 1 development catalog

The unified directory is
`https://raw.githubusercontent.com/KDZZZZZZ/sesame/main/plugins/api-v1/catalog.json`.
It lists the 19 official packages and the three optional integrations by exact
publisher-qualified name. It requires a matching Plugin API 1 host and the
plugin-manager 2.1.0 client. The client in this PR is a candidate, not a published
release; existing clients continue to read the separate optional-only directory
until explicitly updated. Sesame 0.1.4 and its website catalog are unchanged.

## Fixed publication sources

`catalog.sources.json` selects **official dev.12** and **optional dev.4** by their
exact publication commits and review asset hashes. The generator reads each
release plan at that commit, reconstructs its archive from the immutable source,
and verifies the archive, lock, package files and tree digests. It never imports
candidate JavaScript or executes package scripts. The generated catalog keeps
release/archive/lock/review identities alongside each package's file index.

These pins deliberately do not follow the latest release, current package source,
a floating branch, or the unreviewed manager candidate. In particular the catalog
still describes published plugin-manager 2.0.1, while this PR develops 2.1.0. A
later reviewed publication must explicitly advance the selected source release.

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

`plugin_catalog({plugin_id:"sesame/mt5"})` returns version 1.1.9, its fixed
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

When the validating workflow itself is introduced in a PR, the existing trusted
base cannot run the new check yet. That first PR needs the recorded local byte and
publication checks plus independent review; later PRs use the merged trusted
validator. No new release plan is added by this catalog/client PR.

## Candidate parser path correction

The same PR contains a minimal 2.0.2 candidate for `web-extract`, `rss-collect`
and `market-data-parser`. Their trusted package root now uses the same canonical
filesystem representation as the resolved input. A macOS `/var` → `/private/var`
alias (or an equivalent directory symlink) no longer rejects an ordinary bundled
sample. Absolute inputs, parent traversal and symlinks that resolve outside the
package remain rejected. `quantskills-catalog` has no caller-selected file resolver
and is unchanged at 2.0.1. The published dev.12 catalog entries remain 2.0.1 until
these candidates are reviewed, published and selected by a subsequent metadata PR.

## Unreleased 0.2 distribution

The new candidate reorganizes 22 historical identities into nine default and ten
optional packages. `inventory.json` is a source preview, with explicit
`unreleased-candidate` status and no install-authority fields. The installation
catalog above still selects the released 22-package set; it is not silently
regenerated from changed files. After the candidate bundles pass review and are
published, a distinct metadata PR must select their fixed release records. Those
entries additionally identify `distribution` and `engines.sesame: ">=0.2.0-0"`.
The formal minimum is 0.2.0, with compatible development previews allowed. Stable
0.1.4 retains its independent historical catalog.
