# Trading decision split validation — 2026-10-18

Owner: /root/manager_reports_plugin. Scope: plugin package and prior manual-trading tests. No broker I/O, real orders, installation into the running user app, release, or lock-file changes.

## Source result

- Replaced packages/manual-trading with packages/trading-decision; id sesame/trading-decision; capabilities trading_decision_* (activate/dispose remain host lifecycle bindings).
- Removed analyze/admission/purpose branch, eight-person research team, mode/debate/research composition, execution_export, legacy account-key fallback and old plan migration repair.
- Only manager and executor remain. Manager consumes exact research_refs through data_read, personal risk memory and execution-provided account reads; executor only receives trading_decision_apply.
- research_refs are complete data ArtifactRefs. They are copied into the frozen decision, read using their exact manifest, and retained without recursively duplicating a large research/source graph. Regression fixture exceeds 512 KiB.
- Scheduler, account/model checks, immutable targets, authorization, unknown-order safeguards, actual execution receipts and same-Run recovery remain covered.
- Final trading report is archived only after execution and renders the last completed manager summary. Original raw data is untouched.

## Validation evidence

1. Full suite with SESAME_HOST_ROOT=E:/brief2great/sesame/mt5agent:
   node --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js --test tests/trading-decision*.test.mjs
   PowerShell expanded files before invoking Node.
   Result: 150 tests; 149 passed; 1 failed; 0 skipped; 67.17 seconds.
   Only failure: portfolio-execution minimum-host-version expectation still >=0.2.3 while the manifest was updated to >=0.2.4. Corrected this test assertion.
2. Re-ran tests/trading-decision.test.mjs after the correction: 19/19 passed, 0 skipped.
3. After removing the unused legacy plan/account-key compatibility, ran plans, unified, judgment-boundary, boundary and reports tests: 48 tests, 46 passed and 2 fixture failures. Both old unified fixtures omitted the now-required execution binding; production plans always obtain it from configure. Updated that fixture and used manager-to-executor roles for its handoff test.
4. Re-ran tests/trading-decision-unified.test.mjs: 12/12 passed. The other 36 tests from step 3 passed without further source changes.
5. node --check succeeded for every trading-decision JavaScript module. oxlint succeeded for the package and all trading-decision test files; final lint also passed after the fixture update.
6. Package scan finds no manual-trading/manual_trading identifiers, analyze admission, selectResearch, ANALYSTS or migrationRequired. packages/manual-trading is absent.

The full suite was not repeated after the targeted fixes; all reported failures have fresh passing targeted evidence. The actual Runtime/Agent integration in the full run passed in 67 seconds, and the formal portfolio-execution host composition test passed in 12.8 seconds. No fixed-response unit test is represented as a real 6.1sol test.

## Safe real-model composition test

Use configured 6.1sol via trading_decision_models. Enable sesame/trading-decision, sesame/memory and sesame/data-access, plus a temporary execution fixture plugin. The fixture must declare context/apply capabilities, identity account/taskContext/tools/readTools/quantityRules, and an empty full snapshot (positions/orders/fills/historicalOrders/deployments arrays). Apply must reject all targets or pauses and permit only unchanged=true with empty targets, returning unchanged/orders:[]/pauses:[]/targetReached:null. Do not bind a broker.

Save trading_decision_plan with the actual investment_research_analyze.result_ref in research_refs; an explicitly empty-account/no-new-risk instruction; no interval or event schedules; enabled=true. Invoke trading_decision_run with a stable request_id. Inspect actual child model calls for fixed data_read plus risk memory/account context, and verify the manager freezes unchanged before executor consumes it. Reference tests/trading-decision-agent-host.test.mjs for actual host installation/Run/report plumbing and tests/trading-decision-plans-fixture.mjs for the minimal no-broker binding shape.

Source and tests frozen before lock/inventory synchronization by parent.
