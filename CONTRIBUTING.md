# Contributing to Sesame

Sesame combines an extensible Agent workbench with practical quantitative research and trading integrations. Contributions can improve tools, market and account integrations, research methods, reports, strategies, documentation, or the shared development experience.

## Branches and pull requests

| Destination | Accepted source | Who merges |
| --- | --- | --- |
| `dev` | A contributor's fork; the owner may use a work branch in this repository | `@KDZZZZZZ` |
| `main` | This repository's `dev` branch | `@KDZZZZZZ` |

Fork the repository, branch from current `dev`, make a focused change, and open a PR **against `dev`**. Keep `main` as the stable public installation/catalog endpoint. Do not propose a feature branch directly to `main`.

The owner has a same-repository maintenance path because GitHub does not allow a personal account to fork its own repository. This exception does not bypass tests, resolved discussions, or the PR requirement. Code ownership identifies the reviewer; it does not require the owner to approve their own PR, which GitHub does not support.

Protected `main` and `dev` require routing and static checks, resolved review discussions, and a PR. Force pushes and branch deletion are disabled. A separate owner-only update rule restricts merging. Use **Create a merge commit**: catalog entries and release evidence reference fixed source commits, which must remain reachable. Squash/rebase merging is disabled.

Delete merged work branches. Archive unmerged abandoned work before cleanup; keep active work until its PR merges or is deliberately withdrawn. Tags used by published releases and catalogs are immutable history, not temporary branches.

## What to include

- Describe the concrete behavior, affected users, and compatibility requirements.
- Include meaningful tests and actual results, failure cases and platform limits. Static validation is not a successful broker connection or live trading test.
- Keep metadata, declared tools/providers, source, locks and catalog identities consistent. Runtime changes need a new package version; published bytes must not be replaced.
- Retain third-party attribution and licenses. Document network requests, filesystem access, credentials, external programs, background services and trade/order effects.
- Never commit credentials, account data, generated installers, local logs or environment-specific scratch files.

The [plugin development index](plugins/api-v1/docs/README.md) contains the public Skill, HostContext reference, scaffold and recovery guide. [Plugin contribution details](plugins/CONTRIBUTING.md) document the frozen legacy catalog. [Plugin publication policy](plugins/api-v1/PUBLISHING.md) explains why historical archives remain and why merging source does not create a new plugin Release.

## Validation

Use Node.js 24+. Byte-sensitive locks require committed LF bytes; on Windows clone with `git -c core.autocrlf=false clone ...`. Do not regenerate published hashes just to accommodate local newline conversion.

```sh
node plugins/api-v1/scripts/plugin-lock.mjs --check
node plugins/api-v1/scripts/plugin-lock.mjs --check --source plugins/optional-api-v1
node .github/scripts/validate-catalog.mjs .
node plugins/api-v1/scripts/catalog.mjs --check
node --test .github/scripts/contribution-policy.test.mjs .github/scripts/catalog.test.mjs .github/scripts/release-plugins.test.mjs .github/scripts/semantic-review.test.mjs .github/scripts/release-application.test.mjs
```

PR CI uses validators from the trusted base and reads proposed plugins as data. It never imports candidate factories or executes candidate setup hooks. Validator changes must land before another PR can depend on their new behavior. Runtime tests are separate and need a suitable isolated environment.

Normal comments and review requests do not represent completed semantic review. The historical plugin review gate responds to an owner-submitted completed record, an explicit owner request, or manual dispatch. Independent agent review records must describe review that actually happened.

## Promotion and publication

The owner opens `dev` → `main`, checks the entire diff and CI, resolves discussions, and merges. Every `main` push triggers the application release pipeline. It verifies the reviewed release plan and publishes matching, previously prepared installer assets; unchanged published versions are a no-op. Building private source and supplying installers happen before promotion. See [RELEASING.md](RELEASING.md).
