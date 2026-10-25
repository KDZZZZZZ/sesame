import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { closeRecords } from "../packages/ccxt/records.js";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { CCXTProvider, descriptor, displayDecimals } from "../packages/ccxt/provider.js";
import { createCapabilities } from "../packages/ccxt/index.js";
import { POLL_INTERVAL } from "../packages/ccxt/stream.js";
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
// Unit tests replace only the provider's native read boundary. Connection
// persistence, binding, pagination, precision and streaming remain production code.
function providerFixture(t, read) {
  const directory = mkdtempSync(join(tmpdir(), 'ccxt-provider-'));
  const host = { context: { storageRoot: directory } }, provider = new CCXTProvider(host), f = { provider, read };
  provider.call = (context, action, args = {}) => {
    const binding = provider.bound(context);
    return f.read({ exchange: binding.exchange, publicProxy: binding.proxy, action, ...args });
  };
  t.after(async () => { await provider.dispose(); closeRecords(host); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true }); });
  return f;
}
function fixture(t) {
  let rows = [
    [0, "10", "11", "9", "10", "1"],
    [60000, "10", "12", "9", "11", "2"],
    [120000, "11", "12", "10", "11.5", "3"],
  ];
  const f = providerFixture(t, async () => ({ library: "4.5.85", exchange: "kraken", observedAt: Date.now(), rows }));
  const { provider } = f, context = { bindingId: "a" };
  provider.bind({ configuration: { exchange: "kraken" } }, context);
  return { ...f, context, set: (value) => (rows = value) };
}
test("Backward immutable cursor uses most recent candles then older ascending page", async t => {
  const f = fixture(t),
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
test("Receipt clock never closes latest candle; source successor survives narrow history and exact UTC boundary", async t => {
  const f = fixture(t),
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
test("Source malformed OHLC/negative volume and cross-exchange binding reject", async t => {
  const f = fixture(t),
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

test("Exact public routes survive private database reopening without guessing a route or accepting aliases", async t => {
  const f = providerFixture(t, () => { throw new Error("Binding never dispatches a public request"); });
  const configuration = { exchange: "kraken", publicProxy: "http://127.0.0.1:7897" };
  const selected = f.provider.bind({ configuration }, { bindingId: "selected" });
  const direct = f.provider.bind({ configuration: { exchange: "kraken" } }, { bindingId: "direct" });
  assert.notEqual(selected.connection.revision, direct.connection.revision);
  await f.provider.dispose();
  closeRecords(f.provider.host);
  const reopened = new CCXTProvider(f.provider.host);
  t.after(() => reopened.dispose());
  assert.deepEqual(reopened.bind({ connection: selected.connection }, { bindingId: "restored" }), selected);
  assert.equal(reopened.bound({ bindingId: "restored" }).proxy, configuration.publicProxy);
  assert.equal(reopened.bind({ connection: direct.connection }, { bindingId: "restored-direct" }).connection.revision, direct.connection.revision);
  for (const input of [
    { configuration: { exchange: "kraken", proxy: configuration.publicProxy } },
    { configuration: { exchange: "kraken", publicProxy: "http://name:password@localhost:7897" } },
    { configuration: { exchange: "kraken", publicProxy: null } },
  ]) assert.throws(() => reopened.bind(input, { bindingId: "bad" }), { code: "INVALID_ARGUMENT" });
  assert.throws(() => reopened.bind({ connection: selected.connection, configuration: { exchange: "kraken" } }, { bindingId: "mismatch" }), { code: "CONNECTION_CHANGED" });
  assert.throws(() => reopened.bind({ connection: { ...selected.connection, revision: "unknown" } }, { bindingId: "missing" }), { code: "CONNECTION_CHANGED" });
  assert.equal(reopened.bindings.size, 2);
});

function cappedPublicExchange(t, now, exchange = "coinbase", availableFrom = -Infinity) {
  const requests = [];
  const f = providerFixture(t, async payload => {
    requests.push(payload);
    const duration = 3600000, cap = exchange === "kraken" ? 500 : 300;
    const rows = Array.from({ length: Math.min(payload.limit ?? 500, cap) }, (_, i) => [
      Math.max(Math.ceil(payload.since / duration) * duration, availableFrom) + i * duration,
      "10", "12", "9", "11", "2",
    ]).filter(row => row[0] <= Math.floor(now() / duration) * duration);
    return { library: "4.5.85", exchange, observedAt: now(), rows };
  });
  const { provider } = f;
  const context = { bindingId: exchange };
  provider.bind({ configuration: { exchange } }, context);
  return Object.assign(f, { context, requests });
}

test("Backward Coinbase window honors its native 300 candle cap and reaches the forming candle", async t => {
  const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
  const f = cappedPublicExchange(t, () => now);
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

test("Catalog and descriptor expose the same one-second public REST cadence", t => {
  const f = providerFixture(t, () => assert.fail("Catalog does not request public data"));
  const catalog = createCapabilities(f.provider.host).find(item => item.name === "ccxt_catalog").execute({});
  assert.equal(POLL_INTERVAL, 1000);
  assert.equal(catalog.pollIntervalMs, POLL_INTERVAL);
  assert.equal(descriptor.limits.minPollIntervalMs, POLL_INTERVAL);
  assert.equal(descriptor.limits.transportMode, "poll");
});

test("Live initial tail is immediate and the one-second refresh queries only the recent window", async t => {
  const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const f = cappedPublicExchange(t, () => Date.now());
  const handle = await f.provider.subscribeBars({
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" }, includeForming: true, tailLimit: 500,
  }, f.context);
  const currentOpen = Math.floor(now / duration) * duration;
  assert.equal(handle.snapshot.bars.length, 500);
  assert.equal(handle.snapshot.bars.at(-1).openTime.unixMs, currentOpen);
  assert.equal(f.requests.length, 2, "Only the initial snapshot backfills its native-capped tail");
  handle.ready(() => {});
  t.mock.timers.tick(999);
  await setImmediate();
  assert.equal(f.requests.length, 2, "No normal refresh starts before one second");
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].since, currentOpen - 2 * duration);
  await handle.close();
  t.mock.timers.tick(POLL_INTERVAL * 2);
  await setImmediate();
  assert.equal(f.requests.length, 3, "Closing a chart stops only its polling");
  await f.provider.unbind(f.context);
});

test("An in-flight public read never overlaps and the next poll waits from its completion", async t => {
  const now = Date.UTC(2026, 9, 10, 8, 23);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const f = cappedPublicExchange(t, () => Date.now());
  const handle = await f.provider.subscribeBars({
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" }, includeForming: true, tailLimit: 20,
  }, f.context);
  const read = f.read;
  let release, calls = 0, active = 0, maxActive = 0;
  const pending = new Promise(resolve => { release = resolve; });
  f.read = async payload => {
    calls++; maxActive = Math.max(maxActive, ++active);
    try { if (calls === 1) await pending; return await read(payload); }
    finally { active--; }
  };
  try {
    handle.ready(() => {});
    t.mock.timers.tick(POLL_INTERVAL); await setImmediate();
    assert.equal(calls, 1); assert.equal(active, 1);
    t.mock.timers.tick(POLL_INTERVAL * 3); await setImmediate();
    assert.equal(calls, 1, "Elapsed timer periods cannot overlap a pending request");
    release(); await setImmediate();
    assert.equal(active, 0);
    t.mock.timers.tick(POLL_INTERVAL - 1); await setImmediate();
    assert.equal(calls, 1, "The next interval starts after the previous read completes");
    t.mock.timers.tick(1); await setImmediate();
    assert.equal(calls, 2); assert.equal(maxActive, 1);
  } finally { release(); await handle.close(); }
});

test("Unbind releases only its frozen pages and polling; dispose clears the single provider state", async t => {
  const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const f = cappedPublicExchange(t, () => Date.now()), other = { bindingId: "second-chart" };
  f.provider.bind({ configuration: { exchange: "coinbase" } }, other);
  const input = {
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" }, includeForming: true, tailLimit: 20,
  };
  const first = await f.provider.subscribeBars(input, f.context), second = await f.provider.subscribeBars(input, other);
  const query = { ...input, range: { from: { basis: "utc", unixMs: now - 3 * duration }, to: { basis: "utc", unixMs: now } }, page: { limit: 1 } };
  const firstPage = await f.provider.queryBars(query, f.context), secondPage = await f.provider.queryBars(query, other);
  const events = [];
  first.ready(event => events.push(event)); second.ready(event => events.push(event));
  assert.equal(f.provider.streams.size, 2); assert.equal(f.provider.pages.size, 2);
  await f.provider.unbind(f.context);
  assert.equal(f.provider.pages.has(firstPage.data.page.nextCursor), false);
  assert.equal(f.provider.pages.has(secondPage.data.page.nextCursor), true);
  assert.equal(f.provider.streams.size, 1);
  const before = f.requests.length;
  t.mock.timers.tick(POLL_INTERVAL); await setImmediate();
  assert.equal(f.requests.length, before + 1, "The other chart continues its existing poll");
  assert.throws(() => f.provider.bound(f.context), { code: "CONNECTION_CHANGED" });
  await f.provider.dispose();
  for (const field of ["bindings", "pages", "revisions", "closedThrough", "streams"]) assert.equal(f.provider[field].size, 0, field);
  const stopped = f.requests.length, emitted = events.length;
  t.mock.timers.tick(POLL_INTERVAL * 2); await setImmediate();
  assert.equal(f.requests.length, stopped); assert.equal(events.length, emitted);
  assert.throws(() => f.provider.bound(other), { code: "CONNECTION_CHANGED" });
  await Promise.all([first.close(), second.close()]);
});

test("A completed-bar tail includes a real source successor even for tailLimit one", async t => {
  const now = Date.UTC(2026, 9, 10, 8, 23), duration = 3600000;
  t.mock.timers.enable({ apis: ["Date"], now });
  const f = cappedPublicExchange(t, () => Date.now());
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
        const f = cappedPublicExchange(t, () => Date.now(), exchange);
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
        t.mock.timers.tick(POLL_INTERVAL);
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
  const f = cappedPublicExchange(t, () => Date.now(), "kraken");
  t.after(() => f.provider.dispose());
  const execute = f.read;
  f.read = async (...args) => {
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
      const f = cappedPublicExchange(t, () => Date.now(), "coinbase", currentOpen - (available - 1) * duration);
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
      t.mock.timers.tick(POLL_INTERVAL);
      await setImmediate();
      assert.equal(f.requests.length, 3, "Polling resumes with only one recent-window read");
    });
  }
}

test("A transient read reports a recoverable gap and the same binding can immediately resnapshot", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.UTC(2026, 9, 10, 8, 23) });
  const f = cappedPublicExchange(t, () => Date.now()), input = {
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { ...spec, timeframe: "1h" }, includeForming: true, tailLimit: 500,
  };
  const first = await f.provider.subscribeBars(input, f.context), events = [];
  const original = f.read;
  f.read = async () => { throw Object.assign(Error("temporary network failure"), { code: "SOURCE_UNAVAILABLE" }); };
  first.ready(event => events.push(event));
  t.mock.timers.tick(POLL_INTERVAL);
  await setImmediate();
  assert.equal(events[0].type, "stream.gap");
  assert.equal(events[0].payload.recovery, "snapshot");
  assert.equal(events[0].payload.reason.code, "SOURCE_UNAVAILABLE");
  await first.close();
  f.read = original;
  const recovered = await f.provider.subscribeBars(input, f.context);
  assert.equal(recovered.snapshot.instrument.sourceId, first.snapshot.instrument.sourceId);
  assert.equal(recovered.snapshot.bars.at(-1).openTime.unixMs, first.snapshot.bars.at(-1).openTime.unixMs);
  await recovered.close();
});

test("A suspended process requires a fresh snapshot instead of silently skipping elapsed candles", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.UTC(2026, 9, 10, 8, 23) });
  const f = cappedPublicExchange(t, () => Date.now());
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

for (const elapsed of [POLL_INTERVAL, 5 * 3600000]) {
  test(`Empty public windows preserve the last observation when recovering after ${elapsed}ms`, async t => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.UTC(2026, 9, 10, 8, 23) });
    const f = cappedPublicExchange(t, () => Date.now()), input = {
      instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
      spec: { ...spec, timeframe: "1h" }, includeForming: true, tailLimit: 20,
    };
    t.after(() => f.provider.dispose());
    const handle = await f.provider.subscribeBars(input, f.context), events = [];
    const snapshot = structuredClone(handle.snapshot);
    const original = f.read;
    let empty = true;
    f.read = async (...args) => {
      const receipt = await original(...args);
      return {
        ...receipt,
        rows: empty ? [] : receipt.rows.map((row, index, rows) => index === rows.length - 1 ? [...row.slice(0, 4), "11.5", row[5]] : row),
      };
    };
    handle.ready(event => events.push(event));
    for (let i = 0; i < 2; i++) {
      t.mock.timers.tick(POLL_INTERVAL);
      await setImmediate();
      assert.deepEqual(events, [], "An empty source window must not invent updates or removals");
      assert.deepEqual(handle.snapshot, snapshot, "The initial observation remains immutable");
    }
    empty = false;
    t.mock.timers.tick(elapsed);
    await setImmediate();
    assert.equal(events.length, 1);
    if (elapsed === POLL_INTERVAL) {
      assert.equal(events[0].type, "bars.upsert");
      assert.equal(events[0].payload.bars.length, 1, "Unchanged candles are not replayed after an empty window");
      assert.equal(events[0].payload.bars[0].id, snapshot.bars.at(-1).id);
      assert.equal(events[0].payload.bars[0].close, "11.5");
    } else {
      assert.equal(events[0].type, "stream.gap");
      assert.equal(events[0].payload.reason.code, "GAP_DETECTED");
      assert.equal(events[0].payload.recovery, "snapshot");
      t.mock.timers.tick(POLL_INTERVAL * 2);
      await setImmediate();
      assert.equal(events.length, 1, "A gap stops deltas until the host requests a fresh snapshot");
      const recovered = await f.provider.subscribeBars(input, f.context);
      assert.equal(recovered.snapshot.bars.at(-1).openTime.unixMs, Math.floor(Date.now() / 3600000) * 3600000);
    }
  });
}
