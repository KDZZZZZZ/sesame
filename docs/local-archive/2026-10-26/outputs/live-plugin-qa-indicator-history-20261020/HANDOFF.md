# Historical indicator input repair

Only three repository files changed in this slice:

- `modules/frontend/src/features/canvas/script-runner.tsx`
- `docs/plugin-api-v1/rendering.md`
- `tests/indicator-results-ui.cjs`

`indicator-history.patch` is relative to the saved `.before` files, not the whole working-tree diff. The test file already had another change before this slice. Reverse application check passed. Per-file baseline/current SHA256 values are in `hashes.json`.

## Cause and repair

The real published QA SMA artifact uses chart-bound, closed-only bars, `lookback:300` and `period:20`. Its unchanged source traverses every received row. The runner previously passed only `slice(-lookback)`, even after the cache had loaded a larger historical window. Therefore 700 closed prices still produced only 281 SMA points.

Chart-bound bars now receive the current bounded cache window including warmup and buffer. The runner keeps `closed_only`, zero-lookback empty input and fixed-data limits. It explicitly refuses over 20000 chart input rows. Source code, parameters, artifact revisions, drawing behavior, cache policy and the Worker timeout/output limits are unchanged. The existing cache and `indicatorInputError` still require actual warmup rows; no synthetic prices or indicator values are inserted.

The documentation distinguishes chart warmup from fixed-input maximum rows. No schema or API changed.

## Verified

- `node worker-baseline-red.mjs` serves the saved old runner only inside the isolated Vite test. Exit 1 at `281 !== 681`, with no chart renderer involved: `worker-baseline-red.log`.
- `node tests/indicator-results-ui.cjs`: exit 0 in 3.43 s, `worker-final.log`. Real isolated Chromium Worker covers prefix loading, unchanged rolling tail values, wall-clock authority, closed/fixed/zero policies, replacement after window rebasing, missing warmup and the 20000-row budget. Existing semantic-change, stale-result and forming-update regressions remain in the same test.
- `node qa-worker-proof.mjs`: exit 0 in 3.52 s. Uses the existing published QA SMA definition/source/parameters without edits, with synthetic wall-clock prices. `qa-worker-proof.json` records 281 -> 681 points, exact first/last points, unchanged old tail, excluded forming prices, not-ready behavior and explicit over-budget failure. This is an isolated product test, not a business report or new market analysis.
- Targeted oxlint and `git diff --check`: exit 0.
- Root independently completed the frontend build with these stable product files (`index-Chdd9psM.js`).

## Separate unresolved rendering observation

A combined real `PriceChart` diagnostic passed the 681-point Worker assertions and deep equality of the chart series' full `.data()` result, but Chromium recorded `Value is null` in Lightweight Charts candle drawing:

`SeriesCandlesticksPaneView._internal__fillRawPoints -> _internal__createRawItem -> SeriesBarColorer._internal_barStyle -> findBar`.

The same exception occurred before this runner repair (`worker-red.log`) and after it (`worker-green.log`). One bounded fixture check corrected OHLC validity and added doctype; the exception persisted. No dependency or `price-chart.tsx` change was made. This diagnostic is **not passing visual validation** and does not establish complete pixel rendering.

The exact combined diagnostic source is preserved as `chart-integration.cjs.source`; `run-chart-integration.mjs` can run it in isolation. No further repair attempts were made after the user's instruction to stop repeatedly expanding unstable fixes. Root owns the limited real-desktop verification after the combined maintenance.
