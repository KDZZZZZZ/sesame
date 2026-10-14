# Plugin ecosystem and listing policy

Sesame's workbench gives Agents shared tools, data, visual results and supervised
workflows. Official plugins provide practical quantitative capabilities, while
community plugins can extend markets, accounts, research methods, reports,
strategies and external services. A plugin may be useful without exposing a
market or account provider: a focused Skill is a valid contribution.

## Current implementation

- The public repository contains official source packages and a central catalog
  with exact versions, source commits, manifests, checksums and review identities.
- Native, Skill and MCP packages have different execution and dependency needs.
  Native plugins run as trusted code with the current user's local permissions;
  renderer isolation for reports/indicators is a different boundary.
- The catalog and application bundle locks are separate. Installing a catalog
  package does not silently change the application's pinned core bundle.
- Plugins declare host compatibility and implemented capabilities. Registering a
  provider does not itself implement every account operation or authorize trades.
- The [contribution process](../CONTRIBUTING.md) routes community work through
  forks into dev. Only the owner promotes dev to main.

Listing material should include source, README, license/provenance, minimum host
version, actual tools and supported platforms. Describe network services, file
access, credential handling, external software, background processes, paid
services and trading side effects. Provide meaningful test evidence and identify
what has not been tested. Static checks and a catalog listing are not a security
certification or proof of broker readiness.

## Lessons from Obsidian

The following are references for Sesame's development, not a claim that its
registry already implements every Obsidian feature.

| Reference | Useful principle for Sesame |
| --- | --- |
| [Official registry repository](https://github.com/obsidianmd/obsidian-releases) | Separate a central discovery index from plugin source and release assets. |
| [Manifest](https://docs.obsidian.md/Reference/Manifest) and [versions](https://docs.obsidian.md/Reference/Versions) | Declare identity and minimum host version; retain compatible immutable versions. |
| [Sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) | Provide a small usable scaffold, local development instructions and clear release contents. |
| [Developer policies](https://docs.obsidian.md/community-directory/developer-policies) | Disclose services, permissions, costs and dependencies instead of hiding them in installation behavior. |
| [Plugin security](https://obsidian.md/help/plugin-security) | Explain the trusted-code boundary; review does not make arbitrary plugins sandboxed. |

Obsidian's [current submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
uses its Community Directory. Older examples of editing a JSON list through a
GitHub PR should not be presented as its current submission process. Sesame's
fork contribution requirement is a code contribution policy, not a policy about
redistributing forks of another author's plugin.

## Distribution transition

This repository now reserves new GitHub Releases for the desktop application.
Historical plugin assets and pinned source remain available for old clients.
New publications use dedicated Cloudflare R2 storage at `dl.sesame.bot` with a
schema 2 catalog and plugin-manager 2.3.0. Existing Sesame 0.2.2 installations
can update that manager explicitly through the existing package tools; future
application bundles select the R2 core pin. The old schema 1 catalog retains its
original repository and URL format for compatibility.

A source merge remains separate from publication. An explicit package selection,
immutable source and hashes, completed review, and successful R2 upload precede
catalog promotion. See the [publication policy](api-v1/PUBLISHING.md) and
[R2 distribution](api-v1/R2-DISTRIBUTION.md).
