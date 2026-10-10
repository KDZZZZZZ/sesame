# Default plugins for Sesame 0.2.0 / Plugin API 1

**For Sesame 0.2.0 and compatible newer hosts. The declared range `>=0.2.0-0` also permits matching development builds. Installers and their release status are listed on the [application release page](https://github.com/KDZZZZZZ/sesame/releases/tag/v0.2.0). These API 1 packages cannot be used in 0.1.4.**

This directory contains exactly nine default packages for the 0.2 application bundle. The application
keeps the protocol, verified loader and general interface. Plugin implementations,
skills, templates, resources and platform integrations live here and are assembled
into application distributions from a fixed, reviewed archive.

The defaults are `canvas-control`, `configuration`, `data-access`, `memory`,
`orchestration`, `plugin-manager`, `reports`, `strategy-authoring` and `workspace`.
Canvas and settings are discoverable; the other seven are mounted. No market,
account or native strategy backend is required to author sources, run fixed
replays, work with local data or publish reports. Twenty-three optional packages live in
[`../optional-api-v1/`](../optional-api-v1/README.md), including MT5, QMT, AKShare
and vn.py. Installing Sesame does not install their terminals or environments.

See the [package-by-package review](REORGANIZATION.md) for the three merges,
private-storage changes, dependencies and actual validation scope.

`../catalog.json` and `../packages/` continue to describe the released 0.1.4
packages. Their fixed commits and digests are unchanged. After upgrading from
0.1.4, ask Sesame to install the required API 1 packages by name; old plugin
installations are not automatically converted. Use this separate API 1 catalog.

## Layout

- `packages/<name>/plugin.json`: publisher-qualified identity, version, API and capabilities.
- `packages/<name>/package.json`: Node module scope, version and per-package license.
- `official-plugins.lock.json`: every packaged byte and package tree digest.
- `bundle-profile.json`: the reviewed, exact nine-package distribution set.
- `catalog.json` / `catalog.sources.json`: separately pinned, already published package entries.
- `inventory.json`: the 32-package descriptive inventory, with no installation digests or authority.
- `scripts/plugin-lock.mjs`: data-only validation, lock generation and deterministic archive creation.
- `tests/`: source-repository tests; never included in the application bundle.

Native plugins export `createTools(host)` and optional `activate(host)`. They use
the public HostContext or allowlisted `@sesame/plugin-sdk/...` modules. They cannot
import an application's private source tree. The four standard MCP packages keep
their process boundary and `bot.sesame` manifest namespace.

## Native execution and dependency preparation

Development bundle 3 replaced `sesame/sandbox` with `sesame/workspace`. Its
read/write/edit/bash tools use a real task cwd and managed native processes,
with Bash on macOS/Linux and PowerShell on Windows. Execution has the current
user's permissions; this is not OS isolation. Workspace now includes the explicit
host-file list/search/read/import/write/mkdir/move/remove/run ports. Report and indicator renderer isolation remains.

Optional MT5 checks and reuses existing native tools. No MT5 package, terminal,
compiler VM, Wine distribution or mandatory runtime image is embedded in the nine-package archive.
Plugin skills guide dependency discovery, explicit preparation when missing, and
actual verification. Optional integrations live separately in
`../optional-api-v1/packages/` and do not enter this lock.

Development bundle 4 completes real-path delivery for research/web inputs and
MT5 checkouts. Workspace commands expose incomplete snapshot diagnostics. The
plugin-manager owns verified catalog installation and same-session loading;
its native static checks remain distinct from actual activation and environment
verification. The [unified API 1 catalog](CATALOG.md) pins the actual
core dev.15 and optional dev.9 releases: nine default and twenty-two optional entries.
Their source commit, archive, file/tree and review hashes were selected only after
publication and actual download verification. Explicit updates preserve the host's
current-digest and version checks. The published 0.1.4 catalog is unchanged.

## Validate and build

Use Node 24 or newer. The source tools have no npm dependencies. Python 3 is needed
for the four MCP server tests. From this directory:

```sh
npm test
npm run test:sdk
npm run test:python
npm run lock
npm run check
node scripts/plugin-lock.mjs --archive /absolute/output/official-plugins-api1-dev.tar.gz
node scripts/plugin-lock.mjs --write --source ../optional-api-v1
node scripts/inventory.mjs --check
```

`npm test` runs the portable `.test.mjs` source checks. `test:sdk` additionally
runs every `.test.js` plugin contract suite and requires
`SESAME_PLUGIN_SDK_LOADER` to point to the public SDK loader supplied by the matching
application. It fails explicitly if that loader is missing; it does not replace
the SDK with a copied or guessed implementation. No private host path is fixed in
this repository. The application also runs report, strategy and cleanup integration
tests against its verified assembled bundle.
`SESAME_HOST_ROOT=/path/to/matching/host node --import "$SESAME_PLUGIN_SDK_LOADER" --test tests/core-host.test.mjs`
uses temporary state to check the nine defaults, backend-free source/graph/replay/report
creation and fresh optional MT5/judgment installation. `SESAME_REPORT_INSPECT=1`
also runs the real report inspector. It does not operate a terminal or account.
`test:python` runs the dependency installer boundary suite without writing bytecode
into the plugin packages. These fixture checks do not claim a native compiler ran.
The separate opt-in native compiler test requires the actual installed toolchain.

The archive root contains only `official-plugins.lock.json` and locked package
directories. Files use mode 0644, uid/gid zero and a zero modification time. No
application code, repository tests, local dependencies or credentials are bundled.
The builder prints the archive and lock SHA-256 values for the application lock.
The application separately fixes the source commit and both hashes, verifies the
archive and all package files before atomically replacing its assembled directory,
and refuses missing, changed or extra files. A directory override is not a trust
bypass: it must contain the same verified lock metadata.

Profiled packages declare `engines.sesame` in a native manifest, or in
`extensions['bot.sesame']` for a standard MCP manifest. The host checks the SemVer
range before testing or activation. The reviewed profile validator additionally
requires the exact package set, private storage with no legacy grants and optional
packages in discoverable state. Historical fixed releases without profiles retain
their original build semantics and hashes. A new profiled release plan must name
`profile:"core"` or `profile:"optional"`; the core archive physically contains only nine packages.

Tree hashes deliberately use the same algorithm as the released catalog:

```js
sha256(JSON.stringify(files.sort(byPath).map(file =>
  [file.path, 'sha256:' + file.sha256]
)))
```

The outer `treeDigest` is written with the `sha256:` prefix. Single file `sha256`
values are lowercase hex. This is byte identity, not a security review verdict.

## Review and publication

Submit a PR with version changes, tests, source and license notes, and a regenerated
lock. Automated review treats candidate plugins as data; it does not import their
JavaScript or execute their scripts. Maintainers separately review native behavior,
public SDK usage, dependency licenses and scope before running code in the intended
test environment. Record actual checks and limitations, including native targets
that were not available. Never mark a package safe solely because it supplied a
passing test or manifest claim.

Application bundles keep their fixed plugin archive pins. Later plugin updates
use separately reviewed catalog entries and explicit installation. New package
bytes require a new version, review and archive; never replace a fixed artifact.

Each package retains its own LICENSE and PROVENANCE. Official Sesame plugin code
is MIT only within its stated package scope. Existing third-party attribution and
licenses remain intact. No license here applies to the private application.
