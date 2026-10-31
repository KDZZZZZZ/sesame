# Plugin read-only capability release verification

Date: 2026-10-17. Workspace: `E:/brief2great/sesame/sesame`.

This record preserves the command and terminal result observed by the plugin release lane. It is a verification summary, not a reconstructed TAP stream.

## Final whole-file regression

Executed with the real host SDK loader and host root:

```powershell
$env:SESAME_HOST_ROOT='E:/brief2great/sesame/mt5agent'
node --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js --test plugins/optional-api-v1/tests/manual-trading-analysis.test.mjs plugins/optional-api-v1/tests/mt5-analysis-effects.test.mjs plugins/optional-api-v1/tests/portfolio-execution.test.mjs plugins/optional-api-v1/tests/manual-trading-personal-memory.test.mjs plugins/optional-api-v1/tests/manual-trading-plans.test.mjs
```

Observed process exit: `0`. Terminal summary:

```text
tests 64
suites 0
pass 64
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 18676.4892
```

The run included real-host validation/install/registration of manual-trading. Broker/native calls and model completion use fixtures; no live trading, paid model, or account credentials were used.

New regression coverage:

- Real MT5 manifest: default analysis excludes 17 write/mixed capabilities; explicitly selecting each rejects before admitting a workflow or Agent.
- Real portfolio execution binding and real portfolio/MT5/financial-research declarations: financial-research-only selection retains account, schema discovery, market/indicator reads in all eight role grants. A producer that incorrectly adds mixed Python access to readTools is still filtered. Frozen execution metadata agrees with the actual grants.
- A context declaring write effects is rejected before identity dispatch; no broker call, plan, or Run is created.
- Real native routing accepts market and indicator reads and rejects 22 representative write routes and an unknown method before native dispatch.
- Only order_calc_profit and order_calc_margin from the declared Python methods route through mt5_call; all other Python methods are rejected at the pure-read entry.
- Catalog queries never request a MetaEditor start. A read-only MetaEditor workspace call also does not request startup; the explicit editor operation retains its startup behavior.
- Portfolio binding rejects MT5 1.5.0, 1.6.0 and 2.0.9 before native dispatch and names the required 2.1.0+ contract.

## Earlier affected-plugin regression

The following six complete files also passed during the effects/admission phase: mt5-v2-host, mt5-terminal-capability, mt5-configuration-credentials, mt5-workflow-provenance, mt5-positions-v2, manual-trading-composition. Observed result: 31 tests passed, zero failed/cancelled/skipped; exit 0; duration 61741.8179 ms. The installed MT5 host test reported nativeTerminalCalls=0, vendorCalls=0, declaredSources=5, credentialsRedactedBeforePersistence=true, immutableTarget=true. This earlier run preceded the final pure-catalog/risk-calculation additions and is not represented as a rerun of the final snapshot.

## Static checks and final documentation

`git diff --check` and `node --check` passed for manual-trading/runtime.js, manual-trading/team.js, mt5/backend/official.js, portfolio-execution/bindings.js, and the modified fixture. JSON manifests were parsed and exercised by the tests.

After the 64-test run, only two related prompt sentences were synchronized: manual-trading/prompt.md and mt5/tools/python/prompt.md now identify mt5_call as the two pure Python calculation methods' route. No executable code changed after that run. The final diff whitespace check also passed.

Independent reviewer reported no remaining code blocker after reading the affected production changes and running nine focused checks. Source version/lock regeneration and commit/publish remain owned by the root release lane.
