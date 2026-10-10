# CCXT / Backtrader candidate validation

Optional API1 1.0.0 candidates, target Sesame >=0.2.0-0. No default bundle/catalog/release plan changed.

Actual macOS arm64, native Python 3.14.2, CCXT 4.5.85 and Backtrader 1.9.78.123:

- Formal host manager test → digest-verified install → activate for both packages; no startup dependency download. Provider registered through public HostContext.
- Explicit private PyPI preparation installs pinned root libraries, records resolved distributions and official download SHA256 reports. Initial CCXT attempt hit a truncated PyPI JSON index; a preserved bad HTTP cache was moved aside and explicit retry succeeded. No alternative index was used.
- Direct Kraken and Coinbase requests reached the plugin's bounded timeout; they were not treated as empty success. Explicit Kraken `configuration:{exchange:'kraken',publicProxy:'http://127.0.0.1:7897'}` succeeded. This local proxy is an evidence route, not a default or network guarantee.
- Actual Kraken public BTC/USD, spot, 1h, last/none/all, UTC, `includeForming:false`: 71 closed bars. Source successor is closure evidence; receipt wall clock is not. Observed 2026-10-10T02:22:05.667Z, first UTC 2026-10-07T03:00:00Z, last UTC 2026-10-10T01:00:00Z. Coverage remains partial.
- Exact real bars were frozen as observed json-rows and fed to actual Cerebro with an authored research Strategy, one simulated 0.01-unit roundtrip, initial cash 10000, commission ratio 0.001, slippage ratio 0. Final equity/cash 9999.101693, one closed trade. This is native floating-point cash research, not broker execution or SVL equivalence.
- Evidence retained only in owned temporary host: `/tmp/sesame-quant-public-live-j3eoZZ/evidence.json` and its Store/artifact blobs; source DataRef digest `sha256:29ab7b6ad7448e047f08d575c527ee6c06026ac3f17b4176bd45067fc49e2272`, result digest `sha256:8ad149493ebf06047a522c3de23b5860e0f21d56a12144047cd9d428627b18b2`. These IDs belong to that temporary host and cannot be passed into another Store. Re-freeze original bytes there or use the application's own market_read output.
- Dedicated repository integration tests additionally execute real Cerebro on explicitly demo data, immutable-operation replay/conflict, native failure outcome, cleanup and formal provider contract boundaries. CCXT fixtures cover backward cursor, precision boundary, source closure persistence, OHLC/negative volume and source identity.

No Windows/Linux engine execution, authenticated exchange APIs, live broker, margin/futures, IBKR, LEAN, Qlib or SVL translation claim. Arbitrary authored strategy Python executes with current-user host permissions. Import/version verification is not an environment security audit.

## Minimal application operations

1. Install/load `sesame/ccxt` and `sesame/backtrader` through the normal digest-tested plugin manager. Call each environment tool with `action:'inspect'` and an existing native Python path; use explicit `action:'prepare'` only if missing.
2. Bind provider `{pluginId:'sesame/ccxt',providerId:'market'}`, input `{configuration:{exchange:'kraken'}}`; add the explicit credential-free `publicProxy` only if the user selects that route. Persist the returned exact connection. Instrument `{sourceId:'ccxt:kraken:spot',instrumentId:'BTC/USD'}`. Spec `{timeframe:'1h',priceBasis:'last',adjustment:'none',session:'all',calendarRevision:{status:'unknown'}}`. Use host data-access market_read to produce a fixed OHLCV DataRef and retain source/time/coverage metadata.
3. Write one `backtrader.Strategy` class in the task workspace. `backtrader_backtest({operation_id:<new immutable key>,title:<title>,data:<fixed DataRef>,strategy_path:<real workspace path>,class_name:<class>,config:{capital:'10000',commission:'0.001',slippage:'0'}})` returns strategy.result plus equity/trades/orders DataRefs. Call `backtrader_result({ref})` to read without rerun.
4. Existing Tencent 506-day dataset may be reused only by its exact DataRef in the same host. Map fields with `columns:{datetime:<column>,open:<column>,high:<column>,low:<column>,close:<column>,volume:<column>}`. Input timestamps must already be UTC SourceTime or ISO with explicit offset. Ambiguous wall SourceTime is rejected; any warranted zone conversion must produce a separate derived immutable dataset with explicit provenance, never silently guess in the engine.

## Independent-review corrections

- `inspect` now validates and atomically selects an existing environment, without installing/upgrading it. Real fresh host CCXT inspect→worker query on existing 4.5.85 returned 23 Kraken BTC/USD closed hourly bars, downloads `[]`. Backtrader inspect→actual Cerebro also passed with existing 1.9.78.123.
- Separate official Backtrader Analyzer captures every bar, including indicator warmup, without wrapping strategy callbacks. Actual SMA(3) six-bar strategy kept exactly two prenext, one nextstart and three next hooks; six unique equity rows were captured. Orders separately expose notificationBarTime and actual executedTime from order.executed.dt (null before an execution timestamp exists).
- Six dedicated tests passed with real existing environments and explicit Kraken public proxy. Log `/tmp/sesame-quant-review-final.log`. No shared configuration or live host modified. Formatter changes make JS and both Python boundaries readable; manifest author identifies Sesame contributors.

## Real host market_read → Backtrader verification

The exact fixed DataRef projection was verified through the installed data-access plugin, not merely an adapter-created sample. Log `/tmp/sesame-quant-market-read-live.log`, evidence `/tmp/sesame-quant-public-live-O7haKg/evidence.json`. Actual Kraken BTC/USD displayDecimals is 1, derived from CCXT TICK_SIZE price precision 0.1. A tiny-tick regression verifies 12-place display and significant-digit/unrepresentable modes explicitly reject.

Executed input (timestamps are an example bounded historical interval, not an instruction to refresh the same operation):

```json
{
  "operation_id": "real-kraken-host-market-read",
  "title": "Fixed public Kraken BTC/USD",
  "provider": {"pluginId":"sesame/ccxt","providerId":"market"},
  "configuration": {"exchange":"kraken","publicProxy":"http://127.0.0.1:7897"},
  "instrument": {"sourceId":"ccxt:kraken:spot","instrumentId":"BTC/USD"},
  "spec": {"timeframe":"1h","priceBasis":"last","adjustment":"none","session":"all","calendarRevision":{"status":"unknown"}},
  "range": {"from":{"basis":"utc","unixMs":1791342000000},"to":{"basis":"utc","unixMs":1791597600000}},
  "include_forming": false,
  "volume_kind": "real",
  "max_rows": 500
}
```

Use the returned `ref` unchanged as `backtrader_backtest.data` in that same Store. `market_read` returns columns `datetime/open/high/low/close/volume` (plus identity/coverage/volume evidence): datetime is the original UTC SourceTime, volume is selected Decimal text, so no `columns` override or transformation is required for this source. Actual 71-row returned ref digest `sha256:a0b8f959ad6e33f625d0912b5033e78e44ef04d8ddc30b4a1a3c71821757cef4` ran successfully through the revised Analyzer engine; result digest `sha256:5536dc5a16ccc6718c0dc0a8d99ea7a62724bdc1990010b77cfb1f06d5bc39cd`. One simulated closed trade, final cash/equity 9999.101693. No real transaction.
