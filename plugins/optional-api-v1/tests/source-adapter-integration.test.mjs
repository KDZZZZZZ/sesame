import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;

test('Binance installs in the real host with public data discovery and private-only credential dependencies',
  { skip: !hostRoot, timeout: 60000 }, async () => {
    const load = path => import(pathToFileURL(join(hostRoot, path)));
    const [{ Store }, { Runtime }, { createHostContextV2 }] = await Promise.all([
      load('modules/agent/store.js'), load('modules/agent/runtime.js'), load('modules/plugins/host-v2/context.js'),
    ]);
    const root = await mkdtemp(join(tmpdir(), 'sesame-binance-host-'));
    const names = ['BINANCE_ENVIRONMENT', 'BINANCE_API_KEY', 'BINANCE_API_SECRET'];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    let store, runtime, main;
    const open = async () => {
      store = new Store(join(root, 'app'));
      runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: join(root, 'empty') }).init();
      main = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
    };
    const close = async () => { await runtime?.close(); store?.close(); runtime = null; store = null; main = null; };
    const invoke = async (id, input) => {
      const result = await main.capabilities.invoke(id, input);
      assert.equal(result.type, 'result');
      return result.value;
    };
    const catalog = async () => {
      const result = await invoke('sesame/configuration#configuration_integration_catalog', { plugin_id: 'sesame/binance' });
      return result.items.find(item => item.plugin_id === 'sesame/binance');
    };
    try {
      await open();
      for (const [name, source] of [
        ['binance', new URL('../packages/binance/', import.meta.url)],
        ['configuration', new URL('../../api-v1/packages/configuration/', import.meta.url)],
      ]) {
        const draft = join(runtime.workspaces.root('conv_main'), name);
        await cp(fileURLToPath(source), draft, { recursive: true });
        await main.plugins.install({ path: draft });
        await main.plugins.setEnabled(`sesame/${name}`, true, { scope: 'session' });
      }
      assert.equal(runtime.plugins.entry('sesame/binance').runtime_status, 'ready');
      const entry = await catalog();
      assert.ok(entry);
      for (const id of ['api_key', 'api_secret']) {
        const field = entry.fields.find(field => field.id === id);
        assert.equal(field.secret, true);
        assert.equal(field.configured, false);
        assert.equal(Object.hasOwn(field, 'value'), false);
        assert.ok(field.capabilities.length > 0);
        assert.ok(field.capabilities.every(capability => !/market|subscribeBars|subscribeQuotes|queryBars/.test(capability.id)));
      }
      const sources = await main.data.sources({ providerId: 'sesame/binance#market' });
      assert.equal(sources.items.length, 1);
      assert.equal(sources.items[0].available, true, 'Public market discovery must not require account credentials');
      const readiness = await invoke('sesame/configuration#configuration_integration_check', { plugin_id: 'sesame/binance', fields: ['api_key', 'api_secret'] });
      assert.equal(readiness.available, false);
      await assert.rejects(invoke('sesame/binance#binance_account', {}), { code: 'DEPENDENCY_UNAVAILABLE' });
      const publicCatalog = await invoke('sesame/binance#binance_catalog', {});
      assert.deepEqual(publicCatalog.credentials, { apiKey: false, apiSecret: false });
      assert.equal(publicCatalog.connections.length, 2);
      const values = { environment: 'testnet', api_key: 'fixture-binance-key', api_secret: 'fixture-binance-secret' };
      const receipt = await invoke('sesame/configuration#configuration_integration_apply', { plugin_id: 'sesame/binance', command_id: 'binance-fixture-credentials', values });
      assert.equal(receipt.status, 'applied');
      assert.ok(!JSON.stringify(receipt).includes(values.api_key));
      assert.ok(!JSON.stringify(receipt).includes(values.api_secret));
      const configured = await catalog();
      assert.ok(configured.fields.filter(field => ['api_key', 'api_secret'].includes(field.id)).every(field => field.configured && !Object.hasOwn(field, 'value')));
      await close();
      for (const name of names) delete process.env[name];
      await open();
      const restored = await catalog();
      assert.ok(restored.fields.filter(field => ['api_key', 'api_secret'].includes(field.id)).every(field => field.configured && !Object.hasOwn(field, 'value')));
      assert.equal((await main.data.sources({ providerId: 'sesame/binance#market' })).items[0].available, true);
    } finally {
      await close();
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
      }
      assert.equal(dirname(root), resolve(tmpdir()));
      assert.match(basename(root), /^sesame-binance-host-/);
      await rm(root, { recursive: true, force: true });
    }
  });
