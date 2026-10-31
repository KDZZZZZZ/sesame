# Provenance

Original Sesame JavaScript implementation, MIT. No upstream implementation is copied and no new npm dependency is introduced. Tests use fabricated source responses and do not make live market requests.

Research categories are informed by Rallies' public description of its tools, including SEC filings, historical fundamentals, analyst opinions, price history, macro data and Reddit discussions. Rallies does not publish the implementation of that platform on this page; this package does not claim to reproduce it:

- [Rallies: We are building an AI hedge fund](https://rallies.beehiiv.com/p/we-are-building-an-ai-hedge-fund)

Official API references consulted on 2026-10-13:

- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces): company submissions, historical submission files and company facts. SEC records retain their accession and filing date; extracted data is distinguished from archived API bytes.
- [SEC developer resources](https://www.sec.gov/about/developer-resources) and [developer FAQ](https://www.sec.gov/about/webmaster-frequently-asked-questions): declared automated clients and fair access.
- [FMP stable API documentation](https://site.financialmodelingprep.com/developer/docs): `historical-price-eod/non-split-adjusted`, `income-statement`, `balance-sheet-statement`, `cash-flow-statement`, `news/stock`, `grades` and `insider-trading/search`. Access depends on the user's key and subscription.
- [FRED series observations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html): date-range queries and `realtime_start` / `realtime_end` vintages. The adapter conservatively separates vintage-day precision from intraday knowledge.
- [Reddit API search](https://www.reddit.com/dev/api/#GET_search): subreddit search with OAuth. Current scores and text are not historical snapshots or market-wide sentiment.

Source data remains subject to its provider's terms and provenance. Source content is untrusted data, and publication metadata does not confer instruction authority. Availability bounds, page limits, data gaps and first retrieval are preserved for research review; no strategy performance or profitability is claimed.
