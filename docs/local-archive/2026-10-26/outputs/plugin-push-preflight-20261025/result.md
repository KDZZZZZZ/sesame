# Plugin pre-push validation and limited repairs

Date: 2026-10-25
Repository: `E:/brief2great/sesame/sesame`

## Result

All initially failing tests in the exercised groups have passed after targeted repairs. No Git staging, commits, pushes, real model requests, real account access, installation or application restart was performed.

- Inventory: exit 0; 10 core + 48 optional packages (58 including Kurumi).
- Core lock: exit 0; SHA256 `b9b6be00233793866003d78170d9a68a59b3c7d2492a6e06949d37020a4209ef`.
- Optional lock: exit 0; SHA256 `18879d389a8c32f8534eee5a74263fe6cf86ac01197af281b62614948593eb76`.
- Trusted API 2 CI catalog: exit 0; 58 packages, 2 immutable R2 plans, v0.2.4 application plan with 12 assets; remoteChecked=false.
- Boundary validator: exit 0; 24 packages, 48 declarations, 256 capabilities.
- CRLF-aware `git diff --check`: exit 0.
- Final architecture/inventory/boundary/pilot regressions: 49/49 passed. TAP: `metadata-final.tap`.
- Final package/native-parser/execution-adapter regressions: 11/11 passed.
- Earlier repaired MT5 caller, scaffolding, isolated demo generation and immediate-start workflow handoff tests passed. All 6 unified workflow tests passed, including the new handoff provenance regression.

The original deterministic sweep exercised 656 Node tests and 21 Python tests. The Node sweep initially had 12 failures; each failing area was rerun after repair. Already passing groups were not repeatedly rerun. This is targeted completion evidence, not a claim that an additional fresh whole-repository sweep was run after every edit.

## Repair intent

- `plugins/api-v1/tests/packages.test.mjs`: use only the remaining MCP package for MCP samples; native parsers have host transport coverage. Generate and compare the report demo in an isolated temporary package copy so tests cannot rewrite source files.
- `plugins/api-v1/packages/reports/examples/editorial-demo.html`: retain the reproducible output generated from the current report theme, as requested by the parent.
- `plugins/api-v1/tests/plugin-scaffold.test.mjs`: assert the current declared-local-scopes and separately authorized external-message contract.
- `plugins/optional-api-v1/tests/{host-v2-fixture.mjs,mt5-permissions-schema.test.mjs,mt5-v2-host.test.mjs}`: bind fixture callers through the real host authority. No production permission relaxation.
- `plugins/optional-api-v1/tests/trading-decision-host.test.mjs`: register the current execution service and exercise the actual MT5 execution adapter against deterministic native results; supply the required symbol price step and permission flags.
- `plugins/optional-api-v1/packages/{market-data-parser,rss-collect,web-extract}/samples.json` and `quantskills-catalog/plugin.json`: expected version values only, synchronized to 3.0.2.
- `plugins/optional-api-v1/packages/auto-factor-mining/runtime.js`: an immediately started child could read its context before the parent stored its returned Run reference, losing handoff edges. After assignment validation, derive the early target from trusted agent execution provenance and require the matching child Run, parent workflow and owner.
- `plugins/optional-api-v1/tests/auto-factor-mining-unified.test.mjs`: retain immediate startup; reject forged child/workflow/owner provenance; verify one handoff and no duplicate on repeated context reads.
- `plugins/api-v1/tests/fixtures/plugin-boundaries-reviewed-changes.json`: precisely review 11 changed components, retain every immutable baseline, and preserve all unrelated approvals. Reviews describe actual engine/call declarations, MT5 public receipt schemas, report additions, workflow documentation and version-only sample adjustments.
- `plugins/api-v1/tests/fixtures/analysis-plugin-contract-extensions.json`: update the two factor-evaluator records against authenticated archived originals; add only the ABU parameter-search input-only research declaration. Seven diagnostics remain optional. No baseline hashes or raw baseline files are changed.
- `plugins/optional-api-v1/tests/plugin-architecture-pilots.test.mjs`: update exact reviewed Investment Research snapshot hashes while retaining entry-point/default-input/fixed-result tests.
- Both `official-plugins.lock.json` files and `plugins/api-v1/inventory.json`: regenerated after all source, sample and demo edits.

## Pre-push hygiene

The initial pending tree contained source, tests, declarations, documentation and report assets. No real secret, private key, account database or generated application bundle was found in the pending text file scan. Matches were synthetic test credentials and fixture endpoints. New package directories include Ultra, Binance, Investment Research and Trading Decision and must be included along with their helpers/tests; the intended old manual-trading and migrated parser deletions must not be omitted.

The legacy `plugins/api-v1/scripts/catalog.mjs --check` checks an old API 1 published catalog and is not the current API 2 CI entry point. Its historical data was left intact; `.github/scripts/validate-catalog.mjs` passes for the current tree.

Backups for this limited repair are under `before/`. The regenerated report demo had already been backed up after generation; its pre-generation bytes were separately verified against the old lock in the historical output artifact.
