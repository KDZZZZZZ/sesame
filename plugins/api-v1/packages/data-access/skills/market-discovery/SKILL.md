---
name: market-discovery
description: Discover active market providers, actual connection revisions and instrument identities through public read-only tools before querying or binding charts.
---

1. Call `data_providers` with `contract:"sesame.market"`. Use the returned `provider:{pluginId,providerId}` exactly. An empty list means no provider is loaded; use plugin discovery/load and its setup guidance. This tool does not install dependencies or connect an account.
2. Call `market_instruments` with `action:"search"`, that provider and the requested code/name. The tool binds the provider's existing configuration, reads a bounded real catalog page, then closes its temporary binding. It returns the actual `connection:{id,revision}`, instrument `ref`, source identity and read metadata. Do not calculate a source ID from a symbol or read application files to find one.
3. Inspect `items`. Names are not globally unique. Select the exact requested source/instrument; when `has_more:true`, refine the query or increase `limit` up to 200. This tool deliberately returns no cursor from a binding it has closed. It does not claim the bounded results are the complete catalog.
4. `action:"describe"` with the returned `instrument` and `connection` gives the actual `features`, time basis, volume units, calendar status and `series_options`. Retain explicit unknown/unsupported fields. Standard periods are `1h` and `15m`, for example, rather than a platform's `H1` or `M15`. Only select values the provider declares or its documentation supports.
5. For a chart, call `canvas_binding` with the chosen provider/instrument/timeframe and current connection. It returns `binding` and a ready-to-copy `chart` patch; then use `canvas_apply` with the current layout version. Provider binding and layout acceptance do not prove rendering; inspect the current chart receipt afterwards.

## Read and freeze historical prices

Use `market_read` after discovery when analysis, a report, or a native bar backtest needs actual prices. This is the public bridge from a typed market provider to durable data; do not copy its bridge scripts, inspect application source, or invent private HTTP routes to obtain the same data.

Pass `operation_id`, `title`, the discovered `provider`, `connection`, `instrument`, full `spec`, an explicit `range:{from:SourceTime,to:SourceTime}` (inclusive/exclusive), `include_forming`, and `volume_kind:"real"|"tick"|"none"`. `max_rows` defaults to 10000, at most 100000. The `spec` has `timeframe`, `priceBasis`, `adjustment`, `session`, and `calendarRevision`; retain a returned unknown calendar rather than inventing one. Bounds must share a time basis: UTC is `{basis:"utc",unixMs:...}`; wall time is `{basis:"wall",authority:"the returned source clock",value:"2026-09-01T00:00:00"}`. Never add `Z` to an unknown broker clock. The provider must actually support the range and specification.

The tool reads forward pages within one temporary binding, checks a stable snapshot/series identity, and closes it on success or failure. It returns:

- `ref`: fixed `data` ArtifactRef with `json-rows`, directly usable in `report_publish.data[].ref` or a DataRef-consuming engine.
- `dataset_id`: the same projected rows registered for `data_read({dataset_id:...})`; keep `ref` for durable citation.
- `raw`: a fixed resource containing the original public Bar pages, provider metadata and coverage. It excludes the supplied binding configuration.
- `sample`, `columns`, `volume`, `coverage`, and `status`: bounded preview and actual limitations, not a complete-data or runtime-validation certificate.

Rows have `datetime` (the unchanged Bar openTime SourceTime), `end_time`, exact Decimal `open/high/low/close`, selected `volume`, `volume_unit`, `volume_kind`, `volume_status`, `is_closed`, `closure`, `id`, and `revision`. Real volume retains its source unit, including share versus lot. Tick volume is an integer quote count labelled `tick`, never traded volume. Choosing `none` or receiving unknown/unsupported volume gives `null`, not zero. Original values/statuses remain in `raw`. Projection is labelled derived with `raw` as its dependency; demo sources stay demo.

This version does not resolve daylight-saving `fold` values into chronological instants. An explicit `fold:0` or `fold:1` in a requested wall-time bound or returned Bar produces `UNSUPPORTED_CAPABILITY` with no new artifact; the temporary binding is still closed. Use UTC SourceTime only when the provider actually supports it, or choose an unambiguous range. Do not remove `fold`, guess an offset, or sort a repeated clock hour as ordinary wall text.

For `vnpy_backtest`, pass this `ref` as `data`; default columns already match `datetime/open/high/low/close/volume`. For wall timestamps pass the exact returned `wall_time_authority`. Check volume units and engine assumptions first. The engine rejects missing volume; do not silently fill it or convert lots into shares. Actual engine execution, matching assumptions and result artifacts remain that plugin's responsibility.

`status:"partial"` or `coverage.complete:false` means the fixed returned rows do not establish gap-free history. Completing every cursor is not proof of an authoritative exchange calendar. Read warnings and the raw provider coverage before drawing conclusions. Forming rows are explicitly identified; a closed-bar strategy usually requests `include_forming:false`.

The same `operation_id` with the same arguments returns the successful frozen snapshot without a new provider read, including after restart. A conflicting request is rejected. To fetch newer observations use a new ID. If publication fails after the read completed, retry the same request to resume the retained bytes. A mid-read failure or over-budget result publishes nothing; do not treat an error as a partial success. Limits are 200 pages and 16 MiB each for raw responses and projected rows. Narrow the range or explicitly raise `max_rows` within its supported bound; no rows are silently dropped to fit.

When there is one declared price basis, adjustment or session, `canvas_binding` chooses it. With multiple values, select the intended one explicitly. If no session is declared, read that provider's plugin guidance and specify it. Do not invent a pinned calendar: keep `calendarRevision:{status:"unknown",...}` if that is what the source reports. Rebind after `CONNECTION_CHANGED`; do not overwrite the old revision to force stale source identities through.

Provider `configuration` contains only documented public binding options, such as a data source name. Passwords/tokens belong in that provider's configuration flow. A provider requiring a connection must supply its ID/revision through its own documented setup; there is no universal account-discovery side channel.

`data_sources`/`data_query` serve registered datasets and plugin-specific research sources. They are distinct from typed market providers. For those sources use `data_query` → `data_snapshot` → `data_read`; for typed price history use `market_read` directly. Query previews and market catalog metadata alone are not frozen price evidence. Live chart subscriptions are owned by the frontend, not a model polling loop.
