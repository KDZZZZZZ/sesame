---
name: develop-plugins
description: Create, extend, validate and package Sesame plugins from actual public HostContext and existing examples. Use for new skills/tools, market or account backends, reports, indicators, strategy integrations and event-triggered Agents, inside Sesame or from an external coding Agent.
---

# Develop Sesame plugins

Use the smallest plugin form that implements the requested behavior. This is the shared development entry for Sesame's own Agents and external coding Agents. It does not require private application source, model credentials or an active broker account to author a package.

## Read only the relevant references

- [Authoring, testing, installation and delivery](references/authoring.md): start here.
- [Open HostContext and product contracts](references/host-api.md): exact ports, signatures, scopes and current limits. Do not invent methods from a design draft.
- [Public scaffold CLI](../../scripts/create-plugin.mjs): generates a native or instruction-only package using the same recipe as Sesame's native `plugin_create`.
- [Publication protocol](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/PUBLISHING.md): use when preparing a public release.

## Workflow

1. Identify the behavior, inputs, final output, required host version and an existing plugin example. Distinguish a research method from a market provider or a trading backend. Tools/skills may declare `provides:{}`.
2. Inside Sesame, use `plugin_create` with `template:"native"`, `"skill"` or `"mcp-python"`. Native supports `publisher` and `min_host`. Ordinary subagents may author files with workspace tools; ask their parent to perform main-only plugin management. Outside Sesame, clone the public repository and run the packaged CLI, or author the same files directly.
3. Replace the starter behavior with the actual feature. A generated echo or a placeholder method is not the user's completed plugin. Keep `tool_names`, `tools.json` and the factory consistent. Preserve package-local imports, use HostContext/public SDK, and declare only implemented capabilities.
4. Write a concise prompt plus a focused Skill. Keep long API references out of the always-loaded prompt. Specify inputs, procedure, outputs, verification and failure handling. Use actual provider identities and immutable artifacts rather than guessed method names, ticker strings or temporary paths.
5. Test meaningful behavior and failure cases. External Agents may test portable logic and MCP without Sesame; SDK and actual host activation require a matching host. Clearly report those checks as pending when unavailable; never invent a host receipt.
6. In Sesame, run `plugin_validate → plugin_test → plugin_install` using the exact returned digest, inspect runtime diagnostics, then `plugin_load` and a real feature check. For an installed ID, use explicit update with expected_digest and a higher version. The CLI does not generate installation authority, hashes accepted as test receipts, or automatic user consent.
7. Deliver source, test evidence, compatibility, license/source attribution and remaining limitations. Public PR/release only when requested; follow the repository's independent review and immutable publication process. Installing a package does not automatically place a trade or authorize dependency downloads unrelated to the task.

## Patterns to reuse

| Requirement | Actual example to inspect |
| --- | --- |
| Independent method Skill | [ICT](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/ict) |
| Native tools and process diagnostics | [workspace](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/api-v1/packages/workspace) |
| MCP tool/server tests | [web-extract](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/web-extract) |
| Market read/subscribe provider | [AKShare](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/akshare), [CCXT](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/ccxt) |
| Account data and persistent execution | [MT5](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/mt5) |
| Immutable indicator and chart binding | [canvas-control](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/api-v1/packages/canvas-control) |
| Report style, frozen data and render checks | [reports](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/api-v1/packages/reports) |
| SVL, methods, risk/execution and model decisions | [strategy-authoring](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/api-v1/packages/strategy-authoring) |
| Cross-plugin tool composition | [manual-trading](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/manual-trading) |
| Native backtest adapters | [vn.py](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/vnpy), [Backtrader](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/backtrader) |

Use examples for their interface pattern, not as proof every platform or broker is ready. Do not access private Runtime/Store/Pi objects or copy credentials. Discover existing dependencies before preparing a private missing environment. Preserve authors' licenses and attribution; do not relabel all third-party work as MIT.

## 版本依据

This plugin-manager package requires Sesame ≥0.2.2. The portable scaffold itself has no host dependency; generated packages declare the minimum version required by their own feature set.

Interface audit: application `dev` at `5ca4695` (0.2.2); relevant ports match `6767ab6`. Application `main` at audit was `295b0a1` (0.2.1). Base API 1 is available since 0.2.0; cross-plugin `tools.call` since 0.2.1; `inference`, `agents` and the new SVL functionality require 0.2.2.

Examples were checked against public plugin commit `24e70b9a26ce69e0b289e5aa30e415475f21054a`: strategy-authoring 1.2.0, orchestration 2.2.0 and MT5 1.4.0 require ≥0.2.2. Always re-read the target package's manifest. A source branch, published archive and current install catalog may select different versions; none proves what is installed on the user's device.
