import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveResearch, verifyResearch, taskPlugins } from '../composition.js';

const descriptor = (id, tools = [], overrides = {}) => ({ id, version: '7.2.1', digest: `sha256:${id}`, state: 'discoverable', runtime_status: 'ready', agent_scope: 'all', tools,
  delegatable_tools: tools.filter(name => !name.endsWith('_configure')), skills: [], ...overrides });
function fixture(entries) {
  const plugins = new Map(entries.map(entry => [entry.id, structuredClone(entry)]));
  return { plugins, host: { plugins: { inspect(id) { const entry = plugins.get(id); if (!entry) throw new Error('Not installed'); return structuredClone(entry); } } } };
}

test('explicit arbitrary plugin IDs compose without an identity or feature-type whitelist', () => {
  const { host } = fixture([descriptor('third-party/filing-search', ['filings_find', 'filings_configure']), descriptor('vendor/strategy-analysis', ['strategy_read']),
    descriptor('local/research-method', [], { skills: [{ name: 'research-method' }] })]);
  const selection = resolveResearch(host, { plugins: ['third-party/filing-search', 'vendor/strategy-analysis', 'local/research-method'] });
  assert.deepEqual(selection.plugins, ['third-party/filing-search', 'vendor/strategy-analysis', 'local/research-method']);
  assert.deepEqual(selection.tools, ['filings_find', 'strategy_read']);
  assert.deepEqual(selection.descriptors.map(({ id, version, digest }) => ({ id, version, digest })), selection.plugins.map(id => ({ id, version: '7.2.1', digest: `sha256:${id}` })));
  assert.equal(verifyResearch(host, selection), undefined);
});

test('explicit tools narrow selected plugins and can retain only skills', () => {
  const { host } = fixture([descriptor('external/any-capability', ['capability_one', 'capability_two', 'capability_configure'])]);
  assert.deepEqual(resolveResearch(host, { plugins: ['external/any-capability'], tools: ['capability_two'] }).tools, ['capability_two']);
  assert.deepEqual(resolveResearch(host, { plugins: ['external/any-capability'], tools: [] }).tools, []);
  assert.throws(() => resolveResearch(host, { plugins: ['external/any-capability'], tools: ['unselected_tool'] }), error => error.code === 'RESEARCH_TOOL_UNAVAILABLE');
  assert.throws(() => resolveResearch(host, { plugins: ['external/any-capability'], tools: ['capability_configure'] }), error => error.code === 'RESEARCH_TOOL_MAIN_ONLY');
});

test('default has no implicit research plugin and does not require discovery on older hosts', () => {
  assert.deepEqual(resolveResearch({}, undefined), { plugins: [], tools: [], descriptors: [] });
  assert.equal(verifyResearch({}, undefined), undefined);
  assert.throws(() => resolveResearch({}, { plugins: ['arbitrary/plugin'] }), error => error.code === 'HOST_UPGRADE_REQUIRED');
});

test('unavailable and main-only capabilities fail before Agent dispatch', () => {
  for (const overrides of [{ state: 'disabled' }, { runtime_status: 'failed' }, { agent_scope: 'main' }]) {
    const { host } = fixture([descriptor('local/selected', ['selected_read'], overrides)]);
    assert.throws(() => resolveResearch(host, { plugins: ['local/selected'] }), error => error.code === 'RESEARCH_PLUGIN_UNAVAILABLE');
  }
  const { host } = fixture([descriptor('local/old-host', ['maybe_main'], { delegatable_tools: undefined })]);
  assert.throws(() => resolveResearch(host, { plugins: ['missing/plugin'] }), error => error.code === 'RESEARCH_PLUGIN_UNAVAILABLE');
  assert.throws(() => resolveResearch(host, { plugins: ['local/old-host'] }), error => error.code === 'HOST_UPGRADE_REQUIRED');
});

test('selection is bounded, exact and unambiguous', () => {
  const { host } = fixture([descriptor('one/plugin', ['shared_tool']), descriptor('two/plugin', ['shared_tool'])]);
  for (const value of [{ plugins: ['one/plugin', 'one/plugin'] }, { plugins: ['one/plugin'], tools: ['shared_tool', 'shared_tool'] }, { plugins: ['one/plugin'], unexpected: true }, { plugins: 'one/plugin' }]) {
    assert.throws(() => resolveResearch(host, value), error => error.code === 'INVALID_ARGUMENT');
  }
  assert.throws(() => resolveResearch(host, { plugins: ['one/plugin', 'two/plugin'] }), error => error.code === 'RESEARCH_TOOL_AMBIGUOUS');
  const many = fixture([descriptor('many/tools', Array.from({ length: 63 }, (_, i) => `research_${i}`))]);
  assert.throws(() => resolveResearch(many.host, { plugins: ['many/tools'] }), error => error.code === 'RESEARCH_TOOL_LIMIT');
});

test('resume verifies the exact frozen plugin implementation and tool delegation', () => {
  const { host, plugins } = fixture([descriptor('third-party/research', ['public_read'])]);
  const selection = resolveResearch(host, { plugins: ['third-party/research'] });
  plugins.get('third-party/research').digest = 'sha256:updated';
  assert.throws(() => verifyResearch(host, selection), error => error.code === 'RESEARCH_PLUGIN_CHANGED');
  plugins.get('third-party/research').digest = selection.descriptors[0].digest;
  plugins.get('third-party/research').delegatable_tools = [];
  assert.throws(() => verifyResearch(host, selection), error => error.code === 'RESEARCH_TOOL_MAIN_ONLY');
});

test('the evaluator plus research union allows 32 distinct plugins, counting overlaps once', () => {
  const evaluator = { plugin_id: 'custom/evaluator' }, plugins = Array.from({ length: 31 }, (_, i) => `custom/skill-${i}`);
  assert.equal(taskPlugins(evaluator, { plugins }).length, 32);
  assert.equal(taskPlugins(evaluator, { plugins: [...plugins, evaluator.plugin_id] }).length, 32);
  assert.throws(() => taskPlugins(evaluator, { plugins: [...plugins, 'custom/extra'] }), error => error.code === 'PLUGIN_BUDGET_EXCEEDED');
  assert.deepEqual(taskPlugins(evaluator, { plugins }, { finalizer: true }), ['custom/evaluator']);
  assert.deepEqual(taskPlugins(evaluator, { plugins }, { reporter: true }), []);
});
