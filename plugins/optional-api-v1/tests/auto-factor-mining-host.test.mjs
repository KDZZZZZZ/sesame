// Actual Store, Runtime, package manager and tool-enabled Agent loop. Only the
// model transport is a local deterministic SSE fixture; all prices are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const pluginId = 'sesame/auto-factor-mining';
const roles = ['supervisor', 'researcher', 'coder', 'reviewer', 'reflector'];
const packageRoot = fileURLToPath(new URL('../packages/auto-factor-mining/', import.meta.url));
let sequence = 0;

function respond(response, model, text, tool) {
  const delta = tool
    ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_factor_fixture_${++sequence}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] }
    : { role: 'assistant', content: text };
  const chunk = (value, reason) => JSON.stringify({ id: 'factor-local-fixture', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: value, finish_reason: reason }] });
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, tool ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
}

function textContent(content) {
  return typeof content === 'string' ? content : content?.map(part => part.text ?? '').join('') ?? '';
}

function taskInput(body) {
  for (const message of body.messages.filter(message => message.role === 'user').toReversed()) {
    const text = textContent(message.content), marker = '\n\nInput JSON:\n', index = text.lastIndexOf(marker);
    if (index >= 0) return JSON.parse(text.slice(index + marker.length));
  }
  return null;
}

function toolOutputs(body) {
  const calls = new Map(body.messages.flatMap(message => message.tool_calls ?? []).map(call => [call.id, call.function.name]));
  return body.messages.filter(message => message.role === 'tool').map(message => {
    const name = calls.get(message.tool_call_id), raw = textContent(message.content);
    try { return { name, value: JSON.parse(raw) }; }
    catch { throw new Error(`${name} returned non-JSON tool error: ${raw}`); }
  });
}

const date = day => `2025-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const datasetConfig = { trainEnd: date(6), validationEnd: date(12), holdoutEnd: date(18), horizon: 1, costBps: 10, quantile: 0.25 };
function syntheticRows() {
  return Array.from({ length: 18 }, (_, day) => Array.from({ length: 4 }, (_, symbol) => ({
    time: date(day + 1), availableAt: date(day + 1), symbol: `FICTIONAL_${symbol}`,
    fields: { close: 100 * (1 + (symbol + 1) * .005) ** day, volume: 1000 * (symbol + 1) + day, feature: symbol + 1 },
  }))).flat();
}

test('installed factor workflow executes parallel research with role models, archives actual evidence and resumes after Store reopen', { skip: !hostRoot, timeout: 300000 }, async t => {
  const load = relative => import(pathToFileURL(join(hostRoot, relative)));
  const { fixture, eventually } = await load('tests/fixture-provider.js');
  const { createTools } = await load('modules/agent/tools.js');
  const { createHostContextV2: createHostContext } = await load('modules/plugins/host-v2/context.js');
  const { Store } = await load('modules/agent/store.js');
  const { Runtime } = await load('modules/agent/runtime.js');
  const observations = [], observedData = [], failures = [], held = [];
  let holdCode = false, reopenedRuntime, reopenedStore, primaryError, cleanupError, testStage = 'installation';
  const app = await fixture({ responseHandler: (body, response) => {
    try {
      const input = taskInput(body);
      if (!input?.runId) { respond(response, body.model, 'Local fixture ready.'); return true; }
      assert.equal(body.model, `factor-${input.role}`, 'Every role must reach its selected model transport.');
      const expectedTools = ['auto_factor_context', 'auto_factor_submit', 'host_resources_read', 'host_runs_interrupt', 'host_runs_read', 'host_runs_wait'];
      assert.deepEqual(body.tools.map(tool => tool.function.name).sort(), expectedTools.sort());
      for (const tool of body.tools) assert.equal(tool.function.parameters.type, 'object');
      observations.push({ ...input, model: body.model });
      if (holdCode && input.mode === 'code') {
        held.push(response);
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(`data: ${JSON.stringify({ id: 'factor-held-fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
          choices: [{ index: 0, delta: { role: 'assistant', content: '**公开协作进度**：已收到本轮假设，等待测试继续。' }, finish_reason: null }] })}\n\n`);
        return true;
      }
      const outputs = toolOutputs(body);
      const call = (name, args = {}) => respond(response, body.model, null, { name, arguments: { run_id: input.runId, ...args } });
      if (input.mode === 'report') {
        if (!outputs.some(item => item.name === 'auto_factor_report')) call('auto_factor_report');
        else { assert.equal(outputs.at(-1).value.state, 'archived'); respond(response, body.model, '真实研究记录已归档；数据及模型行为均为本地测试夹具。'); }
        return true;
      }
      if (input.mode === 'finalize') {
        if (!outputs.some(item => item.name === 'auto_factor_finalize')) call('auto_factor_finalize');
        else respond(response, body.model, 'Selected evaluator finalized the frozen candidates.');
        return true;
      }
      const contexts = outputs.filter(item => item.name === 'auto_factor_context');
      if (!contexts.length) { call('auto_factor_context', { section: 'team', limit: 20 }); return true; }
      const context = contexts[0].value;
      assert.equal(context.assignment.mode, input.mode);
      assert.equal(context.assignment.role, input.role);
      assert.equal(context.runId, input.runId);
      if (input.mode === 'code') {
        const pages = contexts.filter(item => item.value.rows);
        if (!pages.length) { call('auto_factor_context', { section: 'data', offset: 0, limit: 3 }); return true; }
        for (const page of pages) {
          assert.equal(page.value.rows.total, 48);
          assert.ok(page.value.rows.items.every(row => row.time <= datasetConfig.validationEnd));
          observedData.push(page.value.rows.items);
        }
        if (pages.length === 1) { call('auto_factor_context', { section: 'data', offset: pages[0].value.rows.nextOffset, limit: 3 }); return true; }
      }
      if (outputs.some(item => item.name === 'auto_factor_submit')) { respond(response, body.model, `已保存结构化 ${input.mode}，不以文字替代计算。`); return true; }
      let output;
      switch (input.mode) {
        case 'plan': output = { directions: context.config.directions, stop: false, reason: '仅按冻结条件测试虚构正向和反向信号。' }; break;
        case 'hypothesis': output = { hypothesis: `虚构 ${input.direction} 假设`, rationale: 'feature 是预先给定的组别，不使用未来价格；此结果不能外推至市场。' }; break;
        case 'code': output = { candidate: input.direction === '反向对照' ? { op: 'neg', args: [{ op: 'field', name: 'feature' }] } : { op: 'field', name: 'feature' }, explanation: '使用固定 AST 实现可修改基线，指标由引擎计算。' }; break;
        case 'review': {
          const validation = context.trial.metrics.validation;
          assert.ok(Number.isFinite(validation.rankIC));
          assert.ok(validation.coverage > .6);
          assert.equal(Math.sign(validation.rankIC), input.direction === '反向对照' ? -1 : 1);
          assert.equal(context.trial.metrics.holdout, undefined, 'Reviewer must not see holdout evaluation.');
          output = { verdict: input.direction === '反向对照' ? 'reject' : 'accept', reason: `实测验证 rankIC=${validation.rankIC}，仅为虚构样本诊断。` };
          break;
        }
        case 'reflection': output = { summary: '正向因子在虚构固定样本通过，反向对照被否决；全部试验保留。', lessons: ['未来独立数据才可检验泛化。'], stop: false }; break;
        case 'selection': output = { trialIds: context.trials.items.filter(trial => trial.status === 'accepted').map(trial => trial.id), reason: '仅冻结已通过开发集门槛的候选，此时未读取留出集。' }; break;
        default: throw new Error(`Unexpected fixture mode ${input.mode}`);
      }
      call('auto_factor_submit', { output });
      return true;
    } catch (error) {
      failures.push(error);
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error.message } }));
      return true;
    }
  } });
  try {
    const modelRuntime = app.runtime.modelRuntime;
    modelRuntime.registerProvider('fixture', { baseUrl: app.modelUrl, api: 'openai-completions', apiKey: 'local-fixture-only',
      models: ['fixture', ...roles.map(role => `factor-${role}`)].map(id => ({ id, name: id, reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })) });
    const evaluatorDraft = join(app.runtime.workspaces.root('conv_main'), 'evaluator-draft');
    await cp(fileURLToPath(new URL('../packages/factor-evaluator/', import.meta.url)), evaluatorDraft, { recursive: true });
    const evaluatorChecked = await app.runtime.plugins.manager.test('conv_main', { path: evaluatorDraft });
    assert.equal(evaluatorChecked.passed, true, JSON.stringify(evaluatorChecked));
    const evaluatorInstalled = await app.runtime.plugins.manager.install('conv_main', { path: evaluatorDraft, digest: evaluatorChecked.digest });
    assert.equal(evaluatorInstalled.runtime_status, 'ready', JSON.stringify(evaluatorInstalled.diagnostics));
    const draft = join(app.runtime.workspaces.root('conv_main'), 'factor-draft');
    await cp(packageRoot, draft, { recursive: true });
    const checked = await app.runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(checked.passed, true, JSON.stringify(checked));
    const installed = await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
    assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
    app.runtime.plugins.activate('conv_main', installed.id);
    assert.ok(app.runtime.plugins.services.has(pluginId));
    const invoke = async (runtime, conversationId, name, args = {}) => {
      const tool = createTools(runtime, conversationId).find(value => value.name === name);
      assert.ok(tool, `Tool missing: ${name}`);
      const result = await tool.execute(`factor-host-${++sequence}`, args);
      assert.notEqual(result.isError, true, JSON.stringify(result));
      if (result.details?.type !== 'run') return result.details;
      const settled = await runtime.runs.wait(result.details.run.id, { timeoutMs: 30000 });
      if (settled.run.status !== 'completed') throw new Error(settled.run.error?.message ?? settled.run.status);
      return settled.run.output;
    };
    const main = (name, args) => invoke(app.runtime, 'conv_main', name, args);
    const manifest = JSON.parse(await readFile(join(packageRoot, 'capabilities.json')));
    const visible = createTools(app.runtime, 'conv_main').map(tool => tool.name);
    for (const capability of manifest.capabilities.filter(value => value.consumers.includes('agent'))) assert.ok(visible.includes(capability.id), capability.id);
    const outsider = app.runtime.createConversation('fixture', 'Unassigned research task', 'conv_main');
    app.runtime.plugins.activate(outsider.id, pluginId);
    const mainHost = createHostContext(app.runtime, app.runtime.plugins.entry(pluginId), 'conv_main');
    const available = await main('auto_factor_models');
    const byRole = Object.fromEntries(roles.map(role => [role, available.models.find(model => model.id === `factor-${role}`)]));
    for (const model of Object.values(byRole)) assert.match(model.configurationDigest, /^sha256:/);
    const rows = syntheticRows();
    app.store.put('dataset', { id: 'factor-fictional-data', title: 'Invented panel for integration test only', rows, provenance: { kind: 'demo', source_kind: 'synthetic' } });
    const input = { request_id: 'parallel-fixture', title: '本地虚构因子研究', goal: '验证真实宿主多角色工具循环，不检验市场收益。', dataset_id: 'factor-fictional-data',
      config: { model: byRole.supervisor, agentModels: byRole, directions: ['正向组别', '反向对照'], rounds: 1, maxTrials: 2, parallelism: 2, evaluator: { plugin_id: 'sesame/factor-evaluator', tool: 'factor_evaluate', arguments: { dataset: datasetConfig } } } };
    testStage = 'first-run';
    const created = await main('auto_factor_start', input);
    await assert.rejects(() => main('factor_evaluate', { protocol: 'sesame.factor-evaluator/v1', action: 'prepare', run_id: created.id, dataset_id: input.dataset_id,
      access: 'restricted', options: { dataset: datasetConfig } }), /nested workflow/);
    const activity = await main('auto_factor_activity', { run_id: created.id });
    assert.equal(activity.opened, true); assert.equal(typeof activity.runId, 'string');
    const finish = async (runtime, id) => {
      const run = await eventually(async () => {
        if (failures.length) throw failures[0];
        const value = await invoke(runtime, 'conv_main', 'auto_factor_runs', { action: 'read', run_id: id });
        assert.notEqual(value.status, 'interrupted', JSON.stringify({ error: value.error, tasks: value.tasks, trials: value.trials }));
        return (value.report || value.reportError) && value.tasks.every(task => task.finishedAt) && runtime.agentTasks.running.size === 0 &&
          ['completed', 'cancelled', 'unknown'].includes(runtime.runs.read(value.workflow.id).status) ? value : false;
      }, 120000);
      assert.equal(run.status, 'completed', JSON.stringify({ error: run.error, tasks: run.tasks, trials: run.trials }));
      assert.equal(run.reportPending, false, JSON.stringify(run.reportError));
      return run;
    };
    await assert.rejects(() => invoke(app.runtime, outsider.id, 'auto_factor_context', { run_id: created.id, section: 'team' }), /registered running Agent/);
    await assert.rejects(() => main('auto_factor_submit', { run_id: created.id, output: { directions: [], stop: true, reason: 'Main is not the assigned supervisor.' } }), /registered running Agent|active unfrozen|structured/i);
    const done = await finish(app.runtime, created.id);
    assert.deepEqual(done.trials.map(trial => trial.status).sort(), ['accepted', 'rejected']);
    const parallelHypotheses = done.tasks.filter(task => task.mode === 'hypothesis');
    assert.equal(parallelHypotheses.length, 2);
    assert.ok(Math.max(...parallelHypotheses.map(task => task.createdAt)) <= Math.min(...parallelHypotheses.map(task => task.finishedAt)), 'Both research directions were dispatched before either finished.');
    assert.deepEqual(new Set(done.tasks.map(task => task.mode)), new Set(['plan', 'hypothesis', 'code', 'review', 'reflection', 'selection']));
    assert.ok(done.tasks.every(task => task.status === 'completed'));
    for (const task of done.tasks) assert.deepEqual(task.model, byRole[task.role]);
    assert.ok(done.tasks.every(task => task.runRef && app.runtime.runs.read(task.runRef.id).capabilityId === 'host.agent.run'), 'Every research role owns a tracked Agent Run.');
    const workflow = app.runtime.runs.read(done.workflow.id);
    assert.equal(workflow.kind, 'workflow'); assert.equal(workflow.status, 'completed'); assert.notEqual(workflow.executionSessionId, 'conv_main');
    assert.ok(done.tasks.every(task => app.runtime.runs.read(task.runRef.id).parentRunId === workflow.id));
    assert.ok(app.runtime.runs.readHistory(workflow.id, { type: 'handoff' }).items.some(event => event.data.fromRunId && event.data.toRunId));
    assert.equal(done.selection.trialIds.length, 1);
    assert.ok(Number.isFinite(done.holdout[done.selection.trialIds[0]].rankIC));
    assert.ok(observedData.length > 0);
    assert.equal(app.runtime.messages('conv_main').filter(message => message.role === 'user').length, 0, 'Background research creates no fake user messages.');
    testStage = 'archive';
    const files = { list: options => app.runtime.reportLibrary.list({ space: 'research', ...options }), read: options => app.runtime.reportLibrary.read({ space: 'research', ...options }) };
    await app.runtime.reportLibrary.flush();
    assert.equal((await files.list({ recursive: true })).entries.filter(entry => entry.path.endsWith('.html')).length, 1);
    const target = app.runtime.reportLibrary.boundTarget(workflow.executionSessionId);
    const html = await files.read({ path: target.path });
    assert.match(html.content, /<!doctype html>/i);
    assert.ok(html.content.includes(done.id));
    const attachment = async name => {
      let offset=0, parts=[];
      for (;;) { const part=await mainHost.resources.read(done.report.ref,{part:'content',entry:name,offset,encoding:'base64'});parts.push(Buffer.from(part.content,'base64'));if(part.nextOffset===undefined)break;offset=part.nextOffset; }
      return JSON.parse(Buffer.concat(parts).toString());
    };
    const evidence = await attachment('run.json');
    assert.deepEqual(evidence.selection, done.selection);
    assert.deepEqual(evidence.trials, done.trials);
    const frozenDataset = await attachment('dataset.json');
    assert.deepEqual(frozenDataset.dataset.rows, rows);
    const factors = await attachment('factors.json');
    assert.equal(factors.factors.length, 1);
    assert.deepEqual(factors.factors[0].candidate, done.trials.find(trial => trial.status === 'accepted').candidate);
    assert.equal((await mainHost.resources.read(done.report.ref, { part: 'manifest' })).kind, 'report');
    testStage = 'idempotency';
    const requestCount = observations.length;
    assert.equal((await main('auto_factor_start', input)).id, done.id);
    assert.equal(observations.length, requestCount, 'Request retry does not repeat research.');
    assert.deepEqual((await main('auto_factor_report', { run_id: done.id })).ref, done.report.ref);
    assert.equal((await files.read({ path: target.path })).content, html.content);

    // Pause after a durable hypothesis. Reopen the actual SQLite Store and
    // Runtime; explicit resume continues the same accepted Agent and workflow.
    testStage = 'second-run-start';
    holdCode = true;
    const second = await main('auto_factor_start', { ...input, request_id: 'resume-fixture', title: '暂停及重开测试', config: { ...input.config, directions: ['正向组别'], maxTrials: 1 } });
    await eventually(() => held.length > 0, 20000);
    const streaming = await eventually(async () => {
      const value = await main('auto_factor_runs', { action: 'read', run_id: second.id });
      const task = value.tasks.find(task => task.role === 'coder');
      if (!task) return false;
      const actual = app.runtime.runs.read(task.runRef.id), session = actual.executionSessionId;
      return session && app.runtime.messages(session).some(message => JSON.stringify(message).includes('公开协作进度')) ? actual : false;
    }, 10000);
    assert.equal(streaming.status, 'running');
    assert.equal(app.runtime.runs.read((await main('auto_factor_runs', { action: 'read', run_id: second.id })).workflow.id).report, undefined, 'An active workflow has no published final report.');
    assert.equal((await files.list({ recursive: true })).entries.filter(entry => entry.path.endsWith('.html')).length, 2, 'The host reserves the next report destination before work begins.');
    testStage = 'pause';
    await main('auto_factor_runs', { action: 'pause', run_id: second.id });
    const paused = await eventually(async () => {
      const value = await main('auto_factor_runs', { action: 'read', run_id: second.id });
      return value.status === 'interrupted' && app.runtime.runs.read(value.workflow.id).status === 'interrupted' ? value : false;
    }, 20000);
    const retainedWorkflow = app.runtime.runs.read(paused.workflow.id), retainedCoder = paused.tasks.find(task => task.mode === 'code').runRef.id;
    assert.ok(paused.tasks.some(task => task.mode === 'hypothesis' && task.output));
    await assert.rejects(main('auto_factor_report', { run_id: second.id }), /no published report/);
    assert.equal((await files.list({ recursive: true })).entries.filter(entry => entry.path.endsWith('.html')).length, 2, 'Interruption retains the host reservation and business checkpoint.');
    const beforeReopen = observations.length;
    testStage = 'reopen';
    await app.close();
    reopenedStore = new Store(join(app.directory, 'app'));
    reopenedRuntime = await new Runtime(reopenedStore, { piDir: app.directory, modelRuntime, model: modelRuntime.getModel('fixture', 'fixture') }).init();
    const reopened = (name, args) => invoke(reopenedRuntime, 'conv_main', name, args);
    assert.equal((await reopened('auto_factor_runs', { action: 'read', run_id: second.id })).status, 'interrupted');
    assert.equal(observations.length, beforeReopen, 'Reopening must not replay paused research.');
    assert.deepEqual((await reopened('auto_factor_runs', { action: 'read', run_id: done.id })).trials, done.trials);
    testStage = 'resume';
    holdCode = false;
    const pending = await reopened('auto_factor_runs', { action: 'read', run_id: second.id });
    assert.equal(pending.interrupts.length, 1);
    const resumeInput = { action: 'resume', run_id: second.id, interrupt_ids: [pending.interrupts[0].id], response: { resolution: 'Fixture stream ready' } };
    await reopened('auto_factor_runs', resumeInput);
    assert.equal(reopenedRuntime.messages('conv_main').filter(message => message.role === 'user').length, 0, 'The main Agent can resolve its technical interruption without manufacturing a user reply.');
    const resumed = await finish(reopenedRuntime, second.id);
    assert.equal(resumed.generation, 0);
    assert.equal(resumed.workflow.id, retainedWorkflow.id);
    assert.equal(reopenedRuntime.runs.read(resumed.workflow.id).executionSessionId, retainedWorkflow.executionSessionId);
    assert.equal(resumed.tasks.filter(task => task.mode === 'hypothesis').length, 1, 'Committed hypothesis is a durable checkpoint.');
    assert.equal(resumed.tasks.filter(task => task.mode === 'code').length, 1, 'An accepted role is resumed, never replaced.');
    assert.equal(resumed.tasks.find(task => task.mode === 'code').runRef.id, retainedCoder);
    assert.equal(reopenedRuntime.runs.read(retainedCoder).executionSessionId, streaming.executionSessionId);
    assert.deepEqual(failures, []);
    t.diagnostic(JSON.stringify({ installation: 'production-manager', modelTransport: 'local-SSE-fixture', marketData: 'invented', completedRuns: 2, roles: roles.length, rejectedTrialsPreserved: 1, sqliteReopened: true, explicitResume: true, vendorCalls: 0, brokerCalls: 0 }));
  } catch (error) {
    primaryError = error;
    try { t.diagnostic(JSON.stringify({ testStage, observed: observations.slice(-3), runs: (reopenedStore ?? app.store).list('run').map(run => ({ id: run.id, capability: run.capabilityId, status: run.status, error: run.error })) })); }
    catch { t.diagnostic(`State diagnostics unavailable; original failure: ${error.message}`); }
    throw error;
  } finally {
    for (const response of held) response.destroy();
    try {
      await reopenedRuntime?.close();
      reopenedStore?.close();
      await app.dispose();
    } catch (error) {
      cleanupError = error;
      if (primaryError) t.diagnostic(`Secondary host cleanup error: ${error.stack}`);
    }
  }
  if (cleanupError) throw cleanupError;
});
