# Nasdaq 3-month historical comparison: pre-specified method

## Design record before calculating forward returns

- Request/reference date: 2026-10-18. Latest common official FRED daily close available from the six requested CSVs: **2026-10-15**. No 2026-10-16 value will be invented or appended from another vendor to the history.
- Initial design, before any forward-return analysis: month-end Nasdaq-100 candidates since 2003; six equally weighted standardized features (21-session return, 63-session return, distance from the trailing 252-session highest close, 63-session change in 10-year real Treasury yield, high-yield option-adjusted spread, VIX).
- Data availability change recorded 2026-10-18 12:49 UTC, **before computing analogue outcomes**: FRED now supplies only three years of ICE BofA high-yield spread data. The FRED series notes explicitly say this restriction began in April 2026. The official CSV begins 2023-10-17, while the other required histories are sufficiently long.
- Revised main screen: the same design with **HY spread removed**, giving five features. HY remains current risk context, and unavailable older HY values stay null. This change is due to availability, not sample performance.
- Fixed sensitivity: remove VIX from the revised main design (four features). The original six-feature design is also computed on its available three-year history as an explicitly short-sample auxiliary comparison. Neither is a new probability model.
- Official source note: https://fred.stlouisfed.org/series/BAMLH0A0HYM2 . One ordinary public DBnomics mirror request returned HTTP 404 and supplied no data; no other historical data source is substituted.

## Fixed selection and calculation rules

1. Read the saved original CSVs. Preserve source URL, retrieval time and SHA-256 in sources.json.
2. Nasdaq-100 nonmissing closes define trading-session positions. Do not create OHLC bars or assume price-index returns include dividends.
3. Align real yield, VIX and HY spread to each index session using only an observation on or before that date; a macro observation older than seven calendar days is missing. No backward fill. This is observation-date alignment, not a reconstruction of the actual publication-time information set.
4. Main candidates are each calendar month's final observed Nasdaq-100 trading close from 2003 onward, require all five features, and require 63 subsequent observed Nasdaq-100 sessions no later than 2026-10-15. The current incomplete October is not a historical candidate.
5. Momentum is close/close 21 or 63 sessions earlier minus one. High distance is close divided by maximum close over the latest 252 sessions (including candidate) minus one. Real-yield change is the aligned yield minus its value 63 Nasdaq sessions earlier, converted from percentage points into basis points.
6. Standardize each feature with mean and population standard deviation (ddof=0) of the eligible candidate set. Compute unweighted Euclidean distance to the latest observation. This is a descriptive similarity score, not a learned forecast.
7. Sort ascending by distance, break ties by date, and greedily retain five closest candidates whose start dates are at least 126 Nasdaq trading sessions apart from every already selected candidate. If fewer than five exist, report the available count, never relax the rule.
8. Record the full original feature vector for every selected date. Calculate 21- and 63-session price return, 63-session path maximum drawdown including the start point, and the minimum return relative to the start during that window.
9. Also compute all eligible overlapping month-end outcomes as an unconditional descriptive baseline. Report count, mean, median, quartiles, 10th/90th percentiles, and fraction positive, without treating overlapping observations as independent trials.
10. Pre-specified structural cases are the final trading close of 2000-03, 2007-10, 2018-09, 2021-11, 2023-07 and 2023-10. They are a deliberately selected stress/recovery comparison, **not** a random or nearest-neighbour sample. Use the same forward 63-session arithmetic. The 2000 case does not enter the multi-feature screen.
11. Normalized path charts start at 100 on relative_session 0 and run through 63, using flat rows containing case, date, relative_session and normalized_level. Preceding 63 sessions are separately supplied for longitudinal visual comparison, without changing the selection.
12. Current trend statistics use the latest available actual close; SMA50/200, 21/63/252-session returns, distance to the trailing 252-session high, and annualized close-to-close log-return volatility. A separate 2026-10-06 reference-close change is shown; the script checks whether that date is actually the high rather than assuming it.

## Interpretation limits

- This is not a point-in-time backtest: current downloaded FRED histories may have revisions; publication lags and historical access are not reconstructed.
- Standardization uses the entire eligible historical candidate set, so this descriptive current-date comparison must not be presented as a historically tradable model.
- Five nearby episodes are too few for robust probability estimates. Forward paths can differ despite similar price, rates and volatility.
- Greedy date separation reduces repeated episodes but does not eliminate regime dependence or guarantee independence. The unconditional month-end baseline contains overlapping 63-session windows.
- Returns are Nasdaq-100 price-index returns, before fees, taxes and dividends. Nasdaq Composite is a separate reference series, not interchangeable with Nasdaq-100.
- Daily closing observations cannot establish intraday drawdowns, actual entry/exit execution, ATR, or a stop-loss guarantee.
- 63 trading sessions approximates three calendar months. Future scenario discussion should distinguish the user's calendar horizon (2026-10-18 to 2027-01-18) from the historical 63-session window.

## Generated output

The compute script appends a results/coverage section after this design record, without revising the fixed rules above. summary.json and chart-data.json are machine-readable derived results, and candidates.csv retains every eligible main-screen candidate for auditing.

## Computed results and coverage

Generated: 2026-10-18T12:51:11.140473+00:00. All arithmetic comes from compute_history.py and saved official CSV bytes.

Main eligible month-end candidates: 279, 2003-04-30 through 2026-06-30. Selected: 2004-06-30, 2011-01-31, 2013-05-31, 2023-08-31, 2005-11-30.

No-VIX sensitivity selected: 2004-06-30, 2011-01-31, 2005-11-30, 2015-07-31, 2023-08-31.

Short-history six-feature candidates: 33; separated selection count: 4. This is a limited auxiliary comparison only.

Coverage:

| Series | First observation | Latest observation | Nonmissing observations |
|---|---|---|---:|
| NASDAQ100 | 1986-01-02 | 2026-10-15 | 10278 |
| NASDAQCOM | 1986-01-02 | 2026-10-15 | 10277 |
| DGS10 | 1986-01-02 | 2026-10-15 | 10203 |
| DFII10 | 2003-01-02 | 2026-10-15 | 5951 |
| VIXCLS | 1990-01-02 | 2026-10-15 | 9296 |
| BAMLH0A0HYM2 | 2023-10-17 | 2026-10-15 | 786 |
