import test from "node:test";
import assert from "node:assert/strict";
import { CCXTProvider } from "../packages/ccxt/provider.js";
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
  const provider = new CCXTProvider({
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
