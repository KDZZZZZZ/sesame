---
name: market-chart
description: Bind charts from discovered provider and instrument identities, then publish typed indicator artifacts and verify actual rendering.
---

## Open or update a market chart

1. `canvas_inspect` returns the current layout version, chart IDs, receipts and `market_providers`. `data_providers` gives the same public provider identities without reading layout. Keep existing charts and user locks unless the task calls for changing them.
2. Use `market_instruments action:search` to find the exact instrument in the chosen provider. Preserve the returned InstrumentRef and real ConnectionRef. Use `action:describe` when you need to inspect supported periods, units or source-time semantics. These are public plugin tools; reading application source, credentials or provider implementation files is unnecessary.
3. Call `canvas_binding` for each required timeframe. For example, two views of the same discovered instrument may use `timeframe:"1h"` and `timeframe:"15m"`. Reuse the returned provider/connection/instrument values, not a hard-coded vendor ID. The result's `chart` contains a display symbol, a complete binding and `volume:true`.
4. Send those chart objects to `canvas_apply` in `add` or `update` operations with the latest `expected_version` and one stable `command_id`. `chart.symbol` is only a label. The actual data identity is `chart.binding={provider,connection?,instrument,spec}`; there is no `chart.period` field. Binding `null` explicitly removes the market source.
5. Inspect again. Layout success only saves a requested view. Claim it is displayed after the current version's recent frontend receipt reports the target chart rendered. Preserve failures and stale source status. Forming bars and source volume are enabled by default; tick volume is not traded lot volume.

Changing timeframe, price basis, adjustment, session or connection creates a different series. `canvas_binding` preserves unknown calendar status, actual source time basis and provider metadata; it never fabricates a broker timezone or calendar. A description-only validation does not fetch candles or certify their freshness.

## Add analysis as an indicator artifact

Use `indicator_publish` followed by `chart_script action:put` with its full ArtifactRef and the target `chart_id`. The schema describes inputs, panes and series before code runs. Read the packaged `resources/close-line.json` and `resources/close-line.js` for a complete minimal example; it plots observed closing prices and makes no strategy claim.

The code must export `compute(input)`. Read declared bars from `input.inputs.<inputId>.rows`; each row has an ID, `openTime`/`endTime` SourceTime, Decimal-string OHLC, typed volume and `isClosed`. Preserve SourceTime as returned, including broker wall time. Do not use old `{time,open,volume}` chart-library input assumptions or a bare function body.

Return `{status,series,diagnostics}`. A line/area/histogram entry is `{seriesId,points:[{key,time,value:{status:"value",value:"1.2345"}}]}`; a marker entry uses `{seriesId,markers:[{key,time,position:"above"|"below"|"at_price",price?,shape:"circle"|"arrow_up"|"arrow_down",color,text?}]}`. Match every `seriesId` to the declaration and use stable keys. Missing values have explicit value status; not enough warmup returns `not_ready`. Numbers used in JS calculations must be finite and converted to Decimal strings on output; a binary64 calculation is not exact decimal arithmetic.

Use `inputs[].forming:"include"` for analysis that intentionally updates with the current bar; use `closed_only` for confirmed-bar logic. The source's `isClosed` is authoritative. A pivot requiring later bars cannot be labelled as known at its earlier bar without disclosing confirmation delay. Wave, PA and ICT annotations are analysis with stated rules and uncertainty, not evidence of a strategy fill.

Give overlays a `placement:"main"` pane and `scale.mode:"price"`. Give an oscillator/volume-like series a `placement:"separate"` pane and independent scale. Only line, area, histogram and markers are supported by this contract; do not promise rectangles or arbitrary chart-library APIs. JavaScript is supported; TypeScript and streaming static data have no executor in this release. Python research may publish a fixed DataRef for a static series, retaining its exact instrument/spec and provenance.

Each chart owns its indicator instance and generation. The frontend recalculates bounded declared inputs and checks output before replacing the frame. Code has no network, host filesystem, credentials or trading API. Do not reference a temporary child workspace file: publish all code/data dependencies first. After mounting, verify current instance/render receipts through `canvas_inspect`; publication and successful computation alone do not prove a visible plot.
