import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { resolveResearch, hasResearchDataAccess } from '../packages/auto-factor-mining/composition.js';

const root = new URL('../packages/', import.meta.url);
async function fixture(name, capabilityId) {
  const base = new URL(name + '/', root);
  const declaration = JSON.parse(await readFile(new URL('capabilities.json', base), 'utf8'));
  const audit = capabilityId === 'abu_trade_results_audit';
  const input = JSON.parse(await readFile(new URL(audit ? 'examples/audit-input.json' : 'examples/input.json', base), 'utf8'));
  const { analyze } = await import(new URL(audit ? 'scripts/audit.mjs' : 'scripts/baseline.mjs', base));
  return { capability: capabilityId ? declaration.capabilities.find(cap => cap.id === capabilityId) : declaration.capabilities[0], input, analyze };
}

test('required calculation inputs are disclosed in the callable schema before execution', async () => {
  for (const [name, fields] of Object.entries({
    'abu-indicators':['bars'], 'abu-exit-rules':['bars','position'],
    'abu-position-sizing':['bars','account','instrument'],
    'abu-model-lab':['feature_names','rows'], 'abu-parameter-search':['grid','trials'],
    'abu-trade-judges':['feature_names','query','completed_trades'],
    'abu-trade-metrics':['portfolio','equity_curve'], 'abu-similarity':['instruments'],
  })) {
    const {capability,input,analyze} = await fixture(name);
    for (const field of fields) {
      const missing = structuredClone(input); delete missing[field];
      assert.throws(() => analyze(missing), `${name}.${field} is required by the existing implementation`);
      assert.equal(Value.Check(capability.inputSchema,{input:missing}),false,`${name}.${field} must be visible as required to the caller`);
    }
  }
});

test('parameter-search schema accepts arbitrary scalar grids, not only numeric example names', async () => {
  const {capability,input,analyze} = await fixture('abu-parameter-search');
  const value={...input,parameters:{phase:'development',objective_metric:'quality'},grid:{lookback:['short','long'],threshold:[false,true]},trials:[{split:'development',available_at:input.as_of,parameters:{lookback:'short',threshold:true},metrics:{quality:0.7}}]};
  delete value.frozen_selection;
  const result=analyze(value);
  assert.equal(result.observations.grid_points,4);
  assert.equal(Value.Check(capability.inputSchema,{input:value}),true);
});

test('feature names are dynamic and optional decision times keep the existing as_of default',async()=>{
  const {capability,input,analyze}=await fixture('abu-model-lab');
  const names=['momentum','volatility'];
  input.feature_names=names;
  // Example-named properties not selected in feature_names are unrelated JSON evidence.
  for(const row of input.rows) row.features.unused_note='caller metadata';
  assert.doesNotThrow(()=>analyze(input));
  assert.equal(Value.Check(capability.inputSchema,{input}),true);
  // The public feature schema describes arbitrary selected numeric features;
  // a real selected name is not tied to one example shape.
  const renamed=structuredClone(input);
  renamed.feature_names=['alpha','beta'];
  for(const row of renamed.rows) row.features={alpha:row.features.momentum,beta:row.features.volatility};
  assert.equal(Value.Check(capability.inputSchema,{input:renamed}),true);
  assert.doesNotThrow(()=>analyze(renamed));
  const ml=await fixture('abu-ml-features');delete ml.input.decision_times;
  assert.equal(Value.Check(ml.capability.inputSchema,{input:ml.input}),true);
  assert.equal(ml.analyze(ml.input).observations[0].decision_time,ml.input.as_of);
});

test('backtest audit accepts order and fill evidence without optional market bars',async()=>{
  const {capability,input,analyze}=await fixture('abu-trade-metrics', 'abu_trade_results_audit');
  delete input.bars;
  assert.doesNotThrow(()=>analyze(input));
  assert.equal(Value.Check(capability.inputSchema,{input}),true,'optional bars must not be invented just to satisfy the tool schema');
});

test('merged independent diagnostics retain the real workflow input-only classification', async () => {
  const plugin = JSON.parse(await readFile(new URL('abu-trade-metrics/plugin.json', root), 'utf8'));
  const declaration = JSON.parse(await readFile(new URL('abu-trade-metrics/capabilities.json', root), 'utf8'));
  const host = { plugins: { read(id, request) {
    assert.equal(id, plugin.id);
    return request.part === 'manifest' ? { ...declaration, id, version: plugin.version, revision: 'fixture-fixed-merged-plugin' }
      : { state: 'mounted', runtime_status: 'ready', agent_scope: plugin.agent_scope };
  } } };
  const resolved = resolveResearch(host, { plugins: [plugin.id] });
  assert.deepEqual(resolved.tools, ['sesame/abu-trade-metrics#abu_trade_metrics_analyze', 'sesame/abu-trade-metrics#abu_trade_results_audit']);
  assert.deepEqual(resolved.inputOnlyTools, resolved.tools);
  assert.equal(hasResearchDataAccess(resolved), false, 'Neither method adds external dataset access or native engine execution');
});
