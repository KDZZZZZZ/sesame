# QMT 1.1.0 candidate validation

This candidate targets the Sesame API1 0.2.0 host (development previews permitted by `>=0.2.0-0`), remains discoverable, and adds no startup dependency download or terminal launch.

Executed on macOS using the actual SDK loader:

- `qmt.test.mjs`: 17 passing contract tests. New coverage includes exact half-open daily range filtering, frozen cursor/binding identity, source-based forming OHLC and closure (native successor/explicit closed flag only), polling correction and unbind cleanup; explicit normalized-order/fill rejection and raw current-day preservation; strict shares/side/price/account/revision/main-scope authorization; durable unknown intents and no replay; activation versus current-tool scope separation.
- `qmt_bridge_test.py`: 9 passing fixed-adapter tests, using controlled fake XtData/XtTrader. These verify actual native call signatures, local daily history versus explicit download, decimal/ID preservation, supported stock type checks, fixed limit order constants and cancel account/remark validation, and owned API-session cleanup.
- `qmt-host.test.mjs`: 1 passing opt-in actual temporary Runtime/HostContext/SQLite test. Candidate bytes pass manager test/install, six tools and both providers register, a transport-unknown intent persists across complete Runtime/Store close/reopen and is not resent. No native QMT process was invoked. Temporary storage is removed.
- The actual macOS prerequisite path rejects QMT binding before any SDK spawn. Installation/inspect created no dependency files and started no terminal.
- Native Windows quote test is skipped without `QMT_NATIVE_TESTS=1`. No Windows lifecycle, authorized broker connection, real historical data, real order submission/cancellation or fills were exercised. Fixture success is not native QMT verification.

Daily data deliberately supports only `1d`, `last`, `none`, regular/default mainland-stock session. Minute timestamp labeling and native volume units are not established for this terminal, so minute bars are unsupported and volume is unknown with original source value retained. Local history is incomplete/unknown coverage; explicit download is separate. Forming daily OHLC comes from native full-tick fields/source timestamp, never a fabricated minute bar. This is polling, not exchange event delivery.

Normalized orders/fills are not declared and reject UNSUPPORTED_CAPABILITY because native time units cannot satisfy mandatory SourceTime. Raw orders/fills are the native current trading day only. `None` remains ambiguous failure, unverified times remain unknown, and broker-return price_type is not interpreted as the input FIX_PRICE enum. Accepted order/cancel request is not a trade/cancel completion guarantee. Broker rules govern permissions, lot sizes, T+1 available shares, price limits and session checks. Durable unknown intent retries return stored uncertainty; they never automatically send another native command.

Official API references: [XtData](https://dict.thinktrader.net/nativeApi/xtdata.html), [XtTrader](https://dict.thinktrader.net/nativeApi/xttrader.html). No credentials, broker files, environments, application source or native binaries are included.

Independent-review corrections: backward paging selects newest rows while every page remains ascending; published Asia/Shanghai wall authority is accepted consistently; Bar has closure/turnover/default none and BarPage/subscription carries instrument/spec and partial Coverage. Native 51/52 status labels are cancel_pending. Unverified raw order/fill time is never packaged as a fabricated SourceTime.

Additional stale-source regression verifies old-day full-tick cannot replace a completed historical row, including after a narrower range hides its successor; UTC millisecond half-open bounds remain exact.
