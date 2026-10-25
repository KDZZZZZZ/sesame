import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
const hostRoot = process.env.SESAME_HOST_ROOT;

test(
  "Exact public route persists across canvas connection-only binding and real Host restart; typos reject before worker",
  { skip: !hostRoot, timeout: 60000 },
  async () => {
    const load = path => import(pathToFileURL(join(hostRoot, path)));
    const [{ Store }, { Runtime }, { createHostContextV2 }] = await Promise.all([
      load("modules/agent/store.js"), load("modules/agent/runtime.js"), load("modules/plugins/host-v2/context.js"),
    ]);
    const directory = await mkdtemp(join(tmpdir(), "sesame-ccxt-route-host-"));
    let store, runtime, main;
    const requests = [], patched = new Map();
    const open = async () => {
      store = new Store(join(directory, "app"));
      runtime = await new Runtime(store, {
        piDir: join(directory, "pi"),
        officialPluginsDirectory: join(directory, "empty"),
      }).init();
      main = createHostContextV2(runtime, runtime.capabilities.hostEntry, "conv_main");
    };
    const close = async () => {
      await runtime?.close();
      store?.close();
      runtime = null; store = null; main = null;
    };
    const fixedWorker = async () => {
      // Patch only the installed package's native read boundary. The real
      // capability factory, HostContext, source binding and private DB remain live.
      const entry = runtime.plugins.entry("sesame/ccxt");
      const { CCXTProvider } = await import(pathToFileURL(join(entry.root, "provider.js")));
      if (!patched.has(CCXTProvider)) patched.set(CCXTProvider, CCXTProvider.prototype.call);
      CCXTProvider.prototype.call = async function (context, action, args = {}) {
        const binding = this.bound(context);
        const payload = { exchange: binding.exchange, publicProxy: binding.proxy, action, ...args };
        requests.push(payload);
        return {
          library: "4.5.85", exchange: binding.exchange, observedAt: Date.now(),
          rows: action === "markets" ? [{
            symbol: "BTC/USD", id: "XXBTZUSD", base: "BTC", quote: "USD",
            precisionMode: 4, precision: { price: "0.1" },
          }] : [
            [0, "10", "11", "9", "10", "1"],
            [3600000, "10", "12", "9", "11", "2"],
          ],
        };
      };
    };
    const sourceRef = async () => {
      const { items } = await main.data.sources({ providerId: "sesame/ccxt#market" });
      assert.equal(items.length, 1); assert.equal(items[0].available, true);
      return items[0].ref;
    };
    const instrument = { sourceId: "ccxt:kraken:spot", instrumentId: "BTC/USD" };
    const configuration = { exchange: "kraken", publicProxy: "http://127.0.0.1:7897" };
    const describe = source => main.data.query({ source, operation: "describeInstrument", input: { instrument }, limit: 1 });
    try {
      await open();
      for (const [name, path] of [
        ["ccxt", new URL("../packages/ccxt/", import.meta.url)],
        ["canvas-control", new URL("../../api-v1/packages/canvas-control/", import.meta.url)],
      ]) {
        const draft = join(runtime.workspaces.root("conv_main"), name);
        await cp(fileURLToPath(path), draft, { recursive: true });
        await main.plugins.install({ path: draft });
        await main.plugins.setEnabled("sesame/" + name, true, { scope: "session" });
        assert.equal(runtime.plugins.entry("sesame/" + name).runtime_status, "ready");
      }
      assert.ok((await main.plugins.read("sesame/ccxt", { part: "resource", path: "README.md" })).content.includes("publicProxy"));
      await fixedWorker();
      const source = await sourceRef();
      for (const [bad, code] of [
        [{ exchange: "kraken", proxy: "http://127.0.0.1:7897" }, "INVALID_BINDING"],
        [{ exchange: "kraken", publicProxy: null }, "INVALID_BINDING"],
        [{ exchange: "kraken", publicProxy: true }, "INVALID_BINDING"],
        [{ exchange: "kraken", publicProxy: 123 }, "INVALID_BINDING"],
        [{ exchange: "kraken", publicProxy: "http://name:password@localhost:7897" }, "INVALID_ARGUMENT"],
        [{ exchange: "kraken", publicProxy: "http://localhost:7897/?token=secret" }, "INVALID_ARGUMENT"],
        [["kraken"], "INVALID_BINDING"],
        [null, "INVALID_BINDING"],
      ]) await assert.rejects(describe({ ...source, binding: { configuration: bad } }), { code });
      assert.equal(requests.length, 0);
      const selected = await describe({ ...source, binding: { configuration } });
      const connection = selected.metadata.connection;
      assert.equal(connection.id, "ccxt:kraken");
      const result = await main.capabilities.invoke("sesame/canvas-control#canvas_binding", {
        source: { ...source, binding: { connection } }, instrument, timeframe: "1h", session: "all",
      });
      assert.equal(result.type, "result");
      const chartBinding = result.value.binding;
      assert.deepEqual(chartBinding.source.binding, { connection });
      assert.ok(requests.length >= 2);
      assert.ok(requests.every(request => request.publicProxy === configuration.publicProxy));
      const storageRoot = join(store.directory, "plugins/data/sesame/ccxt");
      await close(); await open(); await fixedWorker();
      assert.equal(join(store.directory, "plugins/data/sesame/ccxt"), storageRoot);
      assert.deepEqual(await sourceRef(), { providerId: chartBinding.source.providerId, revision: chartBinding.source.revision });
      const bars = await main.data.query({
        source: chartBinding.source, operation: "queryBars",
        input: {
          instrument, spec: chartBinding.spec,
          range: { from: { basis: "utc", unixMs: 0 }, to: { basis: "utc", unixMs: 7200000 } },
          includeForming: true,
        }, limit: 10,
      });
      assert.equal(bars.items.length, 2);
      assert.deepEqual(bars.metadata.connection, connection);
      assert.equal(requests.at(-1).publicProxy, configuration.publicProxy);
      const stream = await main.data.watch({
        source: chartBinding.source, operation: "subscribeBars",
        input: { instrument, spec: chartBinding.spec, tailLimit: 2, includeForming: true },
      });
      const events = stream.events[Symbol.asyncIterator]();
      try {
        const first = await events.next();
        assert.equal(first.done, false); assert.equal(first.value.type, "snapshot");
        assert.deepEqual(first.value.snapshot.instrument, instrument);
        assert.equal(requests.at(-1).publicProxy, configuration.publicProxy, "Dashboard stream uses the exact persisted route");
      } finally { await stream.close(); await events.return(); }
      const before = requests.length;
      await assert.rejects(describe({ ...source, binding: { connection: { ...connection, revision: "sha256:" + "a".repeat(64) } } }), { code: "CONNECTION_CHANGED" });
      await assert.rejects(describe({ ...source, binding: { connection, configuration: { exchange: "kraken" } } }), { code: "CONNECTION_CHANGED" });
      assert.equal(requests.length, before);
    } finally {
      await close();
      for (const [Provider, call] of patched) Provider.prototype.call = call;
      assert.equal(dirname(directory), resolve(tmpdir()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
