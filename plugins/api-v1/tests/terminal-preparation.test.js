import { mt5Import, mt5Path } from './mt5-path.js';
import test from 'node:test';
import assert from 'node:assert/strict';
const { prepareTerminal } = await mt5Import('terminal.js');

test('automatic mounting preserves occupied terminals and native permission boundaries before touching files or processes', async () => {
  const scope = { login: '7001', server: 'Demo' };
  let nativeAllowed = true, positions = [], orders = [], charts = [], calls = [];
  const mt5 = {
    official: { config: { account: scope }, jobs: new Set(), client: () => ({ call: async tool => {
      calls.push(tool);
      return { structuredContent: tool === 'get_trading_open_positions' ? { positions, orders } : { charts } };
    } }) },
    market: { connected: async () => ({ scope, info: { terminal: { mcp_trade_allowed: nativeAllowed, experts_trade_allowed: true } } }) },
    tester: { pending: new Set() }, deployments: { list: () => [] },
  };
  nativeAllowed = false;
  await assert.rejects(prepareTerminal(mt5, undefined, { restart: true }), /原生 MCP/);
  assert.deepEqual(calls, []);
  nativeAllowed = true; positions = [{ ticket: '1' }];
  await assert.rejects(prepareTerminal(mt5, undefined, { restart: true }), /持仓或挂单/);
  positions = []; orders = [{ ticket: '2' }];
  await assert.rejects(prepareTerminal(mt5, undefined, { restart: true }), /持仓或挂单/);
  orders = []; charts = [{ chart_id: '3', expert: 'Existing EA' }];
  await assert.rejects(prepareTerminal(mt5, undefined, { restart: true }), /已有 EA/);
  assert.ok(calls.every(tool => tool.startsWith('get_') || tool === 'list_open_charts'));
  await assert.rejects(prepareTerminal(mt5, undefined, { deployment: { status: 'preparing', ...scope, id: 'deploy_ok', build_id: '../other' }, inputs: { Product_RunId: 'deploy_ok', Product_EnableLive: true } }), /受管理挂载配置无效/);
});
