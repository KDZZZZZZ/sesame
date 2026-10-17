import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MT5Official } from '../packages/mt5/backend/official.js';
import { officialTool } from '../packages/mt5/backend/plugin-tools.js';
import { PYTHON_TOOLS } from '../packages/mt5/backend/python-tools.js';

const manifest = JSON.parse(await readFile(new URL('../packages/mt5/capabilities.json', import.meta.url)));
const definitions = new Map(manifest.capabilities.map(cap => [cap.id, cap]));
const routing = Object.create(MT5Official.prototype);
const writes = [
  ['python', 'order_send', 'mt5_trade', 'external-trading'],
  ['python', 'initialize', 'mt5_trade', 'native-connection'],
  ['python', 'login', 'mt5_trade', 'native-connection'],
  ['terminal', 'trade_close_single_position', 'mt5_trade', 'external-trading'],
  ['terminal', 'chart_add_expert', 'mt5_trade', 'external-strategy-operation'],
  ['terminal', 'chart_add_script', 'mt5_trade', 'external-strategy-operation'],
  ['terminal', 'chart_open', 'mt5_trade', 'external-strategy-operation'],
  ['terminal', 'chart_apply_template', 'mt5_trade', 'external-strategy-operation'],
  ['launcher', 'start_terminal', 'mt5_trade', 'native-process-start'],
  ['terminal', 'chart_add_indicator', 'mt5_chart', 'native-state.write'],
  ['terminal', 'remove_marketwatch_symbol', 'mt5_chart', 'native-state.write'],
  ['metaeditor', 'write_file', 'mt5_edit', 'native-state.write'],
  ['metaeditor', 'delete_folder', 'mt5_edit', 'native-state.write'],
  ['launcher', 'start_editor', 'mt5_edit', 'native-process-start'],
  ['terminal', 'shell', 'mt5_system', 'process.exec'],
  ['terminal', 'send_web_request', 'mt5_system', 'native-state.write'],
  ['launcher', 'tester_agent_install', 'mt5_system', 'native-state.write'],
  ['terminal', 'tester_run_backtest', 'mt5_test', 'process.exec'],
  ['terminal', 'tester_stop', 'mt5_test', 'process.cancel'],
  ['python', 'shutdown', 'mt5_python', 'native-connection'],
  ['python', 'symbol_select', 'mt5_python', 'native-state.write'],
  ['python', 'market_book_add', 'mt5_python', 'native-state.write'],
];

test('MT5 mixed native entry effects cover their actual write routes', () => {
  for (const [server, method, capability, effect] of writes) {
    assert.equal(routing.route(server, method).agent_tool, capability, `${server}/${method}`);
    assert.ok(definitions.get(capability).effects.includes(effect), `${capability} must declare ${effect} for ${method}`);
  }
});

test('the MT5 official read entry accepts market and indicator reads and rejects every native write before dispatch', async () => {
  const calls = [];
  const official = { route: (...args) => routing.route(...args), call: async args => { calls.push(args); return { status: 'returned' }; } };
  const entry = officialTool({ context: { sessionId: 'read-only-analysis' } }, { official }, 'official');
  for (const method of ['get_chart_history', 'chart_get_indicator_state', 'list_available_indicators', 'get_indicator_parameters', 'get_trading_account_info']) {
    await entry.execute({ server: 'terminal', tool: method, arguments: {}, command_id: `readonly-${method}` });
  }
  assert.equal(calls.length, 5);
  for (const [server, tool] of writes) await assert.rejects(entry.execute({ server, tool, arguments: {}, command_id: `rejected-${tool}` }), { code: 'mt5_wrong_plugin' });
  await assert.rejects(entry.execute({ server: 'terminal', tool: 'new_unclassified_write', arguments: {}, command_id: 'rejected-new-operation' }), { code: 'mt5_wrong_plugin' });
  assert.equal(calls.length, 5, 'No rejected operation reaches the native transport');
});

test('MT5 catalog reads exact native schemas without requesting a MetaEditor process start', async () => {
  const calls = [], schema = { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] };
  const official = Object.assign(Object.create(MT5Official.prototype), {
    config: { servers: { metaeditor: { enabled: true, token: 'fixture-token' }, terminal: { enabled: true, token: 'fixture-token' } }, allow_trading: true, allow_host_operations: true },
    clients: new Map(), python: { available: () => true }, native: {}, redact: value => value,
    tools: async (server, _signal, options) => { calls.push({ server, options }); return [{ name: 'get_chart_history', inputSchema: schema }]; },
  });
  for (const server of ['metaeditor', 'terminal', undefined]) {
    const result = await official.catalog(server);
    assert.ok(result.items.some(item => item.tools.some(tool => tool.name === 'get_chart_history' && tool.inputSchema === schema)));
  }
  assert.ok(calls.length >= 3);
  assert.ok(calls.every(call => call.options?.startIfNeeded !== true), 'Listing methods must not request a process launch');
  assert.deepEqual(definitions.get('mt5_catalog').effects, ['native-discovery']);
});

test('the official read route exposes only the two pure Python risk calculations', async () => {
  const calls = [], official = { route: (...args) => routing.route(...args), call: async args => { calls.push(args); return { status: 'returned', result: { result: 42 } }; } };
  const entry = officialTool({ context: { sessionId: 'read-only-risk' } }, { official }, 'official');
  const calculations = ['order_calc_profit', 'order_calc_margin'];
  for (const tool of calculations) {
    assert.equal(routing.route('python', tool).agent_tool, 'mt5_call');
    const args = { action: 'ORDER_TYPE_BUY', symbol: 'EURUSD', volume: 0.1, ...(tool === 'order_calc_profit' ? { price_open: 1.1, price_close: 1.2 } : { price: 1.1 }) };
    const result = await entry.execute({ server: 'python', tool, arguments: args, command_id: `read-only-${tool}` });
    assert.equal(result.result.result, 42);
  }
  for (const { name: tool } of PYTHON_TOOLS.filter(tool => !calculations.includes(tool.name))) {
    await assert.rejects(entry.execute({ server: 'python', tool, arguments: {}, command_id: `read-only-rejected-${tool}` }), { code: 'mt5_wrong_plugin' });
  }
  assert.deepEqual(calls.map(call => call.tool), calculations);
});

test('read-only MetaEditor calls do not start an editor while explicit editing keeps its startup path', async () => {
  const lookups = [], rows = new Map();
  const official = Object.assign(Object.create(MT5Official.prototype), {
    config: { version: 1, servers: {}, account: {}, allow_trading: true, allow_host_operations: true }, jobs: new Map(), redact: value => value,
    storage: { get: (table, id) => rows.get(`${table}/${id}`), put: (table, value) => rows.set(`${table}/${value.id}`, value), transaction: work => work() },
    tools: async (server, _signal, options) => {
      lookups.push({ server, options });
      return ['get_workspace_info', 'compile_file'].map(name => ({ name, inputSchema: { type: 'object', properties: {}, additionalProperties: false } }));
    },
    client: () => ({ call: async () => ({ structuredContent: { observed: true } }) }),
  });
  const host = { context: { sessionId: 'read-only-editor' } };
  await officialTool(host, { official }, 'official').execute({ server: 'metaeditor', tool: 'get_workspace_info', arguments: {}, command_id: 'read-only-workspace-01' });
  await officialTool(host, { official }, 'editor').execute({ server: 'metaeditor', tool: 'compile_file', arguments: {}, command_id: 'explicit-compile-01' });
  assert.equal(lookups[0].options.startIfNeeded, false, 'A read entry cannot implicitly start MetaEditor');
  assert.equal(lookups[1].options.startIfNeeded, true, 'An explicit editor operation keeps its existing startup behavior');
});
