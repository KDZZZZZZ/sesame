import { randomUUID } from "node:crypto";
import { check, canonical, digest, decimal } from "@sesame/plugin-sdk/protocol";
import { Decimal } from "@sesame/plugin-sdk/decimal";
const intervals = {
  "1m": 60000,
  "5m": 300000,
  "15m": 900000,
  "1h": 3600000,
  "1d": 86400000,
};
const unknown = (reason) => ({ status: "unknown", reason }),
  value = (value) => ({ status: "value", value });
export function displayDecimals(row) {
  const precision = row.precision?.price;
  let digits;
  if (row.precisionMode === 2 && Number.isInteger(precision)) {
    digits = precision;
  } else if (row.precisionMode === 4) {
    const tick = decimal(
      typeof precision === "number" ? String(precision) : precision,
    );
    check(
      Decimal.compare(tick, "0") > 0,
      "Invalid source precision",
      "SOURCE_DATA_INVALID",
    );
    digits = (tick.split(".")[1] ?? "").length;
  } else {
    check(
      false,
      "Market has no reliable fixed display precision; significant-digit modes are unsupported",
      "UNSUPPORTED_CAPABILITY",
    );
  }
  check(
    digits >= 0 && digits <= 20,
    "Display precision exceeds supported 20 decimal places",
    "UNSUPPORTED_CAPABILITY",
  );
  return digits;
}
export const descriptor = {
  id: "market",
  contract: "sesame.market",
  versions: ["1.0.0"],
  capabilities: [
    "instruments.search",
    "instruments.describe",
    "bars.history",
    "bars.subscribe",
  ],
  limits: {
    transportMode: "poll",
    minPollIntervalMs: 60000,
    maxPageSize: 500,
    timeframes: Object.keys(intervals),
    priceBases: ["last"],
    adjustments: ["none"],
  },
};
export class CCXTProvider {
  constructor(host) {
    this.host = host;
    this.bindings = new Map();
    this.pages = new Map();
    this.revisions = new Map();
    this.closedThrough = new Map();
    this.streams = new Set();
    this.sequence = 0n;
  }
  bind(input, context) {
    const supplied = input.configuration !== undefined;
    let configuration;
    if (supplied) {
      configuration = input.configuration;
      check(
        configuration &&
          typeof configuration === "object" &&
          !Array.isArray(configuration) &&
          Object.keys(configuration).every((key) =>
            ["exchange", "publicProxy"].includes(key),
          ),
        "configuration accepts only exchange and publicProxy; unknown fields never fall back to direct",
        "INVALID_ARGUMENT",
      );
      check(
        ["kraken", "coinbase", "okx"].includes(configuration.exchange),
        "Select an explicit supported public exchange",
        "INVALID_ARGUMENT",
      );
      if (Object.hasOwn(configuration, "publicProxy")) {
        check(
          typeof configuration.publicProxy === "string" &&
            configuration.publicProxy.length > 0,
          "publicProxy must be a nonempty credential-free HTTP(S) URL",
          "INVALID_ARGUMENT",
        );
        let parsed;
        try {
          parsed = new URL(configuration.publicProxy);
        } catch {
          check(false, "Invalid explicit publicProxy URL", "INVALID_ARGUMENT");
        }
        check(
          ["http:", "https:"].includes(parsed.protocol) &&
            !parsed.username &&
            !parsed.password &&
            !parsed.search &&
            !parsed.hash &&
            parsed.pathname === "/",
          "publicProxy must be HTTP(S) without credentials, query, fragment or proxy path",
          "INVALID_ARGUMENT",
        );
      }
    } else {
      check(
        input.connection &&
          typeof input.connection.id === "string" &&
          typeof input.connection.revision === "string",
        "Provide explicit configuration first or an exact previously saved connection",
        "PREREQUISITE_REQUIRED",
      );
      const saved = this.host.storage.get(
        "public_connections",
        digest(input.connection),
        true,
      );
      check(
        saved && canonical(saved.connection) === canonical(input.connection),
        "Exact public connection configuration is unavailable; explicitly bind the authorized route",
        "CONNECTION_CHANGED",
      );
      configuration = saved.configuration;
      // Stored data is plugin-private but still validated before any request.
      return this.bind(
        { configuration, connection: input.connection },
        context,
      );
    }
    const exchange = configuration.exchange,
      proxy = configuration.publicProxy ?? null;
    const connection = {
      id: `ccxt:${exchange}`,
      revision: proxy
        ? digest({ library: "4.5.85", publicProxy: proxy })
        : "4.5.85",
    };
    check(
      !input.connection ||
        canonical(input.connection) === canonical(connection),
      "Exact connection does not identify this authorized public route",
      "CONNECTION_CHANGED",
    );
    const id = digest(connection),
      saved = this.host.storage.get("public_connections", id, true);
    const frozen = { exchange, ...(proxy ? { publicProxy: proxy } : {}) };
    check(
      !saved || canonical(saved.configuration) === canonical(frozen),
      "Stored public route identity conflicts",
      "CONNECTION_CHANGED",
    );
    if (!saved)
      this.host.storage.put("public_connections", {
        id,
        connection,
        configuration: frozen,
      });
    this.bindings.set(context.bindingId, {
      exchange,
      proxy,
      connection,
      sourceId: `ccxt:${exchange}:spot`,
    });
    return {
      connection,
      sourceId: `ccxt:${exchange}:spot`,
      health: "configured",
      limitations: [
        "Public network read and compatible dependency must succeed before data is available.",
        "Exact public route persists in private plugin storage; connection-only bindings never guess or switch it.",
      ],
    };
  }
  bound(context, ref) {
    const binding = this.bindings.get(context.bindingId);
    check(binding, "Binding is closed", "CONNECTION_CHANGED");
    if (ref)
      check(
        ref.sourceId === binding.sourceId &&
          typeof ref.instrumentId === "string",
        "Instrument belongs to another explicit exchange",
        "INSTRUMENT_MISMATCH",
      );
    return binding;
  }
  async call(context, action, args = {}) {
    const binding = this.bound(context);
    const result = await this.host.environment.executeWorker(
      "worker.js",
      {
        exchange: binding.exchange,
        publicProxy: binding.proxy,
        action,
        ...args,
      },
      { signal: context.signal, timeoutMs: 60000 },
    );
    this.bound(context);
    check(
      result.library === "4.5.85" &&
        result.exchange === binding.exchange &&
        Number.isSafeInteger(result.observedAt),
      "Invalid public source receipt",
      "SOURCE_DATA_INVALID",
    );
    return result;
  }
  meta(result) {
    return {
      observedAt: result.observedAt,
      freshness: "unknown",
      origin: "observed",
      consistency: "best_effort",
      warnings: [
        {
          code: "PUBLIC_OHLCV",
          message:
            "Exchange public OHLCV is delayed/partial. CCXT floats become decimal text; lost upstream precision cannot be recovered.",
        },
      ],
      source: {
        library: "ccxt",
        version: result.library,
        exchange: result.exchange,
      },
    };
  }
  summary(binding, row) {
    return {
      ref: { sourceId: binding.sourceId, instrumentId: row.symbol },
      symbol: row.symbol,
      name: row.symbol,
      assetClass: "crypto",
      venue: value(binding.exchange),
    };
  }
  async page(input, context, load) {
    const limit = input.page?.limit;
    check(
      Number.isInteger(limit) && limit >= 1 && limit <= 500,
      "page.limit must be 1..500",
    );
    check(
      input.direction === undefined ||
        ["forward", "backward"].includes(input.direction),
      "Invalid direction",
    );
    const filters = { ...input };
    delete filters.page;
    const key = digest([context.bindingId, filters]);
    for (const [id, p] of this.pages)
      if (p.expires < Date.now()) this.pages.delete(id);
    let p,
      offset = 0;
    if (input.page.cursor) {
      p = this.pages.get(input.page.cursor);
      check(
        p && p.key === key,
        "Cursor expired or filter identity changed",
        "INVALID_CURSOR",
      );
      offset = p.offset;
    } else {
      const loaded = await load();
      check(
        loaded.items.length <= 10000 &&
          Buffer.byteLength(JSON.stringify(loaded)) <= 8 * 1024 * 1024,
        "Snapshot budget exceeded",
        "RESOURCE_EXHAUSTED",
      );
      p = {
        ...loaded,
        key,
        bindingId: context.bindingId,
        expires: Date.now() + 60000,
        id: randomUUID(),
      };
    }
    const end = Math.min(offset + limit, p.items.length),
      items =
        input.direction === "backward"
          ? p.items.slice(
              Math.max(0, p.items.length - end),
              p.items.length - offset,
            )
          : p.items.slice(offset, end);
    let nextCursor = null;
    if (end < p.items.length) {
      while (this.pages.size >= 32)
        this.pages.delete(this.pages.keys().next().value);
      nextCursor = randomUUID();
      this.pages.set(nextCursor, { ...p, offset: end });
    }
    return {
      data: {
        items: structuredClone(items),
        snapshotId: p.id,
        consistency: "snapshot",
        nextCursor,
      },
      meta: p.meta,
      ...(p.extra ? { extra: p.extra } : {}),
    };
  }
  async searchInstruments(input, context) {
    const binding = this.bound(context);
    return this.page(input, context, async () => {
      const result = await this.call(context, "markets");
      return {
        items: result.rows
          .map((row) => this.summary(binding, row))
          .filter(
            (item) =>
              item.symbol.toLowerCase().includes(input.query.toLowerCase()) &&
              (!input.assetClasses || input.assetClasses.includes("crypto")) &&
              (!input.venues || input.venues.includes(binding.exchange)),
          ),
        meta: this.meta(result),
      };
    });
  }
  async describeInstrument(input, context) {
    const binding = this.bound(context, input.instrument),
      result = await this.call(context, "markets"),
      row = result.rows.find(
        (row) => row.symbol === input.instrument.instrumentId,
      );
    check(row, "Unknown public spot market", "NOT_FOUND");
    return {
      data: {
        ...this.summary(binding, row),
        currency: value(row.quote),
        price: {
          tickSize: unknown(
            "CCXT precision mode is not a fixed tick guarantee",
          ),
          displayDecimals: displayDecimals(row),
        },
        quantity: {
          unit: row.base,
          min: unknown("No executable broker quantity guarantee"),
          max: unknown("No executable broker quantity guarantee"),
          step: unknown("No fixed lot step verified"),
          contractMultiplier: unknown("No derivative contract"),
        },
        volume: { realUnit: value(row.base), hasReal: true, hasTick: false },
        timeBasis: { kind: "utc" },
        calendar: unknown("No fixed exchange calendar"),
        features: {
          timeframes: Object.keys(intervals),
          priceBases: ["last"],
          adjustments: ["none"],
        },
        native: { symbol: row.id, market: binding.exchange },
      },
      meta: this.meta(result),
    };
  }
  revise(bar) {
    const hash = digest(bar),
      old = this.revisions.get(bar.id),
      revision = old?.hash === hash ? old.revision : String(++this.sequence);
    while (this.revisions.size >= 50000 && !this.revisions.has(bar.id))
      this.revisions.delete(this.revisions.keys().next().value);
    this.revisions.set(bar.id, { hash, revision });
    return { ...bar, revision };
  }
  async queryBars(input, context) {
    this.bound(context, input.instrument);
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
    const result = await this.page(input, context, async () => {
      const seriesId = digest([input.instrument, input.spec]);
      check(
        this.closedThrough.has(seriesId) || this.closedThrough.size < 2048,
        "Series budget exceeded",
        "RESOURCE_EXHAUSTED",
      );
      const since =
        input.direction === "backward"
          ? Math.max(from.unixMs, to.unixMs - 500 * duration)
          : from.unixMs;
      const receipt = await this.call(context, "bars", {
        symbol: input.instrument.instrumentId,
        timeframe: input.spec.timeframe,
        since,
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
      let boundary = this.closedThrough.get(seriesId) ?? null;
      if (rows.length > 1)
        boundary = Math.max(boundary ?? -Infinity, rows.at(-2).openTime.unixMs);
      this.closedThrough.set(seriesId, boundary);
      const bars = rows
        .map((row) =>
          this.revise({
            ...row,
            isClosed: boundary !== null && row.openTime.unixMs <= boundary,
            closure:
              boundary !== null && row.openTime.unixMs <= boundary
                ? "source"
                : "unknown",
            turnover: unknown("No quote-volume currency receipt"),
          }),
        )
        .filter(
          (bar) =>
            bar.openTime.unixMs >= from.unixMs &&
            bar.openTime.unixMs < to.unixMs &&
            (input.includeForming !== false || bar.isClosed),
        );
      return {
        items: bars,
        meta: this.meta(receipt),
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
  async subscribeBars(input, context) {
    const controller = new AbortController(),
      signal = AbortSignal.any([
        controller.signal,
        ...(context.signal ? [context.signal] : []),
      ]);
    check(
      !input.resumeToken,
      "Requires new snapshot",
      "UNSUPPORTED_CAPABILITY",
    );
    check(
      Number.isInteger(input.tailLimit) &&
        input.tailLimit > 0 &&
        input.tailLimit <= 500,
      "tailLimit must be 1..500",
    );
    const read = async () => {
      const now = Date.now(),
        result = await this.queryBars(
          {
            ...input,
            direction: "backward",
            range: {
              from: {
                basis: "utc",
                unixMs:
                  now - (input.tailLimit + 3) * intervals[input.spec.timeframe],
              },
              to: {
                basis: "utc",
                unixMs: now + intervals[input.spec.timeframe],
              },
            },
            page: { limit: 500 },
          },
          { ...context, signal },
        );
      return {
        seriesId: result.data.seriesId,
        instrument: input.instrument,
        spec: input.spec,
        bars: result.data.page.items.slice(-input.tailLimit),
        coverage: result.data.coverage,
        meta: result.meta,
      };
    };
    const snapshot = await read(),
      position = { streamId: randomUUID(), epoch: randomUUID(), seq: "0" };
    let timer,
      task,
      prior = snapshot,
      seq = 0n,
      started = false;
    const handle = {
      bindingId: context.bindingId,
      snapshot,
      position,
      consistency: "bounded",
      recovery: "snapshot",
      ready: (emit) => {
        if (started || signal.aborted) return;
        started = true;
        const tick = () => {
          task = (async () => {
            try {
              const next = await read();
              if (signal.aborted) return;
              const old = new Map(
                  prior.bars.map((bar) => [bar.id, bar.revision]),
                ),
                bars = next.bars.filter(
                  (bar) => old.get(bar.id) !== bar.revision,
                );
              if (bars.length)
                emit({
                  ...position,
                  seq: String(++seq),
                  eventId: randomUUID(),
                  schemaVersion: "1.0.0",
                  type: "bars.upsert",
                  payload: { seriesId: next.seriesId, bars },
                  observedAt: Date.now(),
                });
              prior = next;
            } catch (error) {
              if (!signal.aborted)
                emit({
                  ...position,
                  seq: String(++seq),
                  eventId: randomUUID(),
                  schemaVersion: "1.0.0",
                  type: "stream.gap",
                  payload: {
                    reason: {
                      code: error.code ?? "SOURCE_UNAVAILABLE",
                      message: error.message,
                    },
                    recovery: "snapshot",
                  },
                  observedAt: Date.now(),
                });
              controller.abort();
            } finally {
              if (!signal.aborted) {
                timer = setTimeout(tick, 60000);
                timer.unref?.();
              }
            }
          })();
        };
        timer = setTimeout(tick, 60000);
        timer.unref?.();
      },
      close: async () => {
        controller.abort();
        clearTimeout(timer);
        await task;
        signal.removeEventListener("abort", abort);
        this.streams.delete(handle);
      },
    };
    const abort = () => clearTimeout(timer);
    signal.addEventListener("abort", abort, { once: true });
    this.streams.add(handle);
    return handle;
  }
  async unbind({ bindingId }) {
    this.bindings.delete(bindingId);
    await Promise.allSettled(
      [...this.streams]
        .filter((stream) => stream.bindingId === bindingId)
        .map((stream) => stream.close()),
    );
    for (const [id, p] of this.pages)
      if (p.bindingId === bindingId) this.pages.delete(id);
  }
  async dispose() {
    await Promise.allSettled([...this.streams].map((stream) => stream.close()));
    this.bindings.clear();
    this.pages.clear();
    this.revisions.clear();
    this.closedThrough.clear();
  }
}
