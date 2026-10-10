# Submit or update a plugin

For the current Plugin API 1 ecosystem, start with the [plugin development guide](api-v1/README.md) and [reviewed publication process](api-v1/PUBLISHING.md). It accepts the supported native, Skill and MCP formats; choose the format that matches the capabilities you need. Preserve author attribution, licenses and provenance for every format.

## Legacy catalog workflow

The steps below apply to the historical `plugins/catalog.json` catalog and its `plugins/packages/` sources. They do not restrict the formats supported by Plugin API 1.

1. Publish source you have permission to distribute. Choose an unused
   `publisher/name` ID, retain author copyright and include `LICENSE` and
   `PROVENANCE.md`. Explain network requests, file access, external accounts,
   limitations and how to exercise the plugin. Listing never transfers copyright.
2. For the legacy catalog, provide a standard stdio MCP package: `plugin.json`,
   `mcp.json`, static `tools.json`, an explicit Python or Node entrypoint and
   skills where useful. Packages must be self-contained. No native host import,
   executable install hook, embedded credential, symlink, archive or floating
   dependency is accepted. The initial validator permits a single package-local
   entrypoint and no environment values; new capability classes need a reviewed
   validator and client change before submission.
3. Add the files under `plugins/packages/<publisher>/<name>/` in a source commit.
   Do not include private host modules merely because a plugin imports them.
   Commit source before editing the catalog so `source.commit` can be immutable.
4. Add metadata and the full file manifest to `catalog.json` in a second commit.
   Every file includes its relative path, SHA-256 and byte length. Sort paths by
   JavaScript string order. Tree digest is
   `sha256(JSON.stringify(files.map(f => [f.path, 'sha256:' + f.sha256])))`.
   Hash compact UTF-8 JSON; do not include whitespace or the catalog in the tree.
5. Set minimum app version, user-facing requirements, actual tools, and
   `review: {automated: "catalog-ci", human: "not-recorded"}`. Authors cannot
   grant themselves a review or a safety badge. Keep an existing ID's ownership.
6. Open a PR with source and isolated-runtime test evidence. CI reads the
   candidate as data and uses the validator from the trusted base branch. It
   never runs the PR's plugins, scripts or tests. Maintainers inspect source,
   provenance, permissions, metadata and test evidence before publication.
7. A maintainer merges with **Create a merge commit**, preserving the source
   commit referenced by the catalog. Do not squash or rebase away pinned source
   commits. The website syncs the same merged catalog; it has no independent
   editable plugin list.

For a new release, increment the plugin version, commit source, then update its
catalog record and hashes through a new PR. Never replace bytes under an
existing version. A runtime or tool-schema change requires new test evidence.
Previous Git commits remain the publication audit trail. Branch protection
should require the catalog check and a code-owner review; CODEOWNERS alone
does not enforce this repository setting.

Run `node .github/scripts/validate-catalog.mjs .` and
`node --test .github/scripts/catalog.test.mjs` after committing the candidate.
These commands validate metadata and bytes; runtime testing must happen in a
separate unprivileged sandbox without secrets or host mounts.
