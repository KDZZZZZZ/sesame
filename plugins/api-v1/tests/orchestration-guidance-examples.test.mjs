import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const references = new URL('../packages/orchestration/skills/coordinate-research/references/', import.meta.url);
const integration = (name, run) => test(name, { skip: !hostRoot }, run);
async function example(file, heading) {
  const text = await readFile(new URL(file, references), 'utf8');
  const section = text.split(`### ${heading}\n`)[1]?.split('\n### ')[0];
  assert.ok(section, `${file}: missing ${heading}`);
  const body = /^```json\r?\n([\s\S]*?)^```/m.exec(section)?.[1];
  assert.ok(body, `${heading}: missing JSON input example`);
  return JSON.parse(body);
}
function validator() {
  const require = createRequire(join(hostRoot, 'package.json'));
  const Ajv = require('ajv');
  const ajv = new Ajv({ strict: false });
  return (schema, value) => {
    const validate = ajv.compile(schema);
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    return validate;
  };
}

integration('documented Agent and custom coordination calls match the actual host schemas without runtime side effects', async () => {
  const { createExecutionCapabilities } = await import(pathToFileURL(join(hostRoot, 'modules/plugins/host-v2/execution.js')));
  const { createHostAgentCapabilities } = await import(pathToFileURL(join(hostRoot, 'modules/plugins/host-v2/agent-tools.js')));
  const runtime = new Proxy({}, { get(_target, name) { throw new Error(`Documentation validation must not access runtime.${String(name)}`); } });
  const descriptors = new Map([...createExecutionCapabilities(runtime), ...createHostAgentCapabilities(runtime)].map(item => [item.descriptor.id, item.descriptor]));
  const validate = validator(), agentSchema = descriptors.get('host.agent.run').inputSchema;
  const stage = await example('agent-runs.md', '单阶段调用：host_agent_run');
  const stageCheck = validate(agentSchema, stage);
  assert.equal(stageCheck({ ...stage, dependsOn: ['run_previous'] }), false, 'host Agent input is not an arbitrary DAG');
  const coordinator = await example('workflow-plans.md', '自定义协调者：host_capabilities_invoke');
  const member = await example('workflow-plans.md', '成员绑定：host_capabilities_invoke');
  for (const call of [coordinator, member]) {
    assert.equal(call.id, 'host.agent.run');
    validate(descriptors.get('host.capabilities.invoke').inputSchema, call);
    validate(agentSchema, call.input);
  }
  const granted = new Set(coordinator.input.allowedCalls.map(call => `${call.pluginId}#${call.capabilityId}`));
  for (const id of ['host#agent.run', 'host#capabilities.invoke']) assert.ok(granted.has(id), `coordinator needs ${id}`);
  for (const call of member.input.allowedCalls) assert.ok(granted.has(`${call.pluginId}#${call.capabilityId}`), 'member grants must be within coordinator grants');
  const ids = new Set(coordinator.task.collaboration.agents.map(item => item.id));
  assert.ok(ids.has(member.task.agentId));
  for (const edge of coordinator.task.collaboration.relationships) assert.ok(ids.has(edge.from) && ids.has(edge.to));
  assert.equal(coordinator.input.output.type, 'report');
  assert.deepEqual(member.input.output, { type: 'none' }, 'the example member only prepares evidence for the parent report');
});

integration('documented workflow customizations satisfy both declared schemas and real plan rules', async () => {
  const validate = validator();
  const declaration = async name => JSON.parse(await readFile(new URL(`../../optional-api-v1/packages/${name}/capabilities.json`, import.meta.url), 'utf8'));
  const capability = async (name, id) => (await declaration(name)).capabilities.find(item => item.id === id).inputSchema;
  const { researchPlan } = await import('../../optional-api-v1/packages/investment-research/src/workflow.js');
  const { factorPlan } = await import('../../optional-api-v1/packages/auto-factor-mining/workflow.js');
  const { tradingPlan } = await import('../../optional-api-v1/packages/trading-decision/workflow.js');

  const research = await example('workflow-plans.md', 'Investment Research：workflow');
  validate((await capability('investment-research', 'investment_research_analyze')).properties.workflow, research);
  const normalizedResearch = researchPlan(research);
  assert.deepEqual(normalizedResearch.stages, [['facts', 'method'], ['editor']]);
  assert.equal(normalizedResearch.synthesis, 'editor');

  const factor = await example('workflow-plans.md', 'Auto Factor Mining：config.workflow');
  validate((await capability('auto-factor-mining', 'auto_factor_start')).properties.config.properties.workflow, factor);
  const normalizedFactor = factorPlan(factor);
  assert.equal(normalizedFactor.plan, null);
  assert.equal(normalizedFactor.reflection, null);
  assert.ok(normalizedFactor.hypothesis && normalizedFactor.code && normalizedFactor.selection);

  const trading = await example('workflow-plans.md', 'Trading Decision：plan.workflow');
  const save = (await capability('trading-decision', 'trading_decision_plan')).oneOf.find(branch => branch.properties.action.const === 'save');
  validate(save.properties.plan.properties.workflow, trading);
  const normalizedTrading = tradingPlan(trading);
  assert.equal(normalizedTrading.execute, false, 'a research example must not enable execution');
  assert.deepEqual(normalizedTrading.reviews.map(item => item.id), ['evidence_check', 'risk_check']);
});
