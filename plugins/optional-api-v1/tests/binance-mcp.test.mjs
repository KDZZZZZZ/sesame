import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRecords } from '../packages/binance/src/records.js';

const exports = ['binance_catalog', 'binance_account', 'binance_execution_identity', 'binance_execution_snapshot', 'binance_order_status'];
const prohibited = ['binance_order', 'binance_order_test', 'binance_amend', 'binance_cancel', 'binance_execution_prepare', 'binance_execution_submit', 'binance_execution_cancel'];
const hostRoot = process.env.SESAME_HOST_ROOT ?? fileURLToPath(new URL('../../../../mt5agent/', import.meta.url));
const evidenceRoot = fileURLToPath(new URL('../../../../outputs/binance-mcp-20261024/', import.meta.url));

test('Binance MCP export is exactly the five non-order-producing tools and version is paired', async () => {
  const [plugin, packageJson] = await Promise.all(['plugin.json', 'package.json'].map(async file => JSON.parse(await readFile(new URL(`../packages/binance/${file}`, import.meta.url), 'utf8'))));
  assert.equal(plugin.version, '1.0.2'); assert.equal(packageJson.version, plugin.version);
  assert.deepEqual(plugin.mcp_export, exports);
  assert.ok(prohibited.every(name => !plugin.mcp_export.includes(name)));
});

test('real bundled host MCP discovers and calls only Binance observations without credential disclosure', { timeout: 60000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const [{ Store }, { Runtime }, { createHostContextV2 }, { handleMCP }, { assembleOfficialPlugins }] = await Promise.all([
    load('modules/agent/store.js'), load('modules/agent/runtime.js'), load('modules/plugins/host-v2/context.js'),
    load('modules/agent/plugin-system/mcp-server.js'), load('scripts/assemble-official-plugins.mjs'),
  ]);
  await mkdir(evidenceRoot, { recursive: true });
  const root = await mkdtemp(join(evidenceRoot, 'fixture-'));
  const names = ['BINANCE_ENVIRONMENT', 'BINANCE_API_KEY', 'BINANCE_API_SECRET'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  const values = { environment: 'testnet', api_key: 'fixture-only-mcp-key', api_secret: 'fixture-only-mcp-secret' };
  const calls = [], transcript = []; let store, runtime, seq = 0;
  const response = value => new Response(JSON.stringify(value), { status: 200 });
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const parsed = new URL(url), params = parsed.searchParams;
    assert.equal(parsed.origin, 'https://testnet.binance.vision', 'No request may leave the local transport fixture');
    assert.equal(options.method, 'GET', 'MCP observations must not send an order, test order, amendment or cancellation');
    assert.ok(!parsed.href.includes(values.api_key)); assert.ok(!parsed.href.includes(values.api_secret));
    calls.push({ method: options.method, path: parsed.pathname });
    if (parsed.pathname === '/api/v3/time') return response({ serverTime: Date.now() });
    assert.equal(options.headers['X-MBX-APIKEY'], values.api_key);
    if (parsed.pathname === '/api/v3/account') return response({ uid: 12345, accountType: 'SPOT', canTrade: true, permissions: ['SPOT'], updateTime: Date.now(), balances: [{ asset: 'USDT', free: '100.00', locked: '0.00' }] });
    if (parsed.pathname === '/api/v3/openOrders') return response([]);
    if (parsed.pathname === '/api/v3/order') {
      assert.equal(params.get('orderId'), '700');
      return response({ symbol: 'BTCUSDT', orderId: 700, clientOrderId: 'fixture-existing-client', side: 'BUY', type: 'LIMIT', origQty: '0.001', executedQty: '0', price: '50000', status: 'NEW' });
    }
    throw new Error(`Unexpected local fixture route: ${parsed.pathname}`);
  });
  const rpc = async (method, params = {}) => {
    const reply = await handleMCP(runtime, { jsonrpc: '2.0', id: ++seq, method, params });
    const serialized = JSON.stringify(reply);
    assert.ok(!serialized.includes(values.api_key)); assert.ok(!serialized.includes(values.api_secret));
    transcript.push({ method, tool: params.name, reply }); return reply;
  };
  const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });
  try {
    const source = join(root, 'packages'), bundle = join(root, 'bundle');
    await cp(fileURLToPath(new URL('../packages/binance/', import.meta.url)), join(source, 'binance'), { recursive: true });
    await cp(fileURLToPath(new URL('../../api-v1/packages/configuration/', import.meta.url)), join(source, 'configuration'), { recursive: true });
    await assembleOfficialPlugins({ source, destination: bundle });
    store = new Store(join(root, 'state'));
    runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: bundle }).init();
    assert.equal(runtime.plugins.entry('sesame/binance').external, false);
    const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'binance-local-test', version: '1' } });
    assert.equal(initialized.result.protocolVersion, '2025-11-25');
    const listed = await rpc('tools/list');
    assert.deepEqual(listed.result.tools.map(tool => tool.name).filter(name => name.startsWith('binance_')).sort(), [...exports].sort());
    assert.equal(store.get('conversation', 'conv_mcp').agent_role, 'external');
    const mcpContext = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_mcp');
    assert.equal(mcpContext.context.kind, store.get('conversation', 'conv_mcp').scope);
    const initial = await call('binance_catalog');
    assert.equal(initial.result.isError, false);
    assert.deepEqual(initial.result.structuredContent.credentials, { apiKey: false, apiSecret: false });
    const missing = await call('binance_account');
    assert.equal(missing.result.isError, true);
    assert.match(missing.result.content[0].text, /configur|配置|api_key|api_secret|依赖|dependenc/i);
    assert.equal(calls.length, 0, 'Missing configuration must be rejected before any authenticated request');

    const main = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
    const configured = await main.capabilities.invoke('sesame/configuration#configuration_integration_apply', { plugin_id: 'sesame/binance', command_id: 'local-mcp-fixture-only', values });
    assert.equal(configured.value.status, 'applied');
    assert.ok(!JSON.stringify(configured).includes(values.api_key)); assert.ok(!JSON.stringify(configured).includes(values.api_secret));
    const catalog = await call('binance_catalog');
    assert.deepEqual(catalog.result.structuredContent.credentials, { apiKey: true, apiSecret: true });
    const account = await call('binance_account');
    assert.equal(account.result.isError, false); assert.equal(account.result.structuredContent.account.accountId, '12345');
    const identity = await call('binance_execution_identity');
    assert.equal(identity.result.isError, false); assert.equal(identity.result.structuredContent.account.accountId, '12345');
    const snapshot = await call('binance_execution_snapshot');
    assert.equal(snapshot.result.isError, false); assert.deepEqual(snapshot.result.structuredContent.orders, []);
    assert.equal(snapshot.result.structuredContent.balances[0].free, '100.00');

    const records = createRecords(join(store.directory, 'plugins', 'data', 'sesame', 'binance'));
    try {
      records.put('commands', 'fixture-existing-order', { id: 'fixture-existing-order', kind: 'order', account: identity.result.structuredContent.account, environment: 'testnet', symbol: 'BTCUSDT', intent: { action: 'limit', side: 'buy', quantity: '0.001' }, clientOrderId: 'fixture-existing-client', status: 'submitted', submissionAttempted: true, result: { orderId: 700 } });
    } finally { records.close(); }
    const status = await call('binance_order_status', { operation_id: 'fixture-existing-order' });
    assert.equal(status.result.isError, false); assert.equal(status.result.structuredContent.raw.recovery.outcome, 'observed');
    for (const name of prohibited) {
      const denied = await call(name, { user_authorized: true, context: { kind: 'main' } });
      assert.ok(denied.error, `${name} must be unavailable through MCP`);
    }
    assert.ok(calls.every(row => row.method === 'GET'));
    await writeFile(join(evidenceRoot, 'mcp-fixture.json'), JSON.stringify({ version: '1.0.2', authenticatedNetworkRequests: 0, exchangeMutations: 0, exportedTools: exports, nativeCallerKind: mcpContext.context.kind, conversationRole: 'external', transport: 'in-process local GET-only fixture', calls, transcript }, null, 2) + '\n');
  } finally {
    await runtime?.close(); store?.close();
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
    assert.equal(dirname(resolve(root)), resolve(evidenceRoot));
    await rm(root, { recursive: true, force: true });
  }
});
