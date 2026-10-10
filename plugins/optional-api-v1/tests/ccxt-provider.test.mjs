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

function cappedCoinbase(now) {
  const requests = [], records = new Map();
  const provider = new CCXTProvider({
    storage: {
      get: (_name, id) => records.get(id),
      put: (_name, row) => records.set(row.id, structuredClone(row)),
    },
    environment: {
      executeWorker: async (_path, payload) => {
        requests.push(payload);
        const duration = 3600000;
        const rows = Array.from({ length: Math.min(payload.limit ?? 500, 300) }, (_, i) => [
          Math.ceil(payload.since / duration) * duration + i * duration,
          "10", "12", "9", "11", "2",
        ]).filter(row => row[0] <= Math.floor(now() / duration) * duration);
        return { library: "4.5.85", exchange: "coinbase", observedAt: now(), rows };
      },
    },
  });
  const context = { bindingId: "coinbase" };
  provider.bind({ configuration: { exchange: "coinbase" } }, context);
  return { provider, context, requests };
}

test("Backward Coinbase window honors its native 300 candle cap and reaches the forming candle", async () => {
  const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
  const f = cappedCoinbase(() => now);
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
  const f = cappedCoinbase(() => Date.now());
  const handle = await f.provider.subscribeBars({
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" }, includeForming: true, tailLimit: 500,
  }, f.context);
  const currentOpen = Math.floor(now / duration) * duration;
  assert.equal(handle.snapshot.bars.at(-1).openTime.unixMs, currentOpen);
  handle.ready(() => {});
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].since, currentOpen - 2 * duration);
  await handle.close();
  t.mock.timers.tick(10000);
  await setImmediate();
  assert.equal(f.requests.length, 2, "Closing a chart stops only its polling");
  await f.provider.unbind(f.context);
});

test("A completed-bar tail includes a real source successor even for tailLimit one", async t => {
  const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
  t.mock.timers.enable({ apis: ["Date"], now });
  const f = cappedCoinbase(() => Date.now());
  const stream = await f.provider.subscribeBars({
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" }, includeForming: false, tailLimit: 1,
  }, f.context);
  assert.equal(stream.snapshot.bars.length, 1);
  assert.equal(stream.snapshot.bars[0].openTime.unixMs, Math.floor(now / duration) * duration - duration);
  assert.equal(stream.snapshot.bars[0].closure, "source");
  await stream.close();
});

test("A transient read reports a recoverable gap and the same binding can immediately resnapshot", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.UTC(2026, 9, 10, 8, 23) });
  const f = cappedCoinbase(() => Date.now()), input = {
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
  const f = cappedCoinbase(() => Date.now());
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
    const f = cappedCoinbase(() => Date.now()), input = {
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
