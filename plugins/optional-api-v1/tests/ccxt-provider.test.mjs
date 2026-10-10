import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { CCXTProvider, displayDecimals } from "../packages/ccxt/provider.js";
const instrument = { sourceId: "ccxt:kraken:spot", instrumentId: "BTC/USD" },
  spec = {
    timeframe: "1m",
    priceBasis: "last",
    adjustment: "none",
    session: "all",
    calendarRevision: { status: "unknown" },
  },
  range = {
    from: { basis: "utc", unixMs: 0 },
    to: { basis: "utc", unixMs: 180000 },
  };
function fixture() {
  let rows = [
    [0, "10", "11", "9", "10", "1"],
    [60000, "10", "12", "9", "11", "2"],
    [120000, "11", "12", "10", "11.5", "3"],
  ];
  const records = new Map();
  const provider = new CCXTProvider({
      storage: {
        get: (_name, id) => records.get(id),
        put: (_name, row) => records.set(row.id, structuredClone(row)),
      },
      environment: {
        executeWorker: async () => ({
          library: "4.5.85",
          exchange: "kraken",
          observedAt: Date.now(),
          rows,
        }),
      },
    }),
    context = { bindingId: "a" };
  provider.bind({ configuration: { exchange: "kraken" } }, context);
  return { provider, context, set: (value) => (rows = value) };
}
test("Backward immutable cursor uses most recent candles then older ascending page", async () => {
  const f = fixture(),
    input = {
      instrument,
      spec,
      range,
      direction: "backward",
      includeForming: true,
      page: { limit: 2 },
    },
    first = await f.provider.queryBars(input, f.context);
  assert.deepEqual(
    first.data.page.items.map((x) => x.openTime.unixMs),
    [60000, 120000],
  );
  f.set([]);
  const second = await f.provider.queryBars(
    { ...input, page: { limit: 2, cursor: first.data.page.nextCursor } },
    f.context,
  );
  assert.deepEqual(
    second.data.page.items.map((x) => x.openTime.unixMs),
    [0],
  );
  await assert.rejects(
    f.provider.queryBars(
      {
        ...input,
        range: { ...range, to: { basis: "utc", unixMs: 190000 } },
        page: { limit: 2, cursor: first.data.page.nextCursor },
      },
      f.context,
    ),
    { code: "INVALID_CURSOR" },
  );
});
test("Receipt clock never closes latest candle; source successor survives narrow history and exact UTC boundary", async () => {
  const f = fixture(),
    input = {
      instrument,
      spec,
      range,
      direction: "forward",
      includeForming: false,
      page: { limit: 10 },
    },
    first = await f.provider.queryBars(input, f.context);
  assert.deepEqual(
    first.data.page.items.map((b) => b.openTime.unixMs),
    [0, 60000],
  );
  f.set([[60000, "10", "12", "9", "11.1", "2"]]);
  const narrow = await f.provider.queryBars(
    {
      ...input,
      range: {
        from: { basis: "utc", unixMs: 60001 },
        to: { basis: "utc", unixMs: 120000 },
      },
    },
    f.context,
  );
  assert.equal(narrow.data.page.items.length, 0);
  const known = await f.provider.queryBars(input, f.context);
  assert.equal(known.data.page.items[0].closure, "source");
  assert.ok(
    BigInt(known.data.page.items[0].revision) >
      BigInt(first.data.page.items[1].revision),
  );
});
test("Source malformed OHLC/negative volume and cross-exchange binding reject", async () => {
  const f = fixture(),
    input = { instrument, spec, range, page: { limit: 10 } };
  f.set([[0, "10", "9", "8", "10", "1"]]);
  await assert.rejects(f.provider.queryBars(input, f.context), {
    code: "SOURCE_DATA_INVALID",
  });
  f.set([[0, "10", "11", "9", "10", "-1"]]);
  await assert.rejects(f.provider.queryBars(input, f.context), {
    code: "SOURCE_DATA_INVALID",
  });
  await assert.rejects(
    f.provider.queryBars(
      { ...input, instrument: { ...instrument, sourceId: "ccxt:okx:spot" } },
      f.context,
    ),
    { code: "INSTRUMENT_MISMATCH" },
  );
  await f.provider.unbind(f.context);
  assert.equal(f.provider.pages.size, 0);
});

test("Display decimals use exact source precision, never a blanket eight", () => {
  assert.equal(
    displayDecimals({
      precisionMode: 4,
      precision: { price: "0.000000000001" },
    }),
    12,
  );
  assert.equal(
    displayDecimals({ precisionMode: 4, precision: { price: "0.1" } }),
    1,
  );
  assert.equal(
    displayDecimals({ precisionMode: 2, precision: { price: 10 } }),
    10,
  );
  assert.throws(
    () => displayDecimals({ precisionMode: 3, precision: { price: 8 } }),
    { code: "UNSUPPORTED_CAPABILITY" },
  );
  assert.throws(
    () =>
      displayDecimals({
        precisionMode: 4,
        precision: { price: "0.0000000000000000000001" },
      }),
    { code: "UNSUPPORTED_CAPABILITY" },
  );
});

function cappedPublicExchange(now, exchange = "coinbase", availableFrom = -Infinity) {
  const requests = [], records = new Map();
  const provider = new CCXTProvider({
    storage: {
      get: (_name, id) => records.get(id),
      put: (_name, row) => records.set(row.id, structuredClone(row)),
    },
    environment: {
      executeWorker: async (_path, payload) => {
        requests.push(payload);
        const duration = 3600000, cap = exchange === "kraken" ? 500 : 300;
        const rows = Array.from({ length: Math.min(payload.limit ?? 500, cap) }, (_, i) => [
          Math.max(Math.ceil(payload.since / duration) * duration, availableFrom) + i * duration,
          "10", "12", "9", "11", "2",
        ]).filter(row => row[0] <= Math.floor(now() / duration) * duration);
        return { library: "4.5.85", exchange, observedAt: now(), rows };
      },
    },
  });
  const context = { bindingId: exchange };
  provider.bind({ configuration: { exchange } }, context);
  return { provider, context, requests };
}

test("Backward Coinbase window honors its native 300 candle cap and reaches the forming candle", async () => {
  const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
  const f = cappedPublicExchange(() => now);
  const result = await f.provider.queryBars({
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" },
    range: { from: { basis: "utc", unixMs: now - 500 * duration }, to: { basis: "utc", unixMs: now } },
    direction: "backward", includeForming: true, page: { limit: 500 },
  }, f.context);
  assert.equal(f.requests[0].limit, 300);
  assert.equal(result.data.page.items.at(-1).openTime.unixMs, Math.floor(now / duration) * duration);
  assert.equal(result.data.page.items.at(-1).isClosed, false);
  assert.equal(result.data.page.items.at(-2).closure, "source");
  assert.equal(result.data.coverage.complete, false);
  await f.provider.unbind(f.context);
});

test("Live initial tail reaches now and one-second refresh queries only the recent window", async t => {
  const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const f = cappedPublicExchange(() => Date.now());
  const handle = await f.provider.subscribeBars({
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" }, includeForming: true, tailLimit: 500,
  }, f.context);
  const currentOpen = Math.floor(now / duration) * duration;
  assert.equal(handle.snapshot.bars.length, 500);
  assert.equal(handle.snapshot.bars.at(-1).openTime.unixMs, currentOpen);
  assert.equal(f.requests.length, 2, "Only the initial snapshot backfills its native-capped tail");
  handle.ready(() => {});
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].since, currentOpen - 2 * duration);
  await handle.close();
  t.mock.timers.tick(10000);
  await setImmediate();
  assert.equal(f.requests.length, 3, "Closing a chart stops only its polling");
  await f.provider.unbind(f.context);
});

test("A completed-bar tail includes a real source successor even for tailLimit one", async t => {
  const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
  t.mock.timers.enable({ apis: ["Date"], now });
  const f = cappedPublicExchange(() => Date.now());
  const stream = await f.provider.subscribeBars({
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" }, includeForming: false, tailLimit: 1,
  }, f.context);
  assert.equal(stream.snapshot.bars.length, 1);
  assert.equal(stream.snapshot.bars[0].openTime.unixMs, Math.floor(now / duration) * duration - duration);
  assert.equal(stream.snapshot.bars[0].closure, "source");
  await stream.close();
});

for (const exchange of ["kraken", "coinbase", "okx"]) {
  const cap = exchange === "kraken" ? 500 : 300;
  for (const tailLimit of new Set([cap, 500])) {
    for (const includeForming of [false, true]) {
      test(`${exchange} supplies ${tailLimit} ${includeForming ? "forming-inclusive" : "completed"} initial candles within two native reads`, async t => {
        const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
        t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
        const f = cappedPublicExchange(() => Date.now(), exchange);
        t.after(() => f.provider.dispose());
        const stream = await f.provider.subscribeBars({
          instrument: { sourceId: `ccxt:${exchange}:spot`, instrumentId: "BTC/USD" },
          spec: { ...spec, timeframe: "1h" }, includeForming, tailLimit,
        }, f.context);
        const currentOpen = Math.floor(now / duration) * duration,
          first = currentOpen - (tailLimit - Number(includeForming)) * duration,
          bars = stream.snapshot.bars,
          initialReads = tailLimit + Number(!includeForming) > cap ? 2 : 1;
        assert.equal(bars.length, tailLimit);
        assert.equal(new Set(bars.map(bar => bar.id)).size, tailLimit);
        assert.deepEqual(bars.map(bar => bar.openTime.unixMs),
          Array.from({ length: tailLimit }, (_, index) => first + index * duration));
        for (const bar of bars) {
          assert.equal(bar.isClosed, bar.openTime.unixMs < currentOpen);
          assert.equal(bar.closure, bar.isClosed ? "source" : "unknown");
        }
        assert.equal(f.requests.length, initialReads);
        assert.ok(f.requests.every(request => request.limit <= cap));
        assert.deepEqual(stream.snapshot.coverage.requested, {
          from: { basis: "utc", unixMs: first },
          to: { basis: "utc", unixMs: currentOpen + duration },
        });
        assert.deepEqual(stream.snapshot.coverage.observedRange, {
          from: bars[0].openTime, to: bars.at(-1).endTime,
        });
        assert.equal(stream.snapshot.coverage.complete, false);
        assert.equal(stream.snapshot.meta.freshness, "unknown");
        const events = [];
        stream.ready(event => events.push(event));
        t.mock.timers.tick(1000);
        await setImmediate();
        assert.equal(f.requests.length, initialReads + 1, "Live refresh never repeats the initial backfill");
        assert.equal(f.requests.at(-1).since, currentOpen - (includeForming ? 2 : 3) * duration);
        assert.deepEqual(events, [], "Backfilling does not rewrite and replay the newest observation");
      });
    }
  }
}

test("Initial backfill only prepends older rows and preserves the latest window and revisions", async t => {
  const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
  t.mock.timers.enable({ apis: ["Date"], now });
  const f = cappedPublicExchange(() => Date.now(), "kraken");
  t.after(() => f.provider.dispose());
  const execute = f.provider.host.environment.executeWorker;
  f.provider.host.environment.executeWorker = async (...args) => {
    const receipt = await execute(...args);
    return f.requests.length === 2 ? {
      ...receipt, observedAt: now + 1,
      // Native pages may extend past the older read's requested upper bound.
      rows: receipt.rows.map(row => [...row.slice(0, 4), "11.5", row[5]]),
    } : receipt;
  };
  const query = f.provider.queryBars.bind(f.provider);
  let initial, revisions, boundary;
  f.provider.queryBars = async (...args) => {
    const result = await query(...args);
    if (!initial) {
      initial = structuredClone(result);
      revisions = structuredClone(f.provider.revisions);
      boundary = f.provider.closedThrough.get(result.data.seriesId);
    }
    return result;
  };
  const stream = await f.provider.subscribeBars({
    instrument,
    spec: { ...spec, timeframe: "1h" }, includeForming: false, tailLimit: 500,
  }, f.context);
  assert.equal(f.requests.length, 2);
  assert.equal(initial.data.page.items.length, 499);
  assert.equal(stream.snapshot.bars.length, 500);
  assert.deepEqual(stream.snapshot.bars.slice(1), initial.data.page.items);
  assert.equal(stream.snapshot.bars[0].openTime.unixMs, Math.floor(now / duration) * duration - 500 * duration);
  assert.equal(stream.snapshot.bars[0].close, "11.5");
  assert.equal(stream.snapshot.bars[0].closure, "source");
  assert.equal(stream.snapshot.seriesId, initial.data.seriesId);
  assert.deepEqual(stream.snapshot.meta, initial.meta);
  assert.equal(f.provider.closedThrough.get(stream.snapshot.seriesId), boundary);
  for (const [id, revision] of revisions)
    assert.deepEqual(f.provider.revisions.get(id), revision, "Older reads cannot revise overlapping newer candles");
});

for (const available of [0, 3, 400]) {
  for (const includeForming of [false, true]) {
    test(`A ${available}-candle source remains honestly incomplete with includeForming=${includeForming}`, async t => {
      const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000,
        currentOpen = Math.floor(now / duration) * duration;
      t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
      const f = cappedPublicExchange(() => Date.now(), "coinbase", currentOpen - (available - 1) * duration);
      t.after(() => f.provider.dispose());
      const stream = await f.provider.subscribeBars({
        instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
        spec: { ...spec, timeframe: "1h" }, includeForming, tailLimit: 500,
      }, f.context);
      const expected = Math.max(0, available - Number(!includeForming)),
        bars = stream.snapshot.bars;
      assert.equal(bars.length, expected);
      assert.equal(new Set(bars.map(bar => bar.id)).size, expected);
      assert.deepEqual(bars.map(bar => bar.openTime.unixMs),
        Array.from({ length: expected }, (_, index) => currentOpen - (available - 1 - index) * duration));
      assert.equal(stream.snapshot.coverage.complete, false);
      assert.ok(stream.snapshot.coverage.gaps.length > 0);
      assert.deepEqual(stream.snapshot.coverage.observedRange, expected
        ? { from: bars[0].openTime, to: bars.at(-1).endTime }
        : null);
      assert.equal(f.requests.length, 2, "Missing source history does not trigger unbounded backfill");
      stream.ready(() => {});
      t.mock.timers.tick(1000);
      await setImmediate();
      assert.equal(f.requests.length, 3, "Polling resumes with only one recent-window read");
    });
  }
}

test("A transient read reports a recoverable gap and the same binding can immediately resnapshot", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.UTC(2026, 9, 10, 8, 23) });
  const f = cappedPublicExchange(() => Date.now()), input = {
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" }, includeForming: true, tailLimit: 500,
  };
  const first = await f.provider.subscribeBars(input, f.context), events = [];
  const original = f.provider.host.environment.executeWorker;
  f.provider.host.environment.executeWorker = async () => { throw Object.assign(Error("temporary network failure"), { code: "SOURCE_UNAVAILABLE" }); };
  first.ready(event => events.push(event));
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(events[0].type, "stream.gap");
  assert.equal(events[0].payload.recovery, "snapshot");
  assert.equal(events[0].payload.reason.code, "SOURCE_UNAVAILABLE");
  await first.close();
  f.provider.host.environment.executeWorker = original;
  const recovered = await f.provider.subscribeBars(input, f.context);
  assert.equal(recovered.snapshot.instrument.sourceId, first.snapshot.instrument.sourceId);
  assert.equal(recovered.snapshot.bars.at(-1).openTime.unixMs, first.snapshot.bars.at(-1).openTime.unixMs);
  await recovered.close();
});

test("A suspended process requires a fresh snapshot instead of silently skipping elapsed candles", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.UTC(2026, 9, 10, 8, 23) });
  const f = cappedPublicExchange(() => Date.now());
  const handle = await f.provider.subscribeBars({
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" }, includeForming: true, tailLimit: 500,
  }, f.context), events = [];
  handle.ready(event => events.push(event));
  t.mock.timers.tick(5 * 3600000);
  await setImmediate();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "stream.gap");
  assert.equal(events[0].payload.reason.code, "GAP_DETECTED");
  await handle.close();
});

for (const elapsed of [1000, 5 * 3600000]) {
  test(`Empty public windows preserve the last observation when recovering after ${elapsed}ms`, async t => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.UTC(2026, 9, 10, 8, 23) });
    const f = cappedPublicExchange(() => Date.now()), input = {
      instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
      spec: { ...spec, timeframe: "1h" }, includeForming: true, tailLimit: 20,
    };
    t.after(() => f.provider.dispose());
    const handle = await f.provider.subscribeBars(input, f.context), events = [];
    const snapshot = structuredClone(handle.snapshot);
    const original = f.provider.host.environment.executeWorker;
    let empty = true;
    f.provider.host.environment.executeWorker = async (...args) => {
      const receipt = await original(...args);
      return {
        ...receipt,
        rows: empty ? [] : receipt.rows.map((row, index, rows) => index === rows.length - 1 ? [...row.slice(0, 4), "11.5", row[5]] : row),
      };
    };
    handle.ready(event => events.push(event));
    for (let i = 0; i < 2; i++) {
      t.mock.timers.tick(1000);
      await setImmediate();
      assert.deepEqual(events, [], "An empty source window must not invent updates or removals");
      assert.deepEqual(handle.snapshot, snapshot, "The initial observation remains immutable");
    }
    empty = false;
    t.mock.timers.tick(elapsed);
    await setImmediate();
    assert.equal(events.length, 1);
    if (elapsed === 1000) {
      assert.equal(events[0].type, "bars.upsert");
      assert.equal(events[0].payload.bars.length, 1, "Unchanged candles are not replayed after an empty window");
      assert.equal(events[0].payload.bars[0].id, snapshot.bars.at(-1).id);
      assert.equal(events[0].payload.bars[0].close, "11.5");
    } else {
      assert.equal(events[0].type, "stream.gap");
      assert.equal(events[0].payload.reason.code, "GAP_DETECTED");
      assert.equal(events[0].payload.recovery, "snapshot");
      t.mock.timers.tick(10000);
      await setImmediate();
      assert.equal(events.length, 1, "A gap stops deltas until the host requests a fresh snapshot");
      const recovered = await f.provider.subscribeBars(input, f.context);
      assert.equal(recovered.snapshot.bars.at(-1).openTime.unixMs, Math.floor(Date.now() / 3600000) * 3600000);
    }
  });
}
