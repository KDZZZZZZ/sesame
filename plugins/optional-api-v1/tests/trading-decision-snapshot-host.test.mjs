import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { respond, taskInput, toolResponses } from './fixtures/trading-agent-model.mjs';

const root = process.env.SESAME_HOST_ROOT ?? fileURLToPath(new URL('../../../../mt5agent/', import.meta.url));
const fixturePath = join(root, 'tests/fixture-provider.js');

test('a bound MT5 workflow reads its account, saves a decision from frozen external research and archives the report', {
  timeout: 180000, skip: !process.env.SESAME_HOST_ROOT && !existsSync(fixturePath) && 'requires the Sesame host checkout',
}, async t => {
  process.env.SESAME_OPTIONAL_PLUGINS_DIR ??= fileURLToPath(new URL('../packages/', import.meta.url));
  const { fixture, eventually } = await import(pathToFileURL(fixturePath));
  const { createTools } = await import(pathToFileURL(join(root, 'modules/agent/tools.js')));
  const { createHostContextV2 } = await import(pathToFileURL(join(root, 'modules/plugins/host-v2/context.js')));
  const summary = 'The simulated account holds its current allocation after review of the fixed research.';
  const decision = { unchanged: true, targets: [], pause_strategies: [], rationale: summary, evidence_dataset_ids: [] };
  const app = await fixture({
    optionalPlugins: ['mt5', 'portfolio-execution', 'trading-decision', 'investment-research'], reportRenderer: 'electron',
    responseHandler(body, response) {
      const input = taskInput(body);
      if (input?.role !== 'manager') return false;
      const results = toolResponses(body);
      const steps = [
        { name: 'data_read', arguments: { ref: input.research_refs[0], limit: 1 } },
        { name: 'trading_decision_context', arguments: { run_id: input.runId, section: 'account' } },
        { name: 'trading_decision_decide', arguments: { run_id: input.runId, decision } },
      ];
      const failure = results.find(result => result.value?.error);
      const next = steps.find(step => !results.some(result => result.name === step.name));
      respond(response, failure ? JSON.stringify(failure.value.error) : summary, failure ? undefined : next);
      return true;
    },
  });
  t.after(() => app.dispose());
  const { runtime } = app;
  for (const plugin of ['sesame/portfolio-execution', 'sesame/trading-decision', 'sesame/investment-research']) runtime.plugins.activate('conv_main', plugin);
  const producer = runtime.plugins.entry('sesame/investment-research');
  const { publishPacket } = await import(pathToFileURL(join(producer.root, 'src/artifacts.js')));
  const researchRef = await publishPacket(createHostContextV2(runtime, producer, 'conv_main'), {
    type: 'sesame.investment-research.result', schemaVersion: '1.0.0', status: 'complete', title: 'Synthetic research',
    question: 'What do these simulated observations support?', as_of: '2026-11-24', subjects: ['FIXTURE'], summary,
    workflow: { stages: [[{ id: 'reviewer', role: 'manager' }]], synthesis: 'reviewer' },
    members: [{ role: 'reviewer', markdown: summary, source_refs: [], run_ref: { id: 'fixture-research-run' } }], source_refs: [],
  }, 'fixture-publish-research');
  const account = { login: 42, server: 'Snapshot-Fixture' };
  app.mt5.official.config.account = { ...account };
  const native = {
    account_info: { ...account, balance: 10000, equity: 10000, currency: 'USD' },
    terminal_info: { connected: true }, positions_get: [], orders_get: [], history_deals_get: [], history_orders_get: [],
  };
  const reads = [];
  app.mt5.official.call = async ({ tool }, sessionId) => {
    assert.ok(Object.hasOwn(native, tool), `Unexpected native operation: ${tool}`);
    reads.push({ tool, sessionId });
    return { status: 'returned', result: { result: structuredClone(native[tool]) } };
  };
  const main = async (name, args = {}, owner = 'conv_main') => {
    const tool = createTools(runtime, owner).find(item => item.name === name);
    assert.ok(tool, name);
    const result = await tool.execute(randomUUID(), args);
    assert.ok(!result.isError, JSON.stringify(result));
    return result.details;
  };
  const execution = await main('portfolio_execution_configure', { id: 'bound-fixture', backend: 'mt5' });
  await main('portfolio_execution_configure', { id: 'another-binding', backend: 'mt5' });
  const otherOwner = runtime.createConversation('orchestrator', 'Other fixture owner', null);
  runtime.plugins.activate(otherOwner.id, 'sesame/portfolio-execution');
  runtime.plugins.activate(otherOwner.id, 'sesame/mt5');
  await main('portfolio_execution_configure', { id: 'other-owner', backend: 'mt5' }, otherOwner.id);
  const { models } = await main('trading_decision_models');
  const { provider, id, configurationDigest } = models.find(row => row.provider === 'fixture');
  const plan = await main('trading_decision_plan', { action: 'save', plan: {
    title: 'Bound snapshot', model: { provider, id, configurationDigest }, execution, workflow: { execute: false }, research_refs: [researchRef],
  } });
  assert.equal(plan.account.accountId, '42');

  // Substitute inputs at the genuine nested call site, while the host owns
  // the workflow identity, session, active call chain and disjoint owners.
  const invoke = runtime.capabilities.invoke.bind(runtime.capabilities);
  const contextCapability = 'sesame/portfolio-execution#portfolio_execution_context';
  const applyCapability = 'sesame/portfolio-execution#portfolio_execution_apply';
  let receivedSnapshot;
  t.mock.method(runtime.capabilities, 'invoke', async (cap, input, options, actor) => {
    if (cap === contextCapability && input.action === 'snapshot' && actor?.kind === 'subagent' && !receivedSnapshot) {
      const probe = async (target, args) => {
        const receipt = await invoke(target, args, { ...options, operationId: randomUUID() }, actor);
        if (receipt.type === 'run') {
          runtime.runs.activatePreparedChild(receipt.run.id, actor.runId);
          const { run, reason } = await runtime.runs.wait(receipt.run.id, { timeoutMs: 10000 });
          assert.equal(reason, 'settled', JSON.stringify({ target, status: run.status, error: run.error, interrupts: run.interrupts }));
          if (run.status !== 'completed') throw Object.assign(new Error(run.error?.message ?? run.status), { code: run.error?.code });
        }
        return receipt;
      };
      await assert.rejects(probe(cap, { ...input, binding_id: 'another-binding' }), { code: 'FORBIDDEN' }, 'Other binding');
      await assert.rejects(probe(cap, {
        ...input, binding_id: 'other-owner', frozen_context: { ...input.frozen_context, bindingId: 'other-owner' },
      }), { code: 'FORBIDDEN' }, 'Other owner');
      await assert.rejects(probe(applyCapability, { binding_id: 'bound-fixture', run: {
        id: 'workflow-write', decidedAt: Date.now(),
        plan: { id: plan.id, account: plan.account, ownerConversationId: 'conv_main', slippageBps: 0 },
        decision: { unchanged: true, targets: [], pause_strategies: [] },
      } }), { code: 'FORBIDDEN' }, 'Workflow apply');
      assert.equal(reads.length, 0, 'Denied requests must not reach the native transport.');
      const receipt = await invoke(cap, input, options, actor);
      receivedSnapshot = receipt.value;
      return receipt;
    }
    return invoke(cap, input, options, actor);
  });
  const started = await main('trading_decision_run', { plan_id: plan.id, request_id: 'read-bound-snapshot' });
  const observed = await eventually(() => {
    const workflow = runtime.runs.list({ kind: 'workflow' }).find(row => row.capabilityId === 'sesame/trading-decision#trading_decision_workflow_execute');
    if (!workflow) return false;
    const calls = reads.filter(row => row.sessionId === workflow.executionSessionId);
    return workflow.status === 'interrupted' || receivedSnapshot
      ? { workflow, calls } : false;
  });
  assert.deepEqual(observed.calls.map(row => row.tool), Object.keys(native), JSON.stringify(observed.workflow.interrupts));
  assert.deepEqual(receivedSnapshot.account, plan.account);
  assert.deepEqual(receivedSnapshot.summary, native.account_info);
  const result = await eventually(async () => {
    const run = await main('trading_decision_runs', { action: 'read', run_id: started.id });
    return (run.report || run.reportError || ['interrupted', 'failed', 'cancelled'].includes(run.status)) && run;
  }, 60000);
  assert.deepEqual(result.decision?.research_refs, [researchRef], JSON.stringify(result.reports));
  assert.deepEqual(result.tasks.map(task => task.role), ['manager']);
  const manager = Object.values(result.taskRequests).find(request => request.input.role === 'manager');
  assert.ok(!manager.plugins.includes(producer.id));
  assert.ok(!manager.allowedCalls.some(call => call.pluginId === producer.id));
  assert.equal(result.executionDisposition, 'decision_only');
  assert.equal(result.execution, undefined);
  assert.equal(result.status, 'completed', JSON.stringify(result.reportError ?? result.error));
  assert.equal(result.report?.renderStatus, 'rendered');
  const archive = await createHostContextV2(runtime, runtime.plugins.entry('sesame/trading-decision'), 'conv_main')
    .resources.read(result.report.ref, { part: 'content', entry: 'run.json' });
  assert.deepEqual(JSON.parse(archive.content).decision.research_refs, [researchRef]);
  const target = runtime.reportLibrary.boundTarget(runtime.runs.read(result.workflow.id).executionSessionId);
  assert.equal(target.space, 'research');
  assert.ok(target.path.startsWith(plan.reportFolder + '/'));
  assert.match((await runtime.reportLibrary.read(target)).content, /Bound snapshot/);
});
