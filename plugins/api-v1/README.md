# Official plugins for Sesame Plugin API 1

**Development branch. These packages are not the stable 0.1.4 catalog.**

This directory is the source of the next official plugin bundle. The application
keeps the protocol, verified loader and general interface. Plugin implementations,
skills, templates, resources and platform integrations live here and are assembled
into application distributions from a fixed, reviewed archive.

`../catalog.json` and `../packages/` continue to describe the released 0.1.4
packages. Their fixed commits and digests are unchanged. API 1 packages will not be
advertised there until their matching application and end-to-end checks are ready.

## Layout

- `packages/<name>/plugin.json`: publisher-qualified identity, version, API and capabilities.
- `packages/<name>/package.json`: Node module scope, version and per-package license.
- `official-plugins.lock.json`: every packaged byte and the digest of each package tree.
- `scripts/plugin-lock.mjs`: data-only validation, lock generation and deterministic archive creation.
- `tests/`: source-repository tests; never included in the application bundle.

Native plugins export `createTools(host)` and optional `activate(host)`. They use
the public HostContext or allowlisted `@sesame/plugin-sdk/...` modules. They cannot
import an application's private source tree. The four standard MCP packages keep
their process boundary and `bot.sesame` manifest namespace.

## Native execution and dependency preparation

Development bundle 3 replaces `sesame/sandbox` with `sesame/workspace`. Its
read/write/edit/bash tools use a real task cwd and managed native processes,
with Bash on macOS/Linux and PowerShell on Windows. Execution has the current
user's permissions; this is not OS isolation. The host-files plugin adds explicit
write/mkdir/move/remove/run ports. Report and indicator renderer isolation remains.

MT5 1.1.0 checks and reuses existing native tools. No MT5 program, compiler VM,
Wine distribution or mandatory runtime image is embedded in the 19-package archive.
Plugin skills guide dependency discovery, explicit preparation when missing, and
actual verification. Optional integrations live separately in
`../optional-api-v1/packages/` and do not enter this lock.

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
```

`npm test` runs the portable `.test.mjs` source checks. `test:sdk` additionally
runs every `.test.js` plugin contract suite and requires
`SESAME_PLUGIN_SDK_LOADER` to point to the public SDK loader supplied by the matching
application. It fails explicitly if that loader is missing; it does not replace
the SDK with a copied or guessed implementation. No private host path is fixed in
this repository. The application also runs report, strategy and cleanup integration
tests against its verified assembled bundle.
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

During integration, publish only a clearly labelled development prerelease with
the deterministic archive and a checksum file. Fix its exact commit and hashes in
the application. Keep the stable catalog unchanged until a compatible application
release has passed its integration checks. Subsequent changes require a new package
version, archive and application lock; never silently replace a fixed artifact.

Each package retains its own LICENSE and PROVENANCE. Official Sesame plugin code
is MIT only within its stated package scope. Existing third-party attribution and
licenses remain intact. No license here applies to the private application.
