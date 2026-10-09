---
name: market-discovery
description: Discover active market providers, actual connection revisions and instrument identities through public read-only tools before querying or binding charts.
---

1. Call `data_providers` with `contract:"sesame.market"`. Use the returned `provider:{pluginId,providerId}` exactly. An empty list means no provider is loaded; use plugin discovery/load and its setup guidance. This tool does not install dependencies or connect an account.
2. Call `market_instruments` with `action:"search"`, that provider and the requested code/name. The tool binds the provider's existing configuration, reads a bounded real catalog page, then closes its temporary binding. It returns the actual `connection:{id,revision}`, instrument `ref`, source identity and read metadata. Do not calculate a source ID from a symbol or read application files to find one.
3. Inspect `items`. Names are not globally unique. Select the exact requested source/instrument; when `has_more:true`, refine the query or increase `limit` up to 200. This tool deliberately returns no cursor from a binding it has closed. It does not claim the bounded results are the complete catalog.
4. `action:"describe"` with the returned `instrument` and `connection` gives the actual `features`, time basis, volume units, calendar status and `series_options`. Retain explicit unknown/unsupported fields. Standard periods are `1h` and `15m`, for example, rather than a platform's `H1` or `M15`. Only select values the provider declares or its documentation supports.
5. For a chart, call `canvas_binding` with the chosen provider/instrument/timeframe and current connection. It returns `binding` and a ready-to-copy `chart` patch; then use `canvas_apply` with the current layout version. Provider binding and layout acceptance do not prove rendering; inspect the current chart receipt afterwards.

When there is one declared price basis, adjustment or session, `canvas_binding` chooses it. With multiple values, select the intended one explicitly. If no session is declared, read that provider's plugin guidance and specify it. Do not invent a pinned calendar: keep `calendarRevision:{status:"unknown",...}` if that is what the source reports. Rebind after `CONNECTION_CHANGED`; do not overwrite the old revision to force stale source identities through.

Provider `configuration` contains only documented public binding options, such as a data source name. Passwords/tokens belong in that provider's configuration flow. A provider requiring a connection must supply its ID/revision through its own documented setup; there is no universal account-discovery side channel.

`data_sources`/`data_query` serve registered datasets and plugin-specific research sources. They are distinct from the typed market provider catalog. For durable analysis, use `data_query` → `data_snapshot` → `data_read`, then publish evidence in a report. Query previews and market catalog metadata alone are not frozen price evidence. Live chart subscriptions are owned by the frontend, not a model polling loop.
