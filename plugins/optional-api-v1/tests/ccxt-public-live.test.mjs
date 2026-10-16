import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { CCXTProvider } from "../packages/ccxt/provider.js";
import { execute } from "../packages/ccxt/worker.js";

test("Actual Coinbase latest tail, continuous refresh and ETH switch reuse one public session", {
  skip: process.env.SESAME_CCXT_LIVE !== "1" || !process.env.SESAME_CCXT_EXISTING_PYTHON,
  timeout: 90000,
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), "sesame-ccxt-public-live-"));
  await writeFile(join(directory, "selection.json"), JSON.stringify({ python: process.env.SESAME_CCXT_EXISTING_PYTHON }));
  const records = new Map(), receipts = [];
  const provider = new CCXTProvider({
    storage: { directory, get: (_name, id) => records.get(id), put: (_name, row) => records.set(row.id, row) },
    environment: {
      executeWorker: async (_file, payload, { signal }) => {
        const start = Date.now();
        const receipt = await execute(payload, { directory, signal });
        receipts.push({ symbol: payload.symbol, sessionId: receipt.sessionId, requestNumber: receipt.requestNumber,
          durationMs: Date.now() - start, lastOpen: receipt.rows.at(-1)?.[0], rows: receipt.rows.length });
        return receipt;
      },
    },
  });
  t.after(async () => { await provider.dispose(); await rm(directory, { recursive: true, force: true }); });
  const context = { bindingId: "live-public" };
  provider.bind({ configuration: { exchange: "coinbase", ...(process.env.SESAME_CCXT_PUBLIC_PROXY ? { publicProxy: process.env.SESAME_CCXT_PUBLIC_PROXY } : {}) } }, context);
  const input = {
    instrument: { sourceId: "ccxt:coinbase:spot", instrumentId: "BTC/USD" },
    spec: { timeframe: "1h", priceBasis: "last", adjustment: "none", session: "all", calendarRevision: { status: "unknown" } },
    tailLimit: 500, includeForming: true,
  };
  const stream = await provider.subscribeBars(input, context);
  assert.equal(stream.snapshot.bars.at(-1).openTime.unixMs, Math.floor(Date.now() / 3600000) * 3600000);
  assert.equal(stream.snapshot.bars.at(-1).isClosed, false);
  const events = [];
  stream.ready(event => events.push(event));
  for (let i = 0; i < 300 && receipts.length < 2 && !events.some(event => event.type === "stream.gap"); i++) await delay(100);
  await stream.close();
  assert.ok(receipts.length >= 2, JSON.stringify(events));
  assert.ok(receipts[1].rows <= 3, "Refresh reads the recent tail, not the history window");
  const switched = await provider.subscribeBars({ ...input, instrument: { ...input.instrument, instrumentId: "ETH/USD" } }, context);
  assert.equal(switched.snapshot.bars.at(-1).openTime.unixMs, Math.floor(Date.now() / 3600000) * 3600000);
  await switched.close();
  assert.equal(new Set(receipts.map(row => row.sessionId)).size, 1);
  assert.deepEqual(receipts.slice(0, 2).map(row => row.requestNumber), [1, 2]);
  assert.equal(receipts.at(-1).symbol, "ETH/USD");
  t.diagnostic(JSON.stringify({ actualPublicSource: "ccxt:coinbase:spot", receipts }));
});
