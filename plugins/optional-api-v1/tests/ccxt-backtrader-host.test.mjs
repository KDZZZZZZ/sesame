import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  writeFile,
  readFile,
  rm,
  mkdir,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = process.env.SESAME_HOST_ROOT;
const packages = fileURLToPath(new URL("../packages/", import.meta.url));
const python = process.env.SESAME_QUANT_PYTHON;
async function host(t, name) {
  const { Store } = await import(
      pathToFileURL(join(root, "modules/agent/store.js"))
    ),
    { Runtime } = await import(
      pathToFileURL(join(root, "modules/agent/runtime.js"))
    );
  const directory = await mkdtemp(
      join(tmpdir(), "sesame-" + name + "-integration-"),
    ),
    store = new Store(join(directory, "app"));
  const runtime = await new Runtime(store, {
    piDir: join(directory, "pi"),
    officialPluginsDirectory: join(directory, "empty"),
  }).init();
  t.after(async () => {
    await runtime.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const draft = join(runtime.workspaces.root("conv_main"), "draft");
  await cp(join(packages, name), draft, { recursive: true });
  const tested = await runtime.plugins.manager.test("conv_main", {
    path: draft,
  });
  assert.equal(tested.passed, true, JSON.stringify(tested));
  const installed = await runtime.plugins.manager.install("conv_main", {
    path: draft,
    digest: tested.digest,
  });
  assert.equal(installed.runtime_status, "ready");
  runtime.plugins.activate("conv_main", installed.id);
  const tools = runtime.plugins.definitions({ conversationId: "conv_main" });
  return {
    runtime,
    store,
    directory,
    installed,
    call: async (name, args) =>
      (
        await tools
          .find((tool) => tool.name === name)
          .execute("quant-test", args)
      ).details,
  };
}
test(
  "CCXT formal install/load has no downloads; fixed public provider validates generic contracts",
  { skip: !root },
  async (t) => {
    const f = await host(t, "ccxt");
    assert.equal(f.installed.state, "discoverable");
    assert.deepEqual(
      await readdir(join(f.store.directory, "plugins/data/sesame/ccxt")),
      [],
    );
    assert.equal(f.runtime.providers.list("sesame.market").length, 1);
    assert.equal((await f.call("ccxt_catalog", {})).orders, false);
    const entry = f.runtime.providers.entries.values().next().value;
    entry.implementation.call = async (_context, action) => ({
      library: "4.5.85",
      exchange: "kraken",
      observedAt: Date.now(),
      rows:
        action === "markets"
          ? [{ symbol: "BTC/USD", id: "XXBTZUSD", base: "BTC", quote: "USD" }]
          : [
              [1000, "10", "11", "9", "10.5", "1"],
              [61000, "10.5", "12", "10", "11", "2"],
            ],
    });
    const bound = await f.runtime.providers.bind(
      { pluginId: "sesame/ccxt", providerId: "market" },
      { configuration: { exchange: "kraken" } },
    );
    const instrument = {
        sourceId: "ccxt:kraken:spot",
        instrumentId: "BTC/USD",
      },
      spec = {
        timeframe: "1m",
        priceBasis: "last",
        adjustment: "none",
        session: "all",
        calendarRevision: { status: "unknown" },
      };
    const found = await f.runtime.providers.call(
      bound.bindingId,
      "searchInstruments",
      { query: "BTC", page: { limit: 10 } },
    );
    assert.equal(found.data.items[0].assetClass, "crypto");
    const detail = await f.runtime.providers.call(
      bound.bindingId,
      "describeInstrument",
      { instrument },
    );
    assert.equal(detail.data.currency.value, "USD");
    const bars = await f.runtime.providers.call(bound.bindingId, "queryBars", {
      instrument,
      spec,
      range: {
        from: { basis: "utc", unixMs: 1000 },
        to: { basis: "utc", unixMs: 120000 },
      },
      direction: "backward",
      includeForming: true,
      page: { limit: 1 },
    });
    assert.equal(bars.data.page.items[0].openTime.unixMs, 61000);
    assert.equal(bars.data.page.items[0].isClosed, false);
    assert.equal(bars.data.instrument.instrumentId, "BTC/USD");
    await f.runtime.providers.unbind(bound.bindingId);
    assert.equal(f.runtime.providers.bindings.size, 0);
  },
);
test(
  "Backtrader formal install, explicit private prepare or existing reuse, actual native Cerebro and fixed artifacts",
  { skip: !root || !python, timeout: 180000 },
  async (t) => {
    const f = await host(t, "backtrader");
    const env = await f.call("backtrader_environment", {
      action: "prepare",
      python_path: python,
    });
    assert.equal(env.ready, true);
    assert.equal(env.library, "1.9.78.123");
    // Fresh existing dependency discovery must select it without installing anything.
    const selection = join(
      f.store.directory,
      "plugins/data/sesame/backtrader/selection.json",
    );
    await rm(selection);
    const inspected = await f.call("backtrader_environment", {
      action: "inspect",
      python_path: env.python,
    });
    assert.equal(inspected.ready, true);
    assert.equal(JSON.parse(await readFile(selection)).python, env.python);
    const data = f.runtime.contractArtifacts,
      producer = {
        id: "fixture/market",
        version: "1.0.0",
        digest: "sha256:" + "e".repeat(64),
      };
    const rows = Array.from({ length: 6 }, (_, i) => ({
      datetime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      open: String(100 + i),
      high: String(102 + i),
      low: String(99 + i),
      close: String(101 + i),
      volume: "100",
    }));
    const ref = data.publish(producer, {
      operationId: "fixed-demo-input",
      manifest: {
        kind: "data",
        schemaVersion: "1.0.0",
        content: {
          format: "json-rows",
          path: "rows.json",
          rowCount: rows.length,
          columns: Object.keys(rows[0]),
          provenance: { kind: "demo" },
        },
        dependencies: [],
        blobs: [
          {
            path: "rows.json",
            mediaType: "application/json",
            ...data.blob(JSON.stringify(rows)),
          },
        ],
      },
    });
    const strategy = join(
      f.runtime.workspaces.root("conv_main"),
      "strategy.py",
    );
    await writeFile(
      strategy,
      "import backtrader as bt\nclass RoundTrip(bt.Strategy):\n def next(self):\n  if len(self)==1:self.buy(size=1)\n  elif len(self)==3:self.close()\n",
    );
    const args = {
      operation_id: "actual-engine-demo",
      title: "Fictional six-bar native engine test",
      data: ref,
      strategy_path: strategy,
      class_name: "RoundTrip",
      config: { capital: "10000", commission: "0.001", slippage: "0" },
    };
    const result = await f.call("backtrader_backtest", args);
    assert.equal(
      result.status,
      "completed",
      JSON.stringify(result.diagnostics),
    );
    assert.equal(result.statistics.closedTrades, 1);
    assert.equal(
      data.read(result.ref).manifest.content.provenance.kind,
      "demo",
    );
    const trades = data.data(
      result.data.find((table) => table.id === "trades").ref,
    ).rows;
    assert.equal(trades[0].pnl, "2.0");
    assert.equal(trades[0].pnlAfterCommission, "1.796");
    const equity = data.data(
      result.data.find((table) => table.id === "equity").ref,
    ).rows;
    assert.equal(equity.length, rows.length);
    const orders = data.data(
      result.data.find((table) => table.id === "orders").ref,
    ).rows;
    assert.ok(
      orders.every(
        (order) => "notificationBarTime" in order && "executedTime" in order,
      ),
    );
    const before = f.store.list("execution").length;
    assert.deepEqual(await f.call("backtrader_backtest", args), result);
    assert.equal(
      f.store.list("execution").length,
      before,
      "operation result reuse launches no engine",
    );
    await assert.rejects(
      f.call("backtrader_backtest", {
        ...args,
        config: { ...args.config, capital: "20000" },
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    await writeFile(
      strategy,
      `import backtrader as bt
import json
from pathlib import Path
class Warmup(bt.Strategy):
 def __init__(self):
  self.sma=bt.ind.SMA(self.data.close,period=3)
  self.hooks=[]
 def prenext(self):self.hooks.append(["prenext",len(self)])
 def nextstart(self):self.hooks.append(["nextstart",len(self)])
 def next(self):self.hooks.append(["next",len(self)])
 def stop(self):Path("hooks.json").write_text(json.dumps(self.hooks))
`,
    );
    const warmup = await f.call("backtrader_backtest", {
      ...args,
      operation_id: "actual-warmup",
      class_name: "Warmup",
    });
    assert.equal(warmup.status, "completed");
    const warmupEquity = data.data(
      warmup.data.find((table) => table.id === "equity").ref,
    ).rows;
    assert.equal(
      warmupEquity.length,
      rows.length,
      "Analyzer records prenext/nextstart/next bars exactly once",
    );
    assert.equal(
      new Set(warmupEquity.map((row) => row.time)).size,
      rows.length,
    );
    // The host execution record snapshots the strategy's own lifecycle evidence before cleanup.
    const warmExecution = f.store.get("execution", warmup.executionId);
    const hooks = JSON.parse(
      Buffer.from(warmExecution.files["hooks.json"], "base64").toString(),
    );
    assert.deepEqual(hooks, [
      ["prenext", 1],
      ["prenext", 2],
      ["nextstart", 3],
      ["next", 4],
      ["next", 5],
      ["next", 6],
    ]);
    await writeFile(
      strategy,
      'import backtrader as bt\nclass RoundTrip(bt.Strategy):\n def next(self):raise ValueError("controlled native failure")\n',
    );
    const failed = await f.call("backtrader_backtest", {
      ...args,
      operation_id: "actual-engine-failure",
    });
    assert.equal(failed.status, "failed");
    assert.deepEqual(failed.data, []);
    assert.equal(
      (await f.call("backtrader_result", { ref: result.ref })).manifest.content
        .statistics.closedTrades,
      1,
    );
    assert.ok(
      !(await readdir(f.runtime.workspaces.root("conv_main"))).some((name) =>
        name.startsWith(".backtrader-"),
      ),
    );
    t.diagnostic(
      JSON.stringify({
        environment: env.origin,
        version: env.library,
        realEngine: true,
        input: "demo",
        result: result.ref,
        statistics: result.statistics,
      }),
    );
  },
);

test(
  "CCXT existing dependency inspect selects it and real public worker can immediately read",
  {
    skip: !root || !process.env.SESAME_CCXT_EXISTING_PYTHON,
    timeout: 90000,
  },
  async (t) => {
    const f = await host(t, "ccxt");
    const ready = await f.call("ccxt_environment", {
      action: "inspect",
      python_path: process.env.SESAME_CCXT_EXISTING_PYTHON,
    });
    assert.equal(ready.ready, true);
    assert.equal(ready.reused, true);
    assert.deepEqual(ready.downloads, []);
    const selection = JSON.parse(
      await readFile(
        join(f.store.directory, "plugins/data/sesame/ccxt/selection.json"),
      ),
    );
    assert.equal(selection.python, ready.python);
    const configuration = {
      exchange: "kraken",
      ...(process.env.SESAME_CCXT_PUBLIC_PROXY
        ? { publicProxy: process.env.SESAME_CCXT_PUBLIC_PROXY }
        : {}),
    };
    const bound = await f.runtime.providers.bind(
      { pluginId: "sesame/ccxt", providerId: "market" },
      { configuration },
    );
    const now = Date.now(),
      result = await f.runtime.providers.call(bound.bindingId, "queryBars", {
        instrument: { sourceId: "ccxt:kraken:spot", instrumentId: "BTC/USD" },
        spec: {
          timeframe: "1h",
          priceBasis: "last",
          adjustment: "none",
          session: "all",
          calendarRevision: { status: "unknown" },
        },
        range: {
          from: { basis: "utc", unixMs: now - 24 * 3600000 },
          to: { basis: "utc", unixMs: now },
        },
        direction: "backward",
        includeForming: false,
        page: { limit: 24 },
      });
    assert.ok(result.data.page.items.length >= 10);
    assert.ok(
      result.data.page.items.every(
        (bar) => bar.isClosed && bar.closure === "source",
      ),
    );
    t.diagnostic(
      JSON.stringify({
        actualPublicSource: result.meta.source,
        count: result.data.page.items.length,
        existingInspect: true,
        downloads: [],
      }),
    );
    await f.runtime.providers.unbind(bound.bindingId);
  },
);
