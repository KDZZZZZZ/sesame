import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../packages/quantskills-catalog/', import.meta.url);
const json = name => JSON.parse(readFileSync(new URL(name, root)));
function exchange(lines) {
  const result = spawnSync(process.env.PYTHON || 'python3', [fileURLToPath(new URL('server.py', root))], {
    encoding: 'utf8', input: lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.equal(result.stderr, '');
  return result.stdout.trim().split('\n').map(line => JSON.parse(line));
}
const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('a successful search cannot leak into the next unknown tool response', () => {
  const [first, missing, next] = exchange([
    call(1, 'catalog_search', { query: 'alpha191' }), call(2, 'nonexistent'), call(3, 'catalog_get_item', { name: 'missing' }),
  ]);
  assert.equal(first.result.structuredContent.count, 1);
  assert.equal(missing.error.code, -32601);
  assert.equal(missing.result, undefined);
  assert.deepEqual(next.result.structuredContent, { found: false, name: 'missing', version: json('plugin.json').version });
});

test('invalid JSON and invalid limits return errors without terminating the MCP process', () => {
  const requests = ['{broken', 'null', call(3, 'catalog_search', { query: 'alpha', limit: 0 }),
    call(4, 'catalog_search', { query: 'alpha', limit: true }), call(5, 'catalog_filter', { limit: 1001 }),
    call(6, 'catalog_search', { query: ['alpha'] }), call(7, 'catalog_search', { query: ' '.repeat(4) }),
    call(8, 'catalog_recommend', { need: 'unrecognized' }), call(9, 'catalog_list_categories')];
  const responses = exchange(requests);
  for (const response of responses.slice(0, -1)) assert.equal(response.error.code, -32602);
  assert.equal(responses.at(-1).result.structuredContent.total_items, 214);
});

test('method routing consolidates overlapping factor/strategy work without installing or claiming availability', () => {
  const [factor, strategy, backtest] = exchange([
    call(1, 'catalog_recommend', { need: 'factor-research' }),
    call(2, 'catalog_recommend', { need: 'strategy-research' }),
    call(3, 'catalog_recommend', { need: 'native-backtest' }),
  ]).map(response => response.result.structuredContent);
  assert.deepEqual(factor.workflow.primary_plugins, ['sesame/quant-research']);
  assert.deepEqual(strategy.workflow.primary_plugins, factor.workflow.primary_plugins);
  assert.deepEqual(backtest.workflow.primary_plugins, []);
  assert.ok(backtest.workflow.backend_choices.includes('sesame/backtrader'));
  for (const response of [factor, strategy, backtest]) {
    assert.equal(response.availability, 'not_checked');
    assert.ok(response.next_steps.some(step => step.includes('plugin_catalog')));
    assert.ok(response.references.length > 0);
    assert.equal(response.snapshot_date, json('catalog.json').meta.snapshot_date);
  }
});

test('runtime schema, route references and preserved source snapshot agree', () => {
  const [tools] = exchange([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  assert.deepEqual(tools.result.tools, json('tools.json').analysis);
  const snapshot = json('catalog.json');
  assert.equal(snapshot.meta.total_items, snapshot.items.length);
  const names = new Set(snapshot.items.map(item => item.name));
  const routes = json('workflows.json').workflows;
  const schema = tools.result.tools.find(tool => tool.name === 'catalog_recommend').inputSchema;
  assert.deepEqual(schema.properties.need.enum, Object.keys(routes));
  for (const route of Object.values(routes)) {
    for (const name of route.reference_names) assert.ok(names.has(name), `Unknown source reference: ${name}`);
    const plugins = [...route.primary_plugins, ...(route.shared_plugins || [])];
    assert.equal(new Set(plugins).size, plugins.length, 'Do not duplicate a method and shared prerequisite');
  }
});

test('all retained package tool assertions pass through a real stdio server', () => {
  const tests = json('plugin.json').extensions['bot.sesame'].tests;
  const replies = exchange(tests.map((entry, index) => call(index, entry.tool, entry.arguments)));
  for (let index = 0; index < tests.length; index++) assert.deepEqual(replies[index].result.structuredContent, tests[index].expected);
});
