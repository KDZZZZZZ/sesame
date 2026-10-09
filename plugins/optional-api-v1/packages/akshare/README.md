# AKShare optional market provider

Load `sesame/akshare`. It never downloads on activation. Discover/reuse a compatible native Python first; explicitly prepare private dependencies only when missing.

Select and persist one exact connection: `akshare:eastmoney`, `akshare:sina`, or `akshare:tencent`, revision `1.19.1`. Sources are never silently mixed or switched. Tencent currently provides actual A-share catalog/last-price observations via `stock_zh_a_spot_tx` and daily history via `stock_zh_a_hist_tx`; Eastmoney provides bid/ask snapshots; Sina provides daily history.

`quotes.subscribe` polls the chosen Eastmoney/Tencent snapshot every 60 seconds, without overlapping reads. Quote time is the actual HTTP observation time; exchange event time is unavailable, freshness unknown, and bid/ask are unknown when absent. This is not an exchange tick feed. Tencent reads one all-market snapshot per poll (at most five selected instruments).

`bars.subscribe` polls actual daily history every 60 seconds and returns the selected daily tail. Today’s upstream row is forming until 15:00 Asia/Shanghai. No minute bars are created from quote snapshots, no calendar completeness is claimed. A gap terminates the stream with the actual error and requires a new snapshot.

History is paged, Decimal text and explicitly source-labelled. Eastmoney volume is lot, Sina/Tencent normalized history volume is share. AKShare 1.19.1 excludes sz000 stocks from its conversion; for these A-share stock inputs the bridge preserves native_volume and explicitly applies lot×100.

`akshare_quote` and the research whitelist are read-only. No accounts or trading API is provided. Network errors remain errors. Upstream floats cannot recover lost precision.

Market-prefixed history requests map 920xxx and legacy 4/8 codes to Beijing (`bj`), 6/other 9 codes to Shanghai, and remaining A-share codes to Shenzhen. The [BSE code announcement](https://www.bse.cn/important_news/200021617.html) establishes the 920 segment. Sina remains limited to its supported Shanghai/Shenzhen codes. Explicit research arguments already require a market prefix and are never re-inferred.
