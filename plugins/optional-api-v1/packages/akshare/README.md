# AKShare optional market provider

Load `sesame/akshare`. It never downloads on activation. Discover/reuse a compatible native Python first; explicitly prepare private dependencies only when missing.

Select and persist one exact connection: `akshare:eastmoney`, `akshare:sina`, or `akshare:tencent`, revision `1.19.1`. Sources are never silently mixed or switched. Tencent currently provides actual A-share catalog/last-price observations via `stock_zh_a_spot_tx` and daily history via `stock_zh_a_hist_tx`; Eastmoney provides bid/ask snapshots; Sina provides daily history.

`quotes.subscribe` polls the chosen Eastmoney/Tencent snapshot every 60 seconds, without overlapping reads. Quote time is the actual HTTP observation time; exchange event time is unavailable, freshness unknown, and bid/ask are unknown when absent. This is not an exchange tick feed. Tencent reads one all-market snapshot per poll (at most five selected instruments).

`bars.subscribe` polls actual daily history every 60 seconds and returns the selected daily tail. The latest source row remains forming/closure unknown until a later source-dated row or explicit source completion flag proves closure; HTTP receipt time and 15:00 wall time never certify it. No minute bars are created from quote snapshots, no calendar completeness is claimed. A gap terminates the stream with the actual error and requires a new snapshot.

Bind/search/describe and canonical daily bars use the same `Asia/Shanghai` wall authority and IANA zone. UTC queries and daily subscriptions retain that zone on bar open/end times. A wall range with `zone: "Asia/Shanghai"` receives the same representation. For compatibility, an older wall range that omits `zone` at both ends receives zoneless wall times with the unchanged authority and values; `meta.source.timeBasis` and a warning retain the known zone. This projection does not change bar identity/revision or mutate another query's snapshot. UTC range boundaries are converted through the declared IANA zone with milliseconds retained, including historical Shanghai daylight-saving time rather than assuming a permanent +08:00 offset. Other zones, authorities and ambiguous folds are rejected; no offset is guessed.

History is paged, Decimal text and explicitly source-labelled. Eastmoney volume is lot, Sina/Tencent normalized history volume is share. AKShare 1.19.1 excludes sz000 stocks from its conversion; for these A-share stock inputs the bridge preserves native_volume and explicitly applies lot×100.

`akshare_quote` and the research whitelist are read-only. No accounts or trading API is provided. Network errors remain errors. Upstream floats cannot recover lost precision.

Market-prefixed history requests map 920xxx and legacy 4/8 codes to Beijing (`bj`), 6/other 9 codes to Shanghai, and remaining A-share codes to Shenzhen. The [BSE code announcement](https://www.bse.cn/important_news/200021617.html) establishes the 920 segment. Sina remains limited to its supported Shanghai/Shenzhen codes. Explicit research arguments already require a market prefix and are never re-inferred.

## Application compatibility

Requires the Sesame API1 host targeting 0.2.0 (`>=0.2.0-0` permits its development previews). Stable 0.2.0 has not yet been released. Installation does not initialize dependencies or download them at startup. Inspect and reuse an existing configured environment first; explicitly prepare missing dependencies only when needed.

Quote and daily-bar polling use a 60-second refresh interval; this is neither a 60-second bar nor an exchange tick subscription. Public quote timestamps may be HTTP observation times (marked `observationTimeOnly`), not exchange time. Bind the selected Eastmoney, Sina or Tencent source explicitly; do not silently merge or fail over between sources. Source errors and unknown freshness must remain visible.
