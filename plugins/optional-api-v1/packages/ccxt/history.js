import { check, digest, decimal } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';

export const sourceLimits = { kraken: 500, coinbase: 300, okx: 300 };
export const intervals = {
  "1m": 60000,
  "5m": 300000,
  "15m": 900000,
  "1h": 3600000,
  "1d": 86400000,
};
const unknown = (reason) => ({ status: "unknown", reason }),
  value = (value) => ({ status: "value", value });

export async function queryBars(provider, input, context) {
  const binding = provider.bound(context, input.instrument);
  const duration = intervals[input.spec?.timeframe];
  check(
    duration &&
      input.spec.priceBasis === "last" &&
      input.spec.adjustment === "none" &&
      ["all", "default"].includes(input.spec.session) &&
      input.spec.calendarRevision?.status === "unknown",
    "Only unadjusted UTC public spot candles and no calendar revision",
    "UNSUPPORTED_CAPABILITY",
  );
  const from = input.range?.from,
    to = input.range?.to;
  check(
    from?.basis === "utc" &&
      to?.basis === "utc" &&
      Number.isSafeInteger(from.unixMs) &&
      Number.isSafeInteger(to.unixMs) &&
      from.unixMs < to.unixMs,
    "Explicit ascending UTC bounds required",
    "UNSUPPORTED_CAPABILITY",
  );
  const result = await provider.page(input, context, async () => {
    const seriesId = digest([input.instrument, input.spec]);
    check(
      provider.closedThrough.has(seriesId) || provider.closedThrough.size < 2048,
      "Series budget exceeded",
      "RESOURCE_EXHAUSTED",
    );
    const sourceLimit = sourceLimits[binding.exchange];
    const since =
      input.direction === "backward"
        ? Math.max(from.unixMs, to.unixMs - sourceLimit * duration)
        : from.unixMs;
    const receipt = await provider.call(context, "bars", {
      symbol: input.instrument.instrumentId,
      timeframe: input.spec.timeframe,
      since,
      limit: sourceLimit,
    });
    const rows = receipt.rows
      .map((row) => {
        check(
          Array.isArray(row) &&
            row.length >= 6 &&
            Number.isSafeInteger(row[0]),
          "Malformed exchange OHLCV",
          "SOURCE_DATA_INVALID",
        );
        const prices = Object.fromEntries(
          ["open", "high", "low", "close"].map((key, i) => [
            key,
            decimal(
              typeof row[i + 1] === "number"
                ? String(row[i + 1])
                : row[i + 1],
            ),
          ]),
        );
        check(
          Decimal.compare(prices.high, prices.low) >= 0 &&
            ["open", "close"].every(
              (k) =>
                Decimal.compare(prices[k], prices.low) >= 0 &&
                Decimal.compare(prices[k], prices.high) <= 0,
            ),
          "OHLC inconsistent",
          "SOURCE_DATA_INVALID",
        );
        const volume = decimal(
          typeof row[5] === "number" ? String(row[5]) : row[5],
        );
        check(
          Decimal.compare(volume, "0") >= 0,
          "Negative source volume",
          "SOURCE_DATA_INVALID",
        );
        return {
          id: `${seriesId}:${row[0]}`,
          openTime: { basis: "utc", unixMs: row[0] },
          endTime: { basis: "utc", unixMs: row[0] + duration },
          ...prices,
          volume: {
            default: "real",
            real: value({
              value: volume,
              unit: input.instrument.instrumentId.split("/")[0],
            }),
            tick: { status: "unsupported" },
          },
        };
      })
      .sort((a, b) => a.openTime.unixMs - b.openTime.unixMs);
    check(
      new Set(rows.map((row) => row.id)).size === rows.length,
      "Duplicate source candles",
      "SOURCE_DATA_INVALID",
    );
    let boundary = provider.closedThrough.get(seriesId) ?? null;
    if (rows.length > 1)
      boundary = Math.max(boundary ?? -Infinity, rows.at(-2).openTime.unixMs);
    provider.closedThrough.set(seriesId, boundary);
    const bars = rows
      // A native page can extend past the requested range. It may prove a
      // candle closed, but must not rewrite revisions outside this read.
      .filter((row) => row.openTime.unixMs >= from.unixMs && row.openTime.unixMs < to.unixMs)
      .map((row) =>
        provider.revise({
          ...row,
          isClosed: boundary !== null && row.openTime.unixMs <= boundary,
          closure:
            boundary !== null && row.openTime.unixMs <= boundary
              ? "source"
              : "unknown",
          turnover: unknown("No quote-volume currency receipt"),
        }),
      )
      .filter((bar) => input.includeForming !== false || bar.isClosed);
    return {
      items: bars,
      meta: provider.meta(receipt),
      extra: {
        seriesId,
        coverage: {
          requested: input.range,
          observedRange: bars.length
            ? { from: bars[0].openTime, to: bars.at(-1).endTime }
            : null,
          complete: false,
          gaps: [{ range: input.range, reason: "not_loaded" }],
        },
      },
    };
  });
  return {
    data: {
      seriesId: result.extra.seriesId,
      instrument: input.instrument,
      spec: input.spec,
      page: result.data,
      coverage: result.extra.coverage,
    },
    meta: result.meta,
  };
}
