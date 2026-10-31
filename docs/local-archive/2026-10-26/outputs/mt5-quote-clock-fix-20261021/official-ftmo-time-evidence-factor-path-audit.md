# Official FTMO / MetaQuotes time evidence

Retrieved 2026-10-21. Research only: no account, terminal, application, database, or product-code access. Only FTMO notices and MetaQuotes documentation are evidence below; forum results were excluded.

## Result

FTMO's current MetaTrader platform clock is GMT+3. Its documented 2026 changes follow the US seasonal transition, not the European transition. This supports the server-wall-clock hypothesis for the observed +3h offset. It does not independently establish the timestamp encoding of the current Python symbol_info_tick result or authenticate this particular account/server instance.

## FTMO primary evidence

1. [Trading Update, 15 Oct 2026](https://ftmo.com/en/blog/trading-updates/trading-update-15-oct-2026/)
   - Short quote: “MetaTrader platform time — GMT+3”.
   - Current-period notice applies to MetaTrader and expressly discusses MT4 and MT5. Europe's change on 25 October does not immediately change the platform clock: the Prague/platform midnight difference is two hours during 26 October–1 November. It ties restoration of European instruments' normal MT4/MT5 hours on 2 November to the US DST change on 1 November.
   - Thus 2026-10-21 is within an officially stated GMT+3 platform period. This page does not state the exact 2026 autumn transition instant or enumerate individual server names.

2. [Trading Update, 26 Feb 2026](https://ftmo.com/en/blog/trading-updates/trading-update-26-feb-2026/)
   - Short quote: “Starting 8 Mar 2026 at 10:00 GMT+3 (08:00 CET)”.
   - The notice explicitly connects GMT+2 to GMT+3 with the US change on 8 March. The quoted instant is 2026-03-08T07:00:00Z by arithmetic. The announced maintenance spans 07:00 GMT+2 to 11:00 GMT+3 (05:00Z–08:00Z). European instrument-hour adjustments persist until Europe's 29 March change.
   - Platform-level evidence; not a guarantee of timestamp precision or availability during maintenance.

3. [Trading Update, 2 Nov 2023](https://ftmo.com/en/blog/trading-updates/trading-update-02-nov-2023/)
   - Short quote: “at 9:00 am GMT+3”.
   - Explicit historical transition: on 5 November 2023, 09:00 GMT+3 becomes 08:00 GMT+2, i.e. 06:00Z. The stated cause is the end of North American DST. This establishes that year's exact transition, not a permanent rule for all years or the exact 2026 autumn instant.

4. [Trading Update, 18 Jul 2024](https://ftmo.com/en/blog/trading-updates/trading-update-18-jul-2024/)
   - Short quote: “FTMO-Demo (Free Trial server)”.
   - FTMO specifically identifies this MT5 server name in a notice whose platform clock is GMT+3. This is an official historical association of the exact name, not a fresh verification of the present account's server/feed identity.

## MetaQuotes API boundaries

5. [Python symbol_info_tick](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfotick_py)
   - Short quote: “Get the last tick”.
   - The documentation says the function is similar to native SymbolInfoTick and shows time/time_msc. This page does not explicitly state a UTC/server-wall timezone guarantee for these fields. Its example identifies Python package 5.0.29; it is not a version-specific guarantee for today's installed package.

6. [MqlTick structure](https://www.mql5.com/en/docs/constants/structures/mqltick)
   - Short quote: “Time of a price last update in milliseconds”.
   - time is datetime for the latest price update; time_msc is millisecond price-update time. The page does not explicitly specify timezone, synchronization accuracy, or a maximum-delivery-age guarantee.
   - [Datetime type](https://www.mql5.com/en/docs/basis/types/integer/datetime) defines a count of seconds from 1970-01-01 without a timezone annotation. [Symbol properties](https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants) similarly defines SYMBOL_TIME_MSC as milliseconds since 1970-01-01. An epoch-shaped integer alone therefore does not identify the broker's clock basis.

7. [TimeCurrent](https://www.mql5.com/en/docs/dateandtime/timecurrent)
   - Short quote: “The time value is formed on a trade server”.
   - Native TimeCurrent is the last known server time; in OnTick it corresponds to the handled tick, otherwise the last quote of a Market Watch symbol. It is independent of the computer's time settings.
   - [MetaQuotes book: local and server time](https://www.mql5.com/en/book/common/timing/timing_local_server) says broker time reaches the client with ticks and chart-history axes use server time. This supports the native server-time domain, but is not an explicit Python-wrapper conversion contract.

8. [Python copy_ticks_range](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksrange_py)
   - Short quote: “The data obtained from MetaTrader 5 have UTC time”.
   - This historical-tick API explicitly instructs callers to create UTC datetime request bounds and describes returned data as UTC, warning separately about local-time shifts in presentation.
   - [Python copy_ticks_from](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksfrom_py) makes the same UTC statement and accepts datetime or seconds since 1970. This documented contract must not be silently replaced with an unconditional broker-offset subtraction.

## Deterministic conversion boundary

- If the raw current-quote field is independently established as FTMO server-wall time encoded in epoch-like units, the currently documented +03:00 offset yields utc_ms = raw_time_msc - 10_800_000. Preserve raw time and the authority/offset used. This arithmetic is conditional on field-domain evidence, not on a nearest-hour guess from a single observed age.
- At the documented spring boundary, the offset changes from +02:00 to +03:00 at 2026-03-08T07:00:00Z. Do not shift on Europe's 29 March or 25 October dates.
- The exact 2026 autumn transition instant, a perpetual future-year recurrence, an IANA-zone identifier, and the raw Python current-quote encoding for this exact server/build were not established by the reviewed official pages. The 15 October notice supplies the US change date (1 November), while the 2023 notice supplies an exact instant only for 2023.
- Therefore America/New_York plus seven wall hours is a candidate description consistent with the dated notices, not an explicit permanent FTMO policy found here. Europe/Prague or Europe/Helsinki seasonal rules contradict the documented 2026 mismatch weeks.
- Server display time, Python request bounds, Python returned integer encoding, local rendering, and actual quote freshness must remain distinct. Do not turn the clock-domain hypothesis into proof that a delayed quote is fresh, and do not double-convert API data that already follows the documented UTC contract.

All findings are documentation-based; no live behavior or particular account identity was independently reverified in this task.

## Bounded follow-up: permanent FAQ and 2026 autumn precision

Completed on 2026-10-21 using exactly four targeted FTMO-only search queries: FAQ + MetaTrader server time/DST; trading objectives or symbols + GMT+2/GMT+3/daylight; 22 Oct 2026 + GMT; 29 Oct 2026 + GMT. No additional searches were performed for this follow-up.

- A permanent official FAQ was found: [What are the account specifications?](https://ftmo.com/en/faq/what-are-the-account-specifications/). Its platform-server-time section states: **“MetaTrader 4, MetaTrader 5 = GMT+2 +DST”**. It separately describes cTrader and TradingView as customized according to trader settings. This establishes a permanent platform-level base/seasonal offset statement. It does **not** identify the DST jurisdiction, recurring transition rule, UTC transition instants, an IANA zone, individual server IDs, or Python raw-field encoding.
- The current [Trading Updates index](https://ftmo.com/en/trading-updates/) exposed 15 October 2026 as its latest entry. No retrievable supporting article was obtained for the candidate 22 October or 29 October 2026 update URLs. Direct opens reported that the URLs were not accessible through the tool, not an HTTP 404. Both dates are future relative to the research date; neither is current evidence, and no unpublished content is assumed.
- A further historical example exists: [Trading Update, 30 Oct 2025](https://ftmo.com/en/blog/trading-updates/trading-update-30-oct-2025/). Its detailed US-DST section places the platform change on Sunday 2 November 2025 at 09:00 before the rollback to 08:00. Using its stated +03:00/+02:00 offsets gives 06:00Z for **2025**. Its introductory offset caption uses 3 November trading-day shorthand, so the detailed dated transition paragraph is the relevant historical statement. This does not establish the 2026 instant.

### Handoff recommendation

The FAQ improves the evidence: GMT+2 with a seasonal increment is a standing FTMO statement. The reviewed dated notices identify US-aligned transitions for the cited periods. However, no reviewed standing FAQ/objective/symbol specification establishes a perpetual US recurrence, and no accessible 2026 autumn notice establishes its exact UTC boundary. Therefore do not hard-code a permanent New York plus seven hours mapping or infer 2026-11-01T06:00:00Z from older years.

For a small current-period repair, a versioned rule can be restricted to the exact currently authenticated FTMO-Demo server and the particular live current-quote field whose wall-clock encoding the parent independently verifies. A conservative supported server-date window can be 2026-10-15 through 2026-10-31 inclusive, with a fixed +03:00 conversion. This is a deliberately narrowed implementation support window, not a claim that FTMO's official policy began at midnight on 15 October. Reject 1 November in its entirety, later unverified periods, other servers, and unverified field domains until updated evidence supplies the next rule. Preserve raw timestamps, offset, rule version, source citations, received time, and normal stale/future checks. Do not apply this rule to APIs whose UTC contract has not been independently shown to need conversion.

No source code, account, terminal, application, or database was accessed by this follow-up. The parent's independent host-clock samples indicate a seconds-scale discrepancy rather than three hours; that evidence does not supply a DST transition rule.
