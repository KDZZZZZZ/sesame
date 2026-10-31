## Change

Bring the plugins used by the current development workspace into dev, including the previously untracked packages and their complete source, tests and documentation.

- Organize plugins by business workflow, analysis, integration, presentation and platform responsibility, with independent implementation types and capability-bound configuration.
- Add Ultra and Binance; separate investment research, trading decisions and execution; extend factor diagnostics and collaboration with knowledge/calculation plugins.
- Integrate unified report templates, chart catalog and decision trees, drawing contracts, MT5 execution/time fixes and CCXT recovery.
- Fix the early-child handoff race without delaying the regression fixture, and align test callers with the current authority and execution contracts.
- Refresh source locks and inventory for 10 core and 48 optional packages. Preserve the original contract baselines and immutable published release pins.

## Validation

- Both package locks, inventory, API 2 catalog/release-plan static validation and reviewed boundary checks pass.
- Focused Node sweep initially exercised 656 tests; failing areas were repaired and rerun. Final architecture/boundary/pilot group: 49/49; package/parser/adapter group: 11/11; all six unified workflow tests pass.
- Python backend fixtures: 21/21 pass. No real model requests or account transactions were issued during this sync.
- Remote dev's Investment Research 3.1.4 functionality and all existing tests are retained in 3.1.8; the merge preserves dev ancestry and the reviewed local tree.

## Compatibility

Plugin API remains 2. Packages using the new host contracts declare Sesame >=0.3.0-dev.1 <0.4.0. Local declared scopes and exact capability calls follow the current host contract; external user-message ingress remains separately authorized. This PR updates development source, not published plugin archives or the stable application release.
