# Publication scope and rights

This directory publishes the 26 official plugins shipped for Sesame 0.1.4.
Only selected plugin files were exported from the committed application source.
No dependency traversal, private host source, credentials or user workspace was
included. Package contents and versions are bound to the public Git commits and
SHA-256 manifests in `catalog.json`.

The four standard packages (`web-extract`, `rss-collect`, `market-data-parser`,
`quantskills-catalog`) retain their existing MIT license, author metadata and
skill-level `PROVENANCE.md` without rewriting third-party attributions. Their
Python adapters are Sesame code, not copies of the inspirational upstream
libraries. Samples, feeds, financial data and linked upstream projects retain
their own rights. The QuantSkills snapshot is a directory, not an endorsement
or a license grant to its 214 linked projects.

The other 22 Sesame-authored plugin directories are published under their own
MIT files. That grant is limited to the files in those directories. Publishing
them does not open-source, relicense or include the private Sesame desktop host,
its imported dependencies, credentials or user data. An import that points out
of a package is a dependency of the bundled implementation, not permission to
copy its target. Copyright remains with each author; listing transfers none.

Directory design references: [Obsidian plugin submission](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin),
[Obsidian submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins),
and [ClawHub](https://docs.openclaw.ai/clawhub). These inform clear ownership,
compatibility and release provenance, not a claim of affiliation or equivalent
security review. Source docs checked 2026-10-09.
