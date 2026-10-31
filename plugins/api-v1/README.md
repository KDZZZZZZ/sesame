# Default plugins / Plugin API 2

**Current packages use Plugin API 2 and declare their minimum Sesame version individually.** The updated configuration, orchestration and plugin-manager packages require Sesame >=0.2.4; unchanged packages retain >=0.2.3. Each package explicitly declares capabilities, schemas, consumers and dependencies. Installers are listed on the [application release page](https://github.com/KDZZZZZZ/sesame/releases/latest). API 1 hosts must upgrade before installing these packages. Source, published archives and the install catalog may select different package versions.

This directory contains ten default packages for the current 0.3 development bundle. The application
keeps the protocol, verified loader and general interface. Plugin implementations,
skills, templates, resources and platform integrations live here and are assembled
into application distributions from a fixed, reviewed archive.

The defaults are `canvas-control`, `configuration`, `data-access`, `memory`,
`orchestration`, `plugin-manager`, `reports`, `strategy-authoring`, `ultra`, `user-guide` and `workspace`.
Canvas and settings are discoverable; the other nine are mounted. Product help
belongs to `user-guide`; research coordination and host Run guidance belong to
`orchestration`. Each keeps its role and general rules in `prompt.md`, task
procedures in `SKILL.md`, and detailed reference material loaded on demand. Ultra
ships with the built-in `/ultra` command while retaining its business workflow
responsibility and public plugin interfaces. No market,
account or native strategy backend is required to author sources, run fixed
replays, work with local data or publish reports. Optional packages live in
[`../optional-api-v1/`](../optional-api-v1/README.md), including MT5, QMT, AKShare
and vn.py. Installing Sesame does not install their terminals or environments.

See the [package-by-package review](REORGANIZATION.md) for the three merges,
private-storage changes, dependencies and actual validation scope.

The current installation catalog is `https://dl.sesame.bot/plugins/api-v1/catalog.json`.
Repository-local legacy catalogs are historical data and are no longer validated
as active installation channels. Plugin GitHub Releases and their old source
history were retired; existing API 1 installations are not automatically converted.

## Layout

Start with the [shared plugin development Skill](packages/plugin-manager/skills/develop-plugins/SKILL.md),
the [authoring guide](packages/plugin-manager/skills/develop-plugins/references/authoring.md)
and the [open interface reference](packages/plugin-manager/skills/develop-plugins/references/host-api.md).
They are shipped inside plugin-manager so internal and external Agents learn from the same source.
The [portable scaffold CLI](packages/plugin-manager/scripts/create-plugin.mjs) requires only Node;
actual installation and activation are checked by a matching Sesame host.

- `packages/<name>/plugin.json`: publisher-qualified identity, version, API and capabilities.
- `packages/<name>/package.json`: Node module scope, version and per-package license.
- `official-plugins.lock.json`: every packaged byte and package tree digest.
- `bundle-profile.json`: the reviewed, exact ten-package distribution set.
- `catalog.json` / `catalog.sources.json`: retired API 1 historical records, not the current installation channel.
- `inventory.json`: the descriptive source inventory, with no installation digests or authority.
- `scripts/plugin-lock.mjs`: data-only validation, lock generation and deterministic archive creation.
- `tests/`: source-repository tests; never included in the application bundle.

Native plugins export `createCapabilities(host)` and optional `activate(host)`. They use
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
compiler VM, Wine distribution or mandatory runtime image is embedded in the default archive.
Plugin skills guide dependency discovery, explicit preparation when missing, and
actual verification. Optional integrations live separately in
`../optional-api-v1/packages/` and do not enter this lock.

Development bundle 4 completes real-path delivery for research/web inputs and
MT5 checkouts. Workspace commands expose incomplete snapshot diagnostics. The
plugin-manager owns verified catalog installation and same-session loading;
its native static checks remain distinct from actual activation and environment
verification. The [source inventory](CATALOG.md) describes packages; installation
resolves the R2 catalog, which fixes source, archive, file/tree and review hashes.
The release selects nine default and 45 optional packages, excluding Kurumi.
Explicit updates preserve the host's current-digest and version checks.

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
uses temporary state to check the core packages, backend-free source/graph/replay/report
creation and fresh optional MT5/judgment installation. `SESAME_REPORT_INSPECT=1`
also runs the real report inspector. It does not operate a terminal or account.
With the same environment and loader, `tests/plugin-authoring-host.test.mjs` checks
internal native creation, the external CLI, real validation/install/load/tool calls,
stale-digest rejection and restart persistence using temporary application state.
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
`profile:"core"` or `profile:"optional"`; the current core archive physically contains eleven packages.

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
