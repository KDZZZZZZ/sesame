# 0.2 plugin distribution candidate

This source proposal targets Sesame **0.2.0**, which has not been formally
released. Every package declares `engines.sesame: ">=0.2.0-0"`, allowing matching
0.2 development previews. This is the first explicit host-version contract for
these reorganized packages; historical API 1 packages did not uniformly declare
it. The host checks this range during formal inspection and installation. Native
manifests use `engines`; standard MCP manifests use `extensions["bot.sesame"].engines`.

The application archive is actually built from nine default packages. Ten other
packages have moved to a separate optional root and are discoverable only after
installation. Default inclusion does not mount every tool: canvas/configuration
remain discoverable, while the other seven core packages start mounted. Nothing
here installs MT5, QMT, Python dependencies or a brokerage terminal automatically.

## Every previous identity

| Previous package | Decision / candidate | Distribution | Dependencies and concrete changes |
| --- | --- | --- | --- |
| canvas-control | Keep 2.1.1 | Default, discoverable | Generic canvas/provider ports; prompts preserve each backend's instrument, time and binding identity. |
| configuration | Keep 2.0.1 | Default, discoverable | Public settings port; explain version conflicts and verify actual service calls after configuration. |
| data-access | Merge research into 2.3.0 | Default, mounted | Market/dataset/artifact/workspace ports; now includes data_read and research_register, with frozen execution evidence and provider-neutral guidance. |
| host-files | Merge into workspace | Removed standalone identity | All nine host-file tools and dependency-inspection skill move with their validation unchanged. |
| judgment-evolution | Keep 2.1.0 | Optional | New private SQLite ledger; no implicit migration or internal collection grant. Judgment review requires recorded evidence, not claimed profitability. |
| market-data-parser | Keep 2.0.2 | Optional MCP | Python standard library. Canonical trusted package root fixes OS path aliases without allowing external symlink escapes. |
| memory | Keep 2.0.1 | Default, mounted | Generic memory port; preserve source, applicability and uncertainty across tasks. |
| mt5 | Keep 1.2.0 | Optional | User's authorized MT5/MetaEditor; private storage only, no legacy migration grant. Explicit native configuration discovery/import remains available. No automatic terminal installation/start or implicit connection import. |
| orchestration | Merge user-guide into 2.1.0 | Default, mounted | Generic task ports; public self-contained guides now distinguish 0.2 preview, default tools, optional backends and native prerequisites. |
| plugin-manager | Keep 2.1.1 | Default, mounted | Fixed catalog/source hashes; formal test and explicit expected-digest update, same-version no-op, disabled-state preservation. Profile/engine metadata checked when present. |
| quantskills-catalog | Keep 2.0.2 | Optional MCP | Python standard library; curated repository references remain references, not installed dependencies or trading approval. |
| reports | Keep 2.0.2 | Default, mounted | Fixed report/DataRefs and read-only renderer. Original MIT editorial components, offline demo, exact-value table and visible demo provenance retained. |
| research | Merge into data-access | Removed standalone identity | Computation registration still requires a real frozen execution; mutable workspace files cannot replace its evidence. |
| rss-collect | Keep 2.0.2 | Optional MCP | Python standard library; canonical local sample root, explicit network/source limits and no OS-sandbox claim. |
| strategy-authoring | Keep 1.0.2 | Default, mounted | Existing SVL/1 SDK only. New architecture guide separates data, signal, allocation, risk, pending execution and recovery; no new operators or hidden native protection semantics. |
| user-guide | Merge into orchestration | Removed standalone identity | Installation, settings, chat, workspace, troubleshooting and workflow references remain readable through the owning plugin. |
| web-extract | Keep 2.0.2 | Optional MCP | Python standard library; canonical package root and external-path rejection retained; local sample versus network extraction clearly distinguished. |
| web-sources | Keep 2.0.2 | Optional | Explicit HTTP sources and host dataset ports; ordinary source failures and provenance remain visible. |
| workspace | Merge host-files into 1.1.0 | Default, mounted | Thirteen tools. Actual current-user host execution, real cwd, bounded diagnostics and frozen-evidence failures; inspect/reuse before installing missing dependencies. |
| akshare | Upgrade 1.0.4 candidate | Optional | Compatible Python, fixed AKShare dependency; explicit source, observed polling, no tick-feed promise. Separate author's validation applies. |
| qmt | Upgrade 1.1.0 candidate | Optional | Authorized Windows broker terminal and compatible SDK. D1/history, source-qualified closure, raw daily orders/fills, explicit stock order/cancel; normalized order/fill timestamps remain unsupported where native units cannot be proven. No Windows broker-native acceptance is claimed. |
| vnpy | Keep 1.0.2 candidate | Optional | Compatible Python and pinned vn.py/CTA engine; explicit preparation reuses environments and resumable downloads. Actual native CTA evidence is distinct from live brokerage execution. |

The three removed identities are not aliases. Their tools and skills are owned
by the merged package. Existing immutable artifacts remain readable through the
host's artifact protocol; that does not authorize a new plugin to import old
private execution collections. In particular, a fresh MT5 or judgment install
cannot self-claim historical bundled privileges. Old configurations may be
inspected and explicitly imported by a supported plugin tool; no credentials or
real user records are included in this repository or its tests.

## Prompt and skill review

All sixteen packages owned by this reorganization had their prompts or skills
reviewed. Backend assumptions were removed from generic packages. The optional
backend author owns AKShare/QMT/vn.py instructions and tests separately. Reports
retain the lieflat-inspired editorial direction through independently authored
components; no noncommercial upstream code is copied or relicensed. See the
reports package's PROVENANCE, LICENSE and fully offline example.

SVL guidance follows the already implemented v1 contract: required input fields,
handler/input matching, complete timer clocks, duplicate action rejection,
source-window evidence, and explicit unsupported target behavior. Same-event
state copies retain timing evidence; recovered or next-event historical values
do not automatically become current windows. The teaching examples are fixed
synthetic input, not native execution or proof of real market chronology.

## Publication and compatibility

`bundle-profile.json` is enforced during lock construction, including membership,
engine range, optional activation policy and absence of legacy grants. The
release builder materializes that profile from the exact source commit. A new
release plan must name its `core` or `optional` profile. Only the thirteen exact allowlisted historical release plans may omit
profiles and retain their old build semantics; new releases cannot omit the
profile. Prior archives and digests are not rewritten.

`inventory.json` is an **unreleased preview**, generated from both source roots
and reviewed explanatory policy. It contains no installation source commit,
file list or package digest and must not be passed to the installer. The website
can mirror it at an exact public commit, with its preview status visible.

The existing API 1 installation catalog continues to select actually published
dev.12 and optional dev.4 bytes (22 historical entries) until the new 9+10 bundles
are independently reviewed, gated and published. Then a separate metadata PR
selects the two new immutable releases and regenerates all 19 entries from their
exact source/lock/review records. Explicit update uses formal plugin_test and
plugin_update with the installed expected digest. A same-version byte mismatch
is rejected. No floating latest, candidate setup scripts or hidden upgrades.

The stable `plugins/catalog.json` remains the 26-entry Sesame 0.1.4 historical
catalog. It cannot load these native API 1 candidates. The website must present
0.1.4 downloads and the unreleased 0.2 preview separately.
