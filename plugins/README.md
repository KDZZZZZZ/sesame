# Historical Sesame plugin directory

[Browse plugins](https://sesame.bot/plugins/) · [中文插件库](https://sesame.bot/zh/plugins/) · [Historical machine-readable catalog](catalog.json)

For current hosts, use the [Plugin API 1 catalog](api-v1/CATALOG.md): 32 packages,
including nine core and twenty-three optional plugins. Compatibility is checked
per package; `sesame/manual-trading` requires Sesame 0.2.1, while the other
selected packages support 0.2.0. The instructions below describe the fixed 0.1.4 catalog.

Copy an exact name, for example `sesame/web-extract`, into Sesame 0.1.4:

> Load sesame/web-extract and use it for this task.

The Agent resolves the published catalog, checks compatibility and loads the
plugin into the current conversation. A compatible copy already bundled with
the app is loaded locally. Otherwise a standard MCP package is downloaded from
its immutable source commit, verified file by file, tested in the app's isolated
runtime, installed and loaded. Newly loaded tools are available in that turn.

The first catalog contains 26 official plugins: 4 standard MCP packages and
22 bundled plugins (21 native factories and the user guide). A bundled entry
requires the app's implementation. Its published factory is source for study
and contribution; clients must never download it and import it into the host.
MT5 plugins still require the relevant connection and user permissions.

## What is published

- `catalog.json`: one exact ID, version, compatibility requirement, author,
  license, publication status and immutable source manifest per entry.
- `catalog.schema.json`: the data contract shared with the website and Agent.
- `packages/`: the explicitly published plugin source and skills. The private
  host application's imported modules are intentionally outside this export.
- [CONTRIBUTING.md](CONTRIBUTING.md): author submissions and version updates.
- [REVIEW.md](REVIEW.md): automatic checks, maintainer review and withdrawal.
- [PROVENANCE.md](PROVENANCE.md): scope, source attribution and license boundaries.

Publication is a maintainer decision. Automated results live in
[GitHub Actions](https://github.com/KDZZZZZZ/sesame/actions/workflows/plugin-catalog.yml).
`review.human: not-recorded` means no separate human code-review record is
claimed. Neither an official badge nor a passing static check certifies safety.

This catalog targets the 0.1.4 runtime. Published API 1 packages have a separate
catalog and cannot be substituted with these historical host factories.
