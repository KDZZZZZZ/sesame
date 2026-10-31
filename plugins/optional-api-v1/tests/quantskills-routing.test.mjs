import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../packages/quantskills-catalog/', import.meta.url);
const json = name => JSON.parse(readFileSync(new URL(name, root)));
function exchange(lines) {
  const result = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-X', 'utf8', fileURLToPath(new URL('server.py', root))], {
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

test('research routing exposes investment-research and one strategy need, and rejects retired aliases', () => {
  const [strategy, research, backtest] = exchange([
    call(1, 'catalog_recommend', { need: 'strategy' }),
    call(2, 'catalog_recommend', { need: 'investment-research' }),
    call(3, 'catalog_recommend', { need: 'native-backtest' }),
  ]).map(response => response.result.structuredContent);
  assert.deepEqual(strategy.workflow.primary_plugins, ['sesame/auto-factor-mining']);
  assert.deepEqual(research.workflow.primary_plugins, ['sesame/investment-research']);
  const guidance = json('capabilities.json').capabilities.find(item => item.id === 'catalog_recommend').usage;
  assert.match(guidance.outputs, /need:strategy/);
  assert.doesNotMatch(JSON.stringify(guidance), /factor-research|strategy-research|accepted as aliases/);
  for (const response of exchange(['factor-research', 'strategy-research', 'research'].map((need, i) => call(i, 'catalog_recommend', { need })))) {
    assert.equal(response.error.code, -32602);
  }
  for (const route of Object.values(json('workflows.json').workflows)) {
    assert.ok(!route.primary_plugins.some(id => ['sesame/factor-research', 'sesame/strategy-research'].includes(id)));
  }
  assert.deepEqual(backtest.workflow.primary_plugins, []);
  assert.ok(backtest.workflow.backend_choices.includes('sesame/backtrader'));
  for (const response of [strategy, research, backtest]) {
    assert.equal(response.availability, 'not_checked');
    assert.ok(response.next_steps.some(step => step.includes('capabilities')));
    assert.ok(response.references.length > 0);
    assert.equal(response.snapshot_date, json('catalog.json').meta.snapshot_date);
  }
  assert.ok(strategy.references.some(item => item.name === 'skill-factor-mine'));
  assert.ok(strategy.references.some(item => item.name === 'skill-backtest-overfit'));
});

test('historical evidence routes to an independent computational package', () => {
  const [response] = exchange([call(1, 'catalog_recommend', { need: 'historical-evidence' })]);
  const result = response.result.structuredContent;
  assert.deepEqual(result.workflow.primary_plugins, ['sesame/historical-evidence']);
  assert.equal(result.availability, 'not_checked');
  assert.equal(result.selection_required, false);
  assert.ok(result.references.length > 0);
});

test('selecting only ICT returns no other theory, and does not mutate later choices', () => {
  const [ict, all, mismatch] = exchange([
    call(1, 'catalog_recommend', { need: 'technical-analysis', method: 'ict' }),
    call(2, 'catalog_recommend', { need: 'technical-analysis' }),
    call(3, 'catalog_recommend', { need: 'strategy', method: 'ict' }),
  ]);
  assert.deepEqual(ict.result.structuredContent.workflow.primary_plugins, ['sesame/ict']);
  assert.equal(ict.result.structuredContent.selection_required, false);
  assert.equal(ict.result.structuredContent.workflow.method_choices, undefined);
  assert.ok(!JSON.stringify(ict).includes('sesame/elliott-wave'));
  assert.ok(!JSON.stringify(ict).includes('sesame/price-action'));
  assert.deepEqual(all.result.structuredContent.workflow.primary_plugins, []);
  assert.equal(all.result.structuredContent.selection_required, true);
  assert.equal(all.result.structuredContent.workflow.method_choices.ict, 'sesame/ict');
  assert.equal(mismatch.error.code, -32602);
});

test('runtime schema, route references and preserved source snapshot agree', () => {
  const [tools] = exchange([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  assert.deepEqual(tools.result.tools, json('capabilities.json').capabilities.map(item => ({ name: item.binding.name, description: item.description, inputSchema: item.inputSchema, outputSchema: item.outputSchema })));
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
  const tests = json('plugin.json').tests;
  const replies = exchange(tests.map((entry, index) => call(index, entry.tool, entry.arguments)));
  for (let index = 0; index < tests.length; index++) assert.deepEqual(replies[index].result.structuredContent, tests[index].expected);
});
