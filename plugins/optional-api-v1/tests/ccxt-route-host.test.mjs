import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const hostRoot = process.env.SESAME_HOST_ROOT;
test(
  "Exact public route persists across canvas connection-only binding and real Host restart; typos reject before worker",
  { skip: !hostRoot },
  async () => {
    const { Store } = await import(
        pathToFileURL(join(hostRoot, "modules/agent/store.js"))
      ),
      { Runtime } = await import(
        pathToFileURL(join(hostRoot, "modules/agent/runtime.js"))
      );
    const directory = await mkdtemp("/tmp/sesame-ccxt-route-host-");
    let store, runtime;
    const requests = [];
    const open = async () => {
      store = new Store(join(directory, "app"));
      runtime = await new Runtime(store, {
        piDir: join(directory, "pi"),
        officialPluginsDirectory: join(directory, "empty"),
      }).init();
    };
    const close = async () => {
      await runtime?.close();
      store?.close();
      runtime = null;
      store = null;
    };
    const fixedWorker = () => {
      const entry = [...runtime.providers.entries.values()].find(
          (e) => e.plugin.id === "sesame/ccxt",
        ),
        original = entry.implementation.host;
      entry.implementation.host = {
        storage: original.storage,
        environment: {
          executeWorker: async (_path, payload) => {
            requests.push(payload);
            return {
              library: "4.5.85",
              exchange: "kraken",
              observedAt: Date.now(),
              rows:
                payload.action === "markets"
                  ? [
                      {
                        symbol: "BTC/USD",
                        id: "XXBTZUSD",
                        base: "BTC",
                        quote: "USD",
                        precisionMode: 4,
                        precision: { price: "0.1" },
                      },
                    ]
                  : [
                      [0, "10", "11", "9", "10", "1"],
                      [3600000, "10", "12", "9", "11", "2"],
                    ],
            };
          },
        },
      };
    };
    const call = async (name, args) =>
      (
        await runtime.plugins
          .definitions({ conversationId: "conv_main" })
          .find((t) => t.name === name)
          .execute("route-test", args)
      ).details;
    const provider = { pluginId: "sesame/ccxt", providerId: "market" },
      instrument = { sourceId: "ccxt:kraken:spot", instrumentId: "BTC/USD" },
      configuration = {
        exchange: "kraken",
        publicProxy: "http://127.0.0.1:7897",
      };
    try {
      await open();
      for (const [name, path] of [
        ["ccxt", new URL("../packages/ccxt/", import.meta.url)],
        [
          "canvas-control",
          new URL("../../api-v1/packages/canvas-control/", import.meta.url),
        ],
      ]) {
        const draft = join(runtime.workspaces.root("conv_main"), name);
        await cp(fileURLToPath(path), draft, { recursive: true });
        const tested = await runtime.plugins.manager.test("conv_main", {
          path: draft,
        });
        assert.equal(tested.passed, true, JSON.stringify(tested));
        await runtime.plugins.manager.install("conv_main", {
          path: draft,
          digest: tested.digest,
        });
        runtime.plugins.activate("conv_main", "sesame/" + name);
      }
      assert.ok(
        runtime.plugins
          .read("conv_main", "sesame/ccxt", "README.md")
          .content.includes("publicProxy"),
      );
      fixedWorker();
      for (const bad of [
        { exchange: "kraken", proxy: "http://127.0.0.1:7897" },
        { exchange: "kraken", publicProxy: null },
        { exchange: "kraken", publicProxy: true },
        { exchange: "kraken", publicProxy: 123 },
        {
          exchange: "kraken",
          publicProxy: "http://name:password@localhost:7897",
        },
        {
          exchange: "kraken",
          publicProxy: "http://localhost:7897/?token=secret",
        },
        ["kraken"],
        null,
      ]) {
        await assert.rejects(
          runtime.providers.bind(provider, { configuration: bad }),
          { code: "INVALID_ARGUMENT" },
        );
      }
      assert.equal(requests.length, 0);
      const selected = await runtime.providers.bind(provider, {
        configuration,
      });
      await runtime.providers.unbind(selected.bindingId);
      const chartBinding = await call("canvas_binding", {
        provider,
        instrument,
        timeframe: "1h",
        session: "all",
        connection: selected.connection,
      });
      assert.deepEqual(chartBinding.binding.connection, selected.connection);
      assert.ok(
        requests.every((r) => r.publicProxy === configuration.publicProxy),
      );
      await close();
      await open();
      fixedWorker();
      const resumed = await runtime.providers.bind(provider, {
        connection: chartBinding.binding.connection,
      });
      const bars = await runtime.providers.call(
        resumed.bindingId,
        "queryBars",
        {
          instrument,
          spec: chartBinding.binding.spec,
          range: {
            from: { basis: "utc", unixMs: 0 },
            to: { basis: "utc", unixMs: 7200000 },
          },
          includeForming: true,
          page: { limit: 10 },
        },
      );
      assert.equal(bars.data.page.items.length, 2);
      assert.equal(requests.at(-1).publicProxy, configuration.publicProxy);
      const stream = await runtime.providers.subscribe(
        resumed.bindingId,
        "subscribeBars",
        {
          instrument,
          spec: chartBinding.binding.spec,
          tailLimit: 2,
          includeForming: true,
        },
      );
      assert.deepEqual(stream.snapshot.snapshot.instrument, instrument);
      assert.equal(
        requests.at(-1).publicProxy,
        configuration.publicProxy,
        "Dashboard stream uses the exact persisted route",
      );
      await stream.close();
      const before = requests.length;
      await assert.rejects(
        runtime.providers.bind(provider, {
          connection: {
            ...selected.connection,
            revision: "sha256:" + "a".repeat(64),
          },
        }),
        { code: "CONNECTION_CHANGED" },
      );
      await assert.rejects(
        runtime.providers.bind(provider, {
          connection: selected.connection,
          configuration: { exchange: "kraken" },
        }),
        { code: "CONNECTION_CHANGED" },
      );
      assert.equal(requests.length, before);
      await runtime.providers.unbind(resumed.bindingId);
    } finally {
      await close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
