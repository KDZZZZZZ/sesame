# Independent optional research methods — author validation

Validated 2026-10-10 on macOS arm64 with Node.js 25.2.1 and a matching local
Sesame API 1 development host. Both packages declare `engines.sesame >=0.2.0-0`.
This record is author execution evidence, not an independent approval or a claim
that the application has been released.

## Package boundaries

- `sesame/strategy-research` 1.0.0: original MIT plan, temporal split and complete
  experiment-ledger audits. It does not execute an engine or implement a named
  strategy. Actual completed trials require a fixed `strategy.result` reference.
- `sesame/factor-research` 1.0.0: original MIT selected-factor diagnostics,
  training-only redundancy, explicit selection and selected-only holdout. No
  Qlib, genetic/causal model, framework source, market data or dependency bundle.

Each package has zero tools/providers, one independently loaded skill, declared
CLI/demo/reference resources and no migration or internal host privilege. The
Node.js scripts use built-ins and need no package installation. Source/license
identities and original-paper links are in each package's `PROVENANCE.md`.

## Executed checks

`node --test plugins/optional-api-v1/tests/research-methods.test.mjs`: **22 passed**.
Includes the package validator, exact hand-calculated rank/cost answers, ties,
undefined constant correlations, missing/delisted returns, future features,
overlapping labels, late availability and purge, frozen byte drift, invalid
UTF-8, changed selections, complete trial budgets, empty result references,
digest/ID type coercion, output retry identity and actual CLI invocation through
a symbolic directory alias. A file-open probe confirms that absent or invalid
selection fails before opening the physical holdout input.

The opt-in `research-methods-host.test.mjs`: **1 integration test passed**. It
accepts `SESAME_HOST_ROOT` from its caller and dynamically imports that matching
host. All data and installed files are in a new temporary root:

1. Copy the fixed nine core packages into a separate validated fixture bundle;
   run formal `plugin_test` and `plugin_install` for both new packages.
2. Load each skill in a different real Pi session; the other skill stays absent,
   unloaded resource access fails, and every declared resource matches its source.
3. Execute three strategy audits and five factor workflow commands through the
   actual workspace `bash` tool (eight real Node.js commands, no model call).
4. Use the real `data_read` byte serialization. Register a one-row selection
   from an execution snapshot using `research_register`, then freeze it with
   `report_data` and a development-data dependency. Verify its actual immutable
   row before the holdout input has been exported into the workspace.
5. Export the separate holdout, evaluate only the selected factor, register four
   diagnostic rows and freeze them with selection and holdout-input references.
   All stages retain `demo` provenance. Close/reopen Store and Runtime; both
   session load states and fixed selection/result rows survive.

The fixture forbids network access and confirms zero requests, zero model calls
and zero native engine calls. Temporary state is deleted after verification.
To rerun against an explicitly selected compatible checkout:

```sh
SESAME_HOST_ROOT=/absolute/path/to/host node \
  --import /absolute/path/to/host/modules/plugins/sdk-loader.js \
  --test plugins/optional-api-v1/tests/research-methods-host.test.mjs
```

Without that environment variable the host-specific integration is explicitly
skipped; the dependency-free public tests remain runnable on their own.

## Limits

All sample rows, availability timestamps and the delisting event are invented
software fixtures, not market performance. The host integration verifies the
fixed-selection-before-holdout sequence for this test; it cannot prove a human
or another program never viewed data, omitted an experiment or changed local
files outside the sequence. The CLI is a consistency audit, not a tamper-proof
ledger or a vendor point-in-time certification service.

Statistics use binary64 and provide no significance, DSR, PBO, causality or
return guarantee. Portfolio diagnostics assume fixed flat-to-flat exposure and
costs; they do not establish shortability, margin, liquidity, execution timing
or broker results. No new native backtest, live source, Windows/Linux host,
complete Agent conversation, browser report or trading test is claimed here.
No running application, live cache, account or terminal was touched.
