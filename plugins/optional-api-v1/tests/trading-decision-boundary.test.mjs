import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROLES } from '../packages/trading-decision/plans.js';
import { taskPlugins, taskTools } from '../packages/trading-decision/team.js';
import { fixture, unchanged } from './trading-decision-plans-fixture.mjs';

test('the renamed package exposes only trading decisions, with fixed research inputs and two roles', async () => {
  const plugin = JSON.parse(await readFile(new URL('../packages/trading-decision/plugin.json', import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL('../packages/trading-decision/capabilities.json', import.meta.url)));
  assert.equal(plugin.id, 'sesame/trading-decision');
  assert.deepEqual(ROLES, ['manager', 'executor']);
  assert.ok(plugin.main_tool_names.every(name => name.startsWith('trading_decision_')));
  assert.equal(manifest.capabilities.some(cap => /analyze|execution_export/.test(cap.id)), false);
  assert.ok(manifest.capabilities.every(cap => ['activate', 'dispose'].includes(cap.id) || cap.id.startsWith('trading_decision_')));
  const save = manifest.capabilities.find(cap => cap.id === 'trading_decision_plan').inputSchema.oneOf.find(branch => branch.properties.action.const === 'save');
  for (const name of ['mode', 'research', 'debate_rounds']) assert.equal(save.properties.plan.properties[name], undefined);
  assert.equal(save.properties.plan.additionalProperties, false);
  assert.equal(save.properties.plan.properties.research_refs.items.properties.kind.const, 'data');
  assert.deepEqual(Object.keys(save.properties.plan.properties.agent_models.properties), ['manager', 'executor']);
});

test('a trading manager retains exact fixed research without copying its source graph or giving tools to the executor', async t => {
  const f = await fixture(t);
  const rows = [{ question: 'Observed fictional evidence', as_of: '2026-10-13', summary: 'Do not increase exposure without a new confirmation.',
    members: [{ role: 'researcher', markdown: 'Complete recorded research evidence.\n'.repeat(20000) }], source_refs: [] }];
  assert.ok(Buffer.byteLength(JSON.stringify(rows)) > 512 * 1024, 'A complete result can exceed the old copied trade-evidence budget');
  const directory = await f.host.resources.create({ kind: 'directory', lifetime: 'durable', name: 'fixed-research' });
  await f.host.resources.create({ kind: 'file', lifetime: 'durable', parent: directory, name: 'rows.json', source: { content: JSON.stringify(rows) } });
  const { ref } = await f.host.resources.publish(directory, { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', rowCount: rows.length, provenance: { kind: 'derived' } }, dependencies: [], blobs: [{ path: 'rows.json', mediaType: 'application/json' }] });
  f.artifacts.get(ref.id).producer = { id: 'custom/research', version: 'fixture', digest: 'research-v1' };
  const plan = await f.runtime.configure(f.main, f.input({ research_refs: [ref] }));
  assert.deepEqual(plan.researchRefs, [ref]);
  const run = f.runtime.trigger(plan.id, { kind: 'manual', id: 'consume-fixed-research' });
  await f.waitFor(() => f.active('manager').length === 1);
  const manager = f.active('manager')[0];
  assert.deepEqual(manager.request.input.research_refs, [ref]);
  assert.equal(manager.request.plugins.includes('custom/research'), false);
  assert.equal(manager.request.plugins.includes('sesame/reports'), false);
  assert.equal(manager.request.allowedCalls.some(call => call.capabilityId === 'lookup'), false);
  assert.ok(manager.request.allowedCalls.some(call => call.capabilityId === 'data_read'));
  await f.call('context', f.child(manager.id), run.id);
  await f.call('decide', f.child(manager.id), run.id, unchanged);
  assert.deepEqual(f.runtime.run(run.id).decision.research_refs, [ref]);
  assert.deepEqual(f.runtime.run(run.id).evidence, [], 'Published research is referenced, not duplicated as bounded trade evidence');
  f.finish(manager.id, '## 交易经理总结\n依据固定研究保持仓位，当前未宣称成交。');
  await f.waitFor(() => f.active('executor').length === 1);
  const executor = f.active('executor')[0];
  assert.deepEqual(executor.request.allowedCalls, [{ pluginId: 'sesame/trading-decision', capabilityId: 'trading_decision_apply' }]);
  await f.call('apply', f.child(executor.id), run.id); f.finish(executor.id);
  await f.waitFor(() => f.runtime.run(run.id).status === 'completed' && f.runtime.running.size === 0);
  assert.deepEqual(f.requests.map(request => request.input.role), ['manager', 'executor']);
  assert.deepEqual((await f.report(run.id)).decision.research_refs, [ref]);
  assert.equal(f.brokerCalls.some(call => call.name === 'lookup'), false);
  assert.deepEqual(taskTools(plan, 'executor'), ['trading_decision_apply']);
  assert.equal(taskPlugins(plan, 'manager').includes('sesame/data-access'), true);
});

test('partial research references and research-only role overrides are rejected before creating a plan', async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.configure(f.main, f.input({ research_refs: [{ id: 'missing-version', kind: 'data' }] })), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.runtime.configure(f.main, f.input({ agent_models: { news: f.models[0] } })), { code: 'INVALID_ARGUMENT' });
  assert.equal(f.storage.list('plans').length, 0); assert.equal(f.requests.length, 0);
});

for (const scenario of [{execute:false,verdict:'allow',disposition:'decision_only'}, {execute:true,verdict:'block',disposition:'withheld_by_review'}]) test(`custom trading review ${scenario.disposition} cannot reach execution`, async t => {
  const f = await fixture(t);
  const plan = await f.runtime.configure(f.main, f.input({ workflow: { reviews: [{ id:'concentration',instructions:'Check concentration before a target is saved.' }], execute:scenario.execute } }));
  const run = f.runtime.trigger(plan.id,{kind:'manual',id:scenario.disposition});
  await f.waitFor(()=>f.active('concentration').length===1);
  const reviewer=f.active('concentration')[0],child=f.child(reviewer.id);
  const tools=reviewer.request.allowedCalls.map(call=>call.capabilityId);
  assert.ok(tools.includes('trading_decision_check'));
  for(const forbidden of ['trading_decision_decide','trading_decision_apply','fixture_apply','trading_decision_review'])assert.equal(tools.includes(forbidden),false);
  await assert.rejects(f.call('decide',child,run.id,unchanged),{code:'FORBIDDEN'});
  await assert.rejects(f.runtime.decide(f.main,run.id,unchanged),{code:'NO_REVIEW'});
  const value=await f.call('checkReview',child,run.id,{verdict:scenario.verdict,reason:'The fixed evidence supports this explicit test outcome.'});
  assert.equal(value.verdict,scenario.verdict);
  assert.throws(()=>f.call('checkReview',child,run.id,{verdict:scenario.verdict==='allow'?'block':'allow',reason:'Changed'}),{code:'REVIEW_FROZEN'});
  f.finish(reviewer.id,'## Concentration\nActual review retained for the manager.');
  await f.waitFor(()=>f.active('manager').length===1);
  const manager=f.active('manager')[0];
  assert.equal(manager.request.input.review_checks.concentration.verdict,scenario.verdict);
  assert.match(manager.request.input.preceding_reviews[0].text,/Actual review retained/);
  await f.call('context',f.child(manager.id),run.id);await f.call('decide',f.child(manager.id),run.id,unchanged);f.finish(manager.id,'## Decision\nThis delivery contains a target decision, with no execution claim.');
  await f.waitFor(()=>f.runtime.run(run.id).status==='completed'&&f.runtime.running.size===0);
  const done=f.runtime.run(run.id);
  assert.equal(done.executionDisposition,scenario.disposition);assert.equal(done.execution,undefined);
  assert.deepEqual(f.requests.map(request=>request.input.role),['concentration','manager']);
  assert.equal(f.brokerCalls.some(call=>call.name==='fixture_apply'),false);
  await assert.rejects(f.runtime.apply(f.main,run.id),{code:'EXECUTION_NOT_AUTHORIZED'});
  assert.equal((await f.report(run.id)).plan.workflow.execute,scenario.execute);
});

test('custom trading recovery retains its completed review and resumes the accepted manager', async t => {
  const f=await fixture(t),plan=await f.runtime.configure(f.main,f.input({workflow:{reviews:[{id:'reviewer'}],execute:false}}));
  const run=f.runtime.trigger(plan.id,{kind:'manual',id:'custom-review-resume'});
  await f.waitFor(()=>f.active('reviewer').length===1);const reviewer=f.active('reviewer')[0];
  await f.call('checkReview',f.child(reviewer.id),run.id,{verdict:'allow',reason:'Frozen synthetic review'});f.finish(reviewer.id,'Retained review');
  await f.waitFor(()=>f.active('manager').length===1);const manager=f.active('manager')[0];
  await f.waitFor(()=>f.runtime.run(run.id).tasks.some(task=>task.id===manager.id));
  f.runs.interrupt(manager.id,{reason:'Synthetic resumable model interruption'});
  await f.waitFor(()=>f.runtime.run(run.id).status==='interrupted'&&f.runtime.running.size===0);
  const frozen=structuredClone(f.runtime.run(run.id)),hostRun=f.runs.read(frozen.workflow.id);
  await f.restart();assert.deepEqual(f.runtime.run(run.id).plan.workflow,frozen.plan.workflow);
  await f.runs.resume(hostRun.id,{interruptIds:hostRun.interrupts.filter(item=>!item.resolvedAt).map(item=>item.id),response:'Synthetic dependency restored'});
  await f.waitFor(()=>f.active('manager').some(job=>job.id===manager.id));
  await f.call('context',f.child(manager.id),run.id);await f.call('decide',f.child(manager.id),run.id,unchanged);f.finish(manager.id,'Decision only, no order');
  await f.waitFor(()=>f.runtime.run(run.id).status==='completed'&&f.runtime.running.size===0);
  const done=f.runtime.run(run.id);
  assert.deepEqual(done.reviewChecks,frozen.reviewChecks);assert.equal(done.workflow.id,frozen.workflow.id);
  assert.deepEqual(done.tasks.map(task=>task.id),frozen.tasks.map(task=>task.id));
  assert.equal(f.requests.filter(request=>request.input.role==='reviewer').length,1);
  assert.equal(done.executionDisposition,'decision_only');assert.equal(done.execution,undefined);
});

test('trading validates the actual IR result protocol and rejects undeclared research producers before saving', async t => {
  const f = await fixture(t);
  f.entries.push({ id: 'sesame/investment-research', state: 'mounted', digest: 'research-contract', tools: [], artifactSchemas: [{ id: 'research-data', kind: 'data', schemaVersion: '1.0.0', schema: { type: 'object' } }] });
  const root = await f.host.resources.create({ kind: 'directory', lifetime: 'durable', name: 'wrong-protocol' });
  await f.host.resources.create({ kind: 'file', lifetime: 'durable', parent: root, name: 'rows.json', source: { content: '[{"type":"not-investment-research","summary":"Typed text is not the protocol"}]' } });
  const { ref } = await f.host.resources.publish(root, { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', rowCount: 1, columns: ['type', 'summary'], provenance: { kind: 'demo' } }, dependencies: [], blobs: [{ path: 'rows.json', mediaType: 'application/json' }] });
  f.artifacts.get(ref.id).producer = { id: 'sesame/investment-research', version: 'fixture', digest: 'research-contract' };
  await assert.rejects(f.runtime.configure(f.main, f.input({ research_refs: [ref] })), { code: 'INVALID_RESEARCH_RESULT' });
  f.artifacts.get(ref.id).producer = { id: 'custom/research', version: 'fixture', digest: 'research-v1' };
  f.entries.find(entry => entry.id === 'custom/research').artifactSchemas = [];
  await assert.rejects(f.runtime.configure(f.main, f.input({ research_refs: [ref] })), { code: 'INVALID_RESEARCH_RESULT' });
  assert.equal(f.storage.list('plans').length, 0); assert.equal(f.requests.length, 0);
});
