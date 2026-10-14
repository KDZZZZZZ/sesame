#!/usr/bin/env node
/**
 * Real installed host + Team Agent loop + production MT5 reads.
 * Only the loopback model's text/tool-call responses are simulated. No orders.
 *
 * node manual-trading-live-preview.mjs --host-root /path/to/mt5agent \
 *   --terminal D:/mt5/terminal64.exe --python D:/Anaconda/python.exe
 * The default keeps the live activity URL available until Ctrl+C. --once runs
 * the same workflow, verifies its receipts, then removes the temporary profile.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const packageRoot = fileURLToPath(new URL('../packages/manual-trading/', import.meta.url));
const packagesRoot = fileURLToPath(new URL('../packages/', import.meta.url));
const roles = ['market', 'fundamentals', 'news', 'sentiment', 'bull', 'bear', 'risk', 'manager', 'executor', 'reporter'];
const analysts = roles.slice(0, 4);
const previewModels = { market: 'gpt-5.4', fundamentals: 'claude-sonnet-4-5', news: 'grok-4', sentiment: 'gemini-2.5-pro', bull: 'deepseek-chat', bear: 'qwen3', risk: 'claude-sonnet-4-5', manager: 'gpt-5.4', executor: 'gpt-5.4', reporter: 'gemini-2.5-pro' };
const labels = { market: '市场研究', fundamentals: '基本面研究', news: '新闻研究', sentiment: '情绪研究', bull: '多头研究', bear: '空头研究', risk: '风险审阅', manager: '经理', executor: '执行器', reporter: '归档员' };
const marker = '【本地模拟模型响应；工具上下文与工作流真实】';
const textOf = content => typeof content === 'string' ? content : (content ?? []).map(part => part.text ?? '').join('');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export function taskInput(body) {
  const text = textOf(body.messages?.filter(message => message.role === 'user').at(-1)?.content);
  const boundary = '\n\nInput JSON:\n', index = text.lastIndexOf(boundary);
  return index < 0 ? null : JSON.parse(text.slice(index + boundary.length));
}

export function toolResponses(body) {
  const names = new Map((body.messages ?? []).flatMap(message => message.tool_calls ?? []).map(call => [call.id, call.function.name]));
  return (body.messages ?? []).filter(message => message.role === 'tool').map(message => ({ name: names.get(message.tool_call_id), value: JSON.parse(textOf(message.content)) }));
}

function receivedContext(outputs, runId) {
  const pages = outputs.filter(output => output.name === 'manual_trading_context').map(output => output.value);
  for (const page of pages) if (page.runId !== runId || !Number.isSafeInteger(page.capturedAt)) fail('INVALID_CONTEXT', 'The real context tool did not return this run and a capture time.');
  if (!pages.length) return null;
  const last = pages.at(-1), sections = ['positions', 'deployments', 'orders', 'fills', 'historicalOrders', 'reports'];
  const result = { ...pages[0], pages: pages.length };
  for (const section of sections) {
    if (!pages.every(page => Array.isArray(page[section]?.items) && Number.isSafeInteger(page[section]?.total))) fail('INVALID_CONTEXT', `Missing real context section: ${section}`);
    result[section] = { total: last[section].total, items: pages.flatMap(page => page[section].items) };
  }
  const next = sections.map(section => last[section].nextOffset).filter(value => Number.isSafeInteger(value));
  result.nextOffset = next.length ? Math.min(...next) : null;
  return result;
}

function peerReports(context, role) {
  const required = { bull: analysts, bear: [...analysts, 'bull'], risk: [...analysts, 'bull', 'bear'], manager: [...analysts, 'bull', 'bear', 'risk'] }[role] ?? [];
  for (const peer of required) if (!context.reports.items.some(report => report.role === peer && report.status === 'completed' && report.text)) fail('MISSING_PEER_REPORT', `${role} did not receive the completed ${peer} report through manual_trading_context.`);
  return context.reports.items.filter(report => report.status === 'completed').map(report => `${labels[report.role] ?? report.role}（${report.taskId}）：${String(report.text).replaceAll('\n', ' ').slice(0, 140)}`).join('\n');
}

function researchText(role, context) {
  const facts = `账户快照：${new Date(context.capturedAt).toISOString()}\n\n| 持仓 | 未决委托 | 成交历史 | 前序报告 |\n| ---: | ---: | ---: | ---: |\n| ${context.positions.total} | ${context.orders.total} | ${context.fills.total} | ${context.reports.total} |`;
  const peers = peerReports(context, role);
  const observation = {
    market: '本次预览只读取账户与历史，未请求行情/K线数据，不能据此判断趋势或波动。',
    fundamentals: '实际上下文未提供财报、估值或披露数据，基本面结论保留为空。',
    news: '实际上下文未提供新闻来源与发布时间，不生成新闻事件或催化判断。',
    sentiment: '实际上下文未提供分析师或社交样本，不生成情绪评分。',
    bull: '已阅读真实传递的研究报告；现有材料缺少增仓证据，本地模拟观点为保留观察。',
    bear: '已阅读研究报告和多头报告；材料缺口不能证明价格将下跌，不提出减仓目标。',
    risk: '已核对真实账户条目及双方报告。本次预览只演示协作读取，不作资产风险评级，不请求停止挂载策略。',
    manager: '已审阅研究、正反观点和风险报告。本地模拟模型仅决定维持当前仓位，目标和策略暂停列表均为空。',
  }[role];
  return `## ${labels[role]}\n\n${observation}\n\n${facts}${peers ? `\n\n### 已读取的报告\n\n${peers.split('\n').map(line => `- ${line}`).join('\n')}` : ''}\n\n> ${marker}`;
}

/** Stateless response selection from messages actually delivered by the host. */
export function modelReply(body) {
  const input = taskInput(body);
  if (!input) return { text: `${marker} 本地预览就绪。` };
  if (!roles.includes(input.role) || typeof input.runId !== 'string') fail('UNEXPECTED_TASK', 'Only the declared manual-trading Team roles are supported.');
  const outputs = toolResponses(body);
  if (outputs.some(output => output.value?.isError || output.value?.error)) fail('REAL_TOOL_FAILED', 'A real workflow tool failed; no replacement context or receipt will be fabricated.');
  const call = (name, args = {}) => {
    if (!body.tools?.some(tool => tool.function?.name === name)) fail('TOOL_UNAVAILABLE', `Real Agent tool set is missing ${name}.`);
    return { tool: { name, arguments: { run_id: input.runId, ...args } } };
  };
  if (input.role === 'executor') {
    const receipt = outputs.find(output => output.name === 'manual_trading_apply')?.value;
    if (!receipt) return call('manual_trading_apply');
    if (receipt.status !== 'unchanged' || receipt.orders?.length !== 0 || receipt.pauses?.length !== 0) fail('UNSAFE_PREVIEW_RECEIPT', 'Preview requires an unchanged execution receipt with zero orders and pauses.');
    return { text: `## 执行核对\n\n真实 \`manual_trading_apply\` 回执：**${receipt.status}**。\n\n- 订单 ${receipt.orders.length}\n- 策略暂停 ${receipt.pauses.length}\n\n> ${marker}` };
  }
  if (input.role === 'reporter') {
    const receipt = outputs.find(output => output.name === 'manual_trading_report')?.value;
    if (!receipt) return call('manual_trading_report');
    if (receipt.state !== 'archived' || !receipt.path || !receipt.evidenceRef) fail('ARCHIVE_UNCONFIRMED', 'The real daily report has not been archived with its evidence resource.');
    return { text: `## 日报归档\n\n真实归档状态：**${receipt.state}**\n\n研究目录文件：\n\n\`\`\`text\n${receipt.path}\n\`\`\`\n\n> ${marker}` };
  }
  const context = receivedContext(outputs, input.runId);
  if (!context || context.nextOffset !== null) return call('manual_trading_context', { section: 'all', offset: context?.nextOffset ?? 0, limit: 100 });
  const text = researchText(input.role, context);
  if (input.role === 'manager') {
    const receipt = outputs.find(output => output.name === 'manual_trading_decide')?.value;
    if (!receipt) return call('manual_trading_decide', { decision: { unchanged: true, targets: [], pause_strategies: [], rationale: text, evidence_dataset_ids: [] } });
    if (receipt.unchanged !== true || receipt.targets?.length !== 0 || receipt.pause_strategies?.length !== 0) fail('UNSAFE_PREVIEW_DECISION', 'The saved decision is not the unchanged preview decision.');
  }
  return { text };
}

export function createModelResponder({ delayMs = 1200, observed = [] } = {}) {
  let sequence = 0;
  return async (body, response) => {
    const input = taskInput(body), reply = modelReply(body);
    // This is a model-transport audit, never a source of workflow/task events.
    observed.push({ role: input?.role ?? null, runId: input?.runId ?? null, tool: reply.tool?.name ?? null, at: Date.now() });
    if (delayMs) await delay(delayMs);
    if (response.destroyed) return true;
    const number = ++sequence, id = `local-preview-${number}`, created = Math.floor(Date.now() / 1000);
    const chunk = (value, reason) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`;
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    if (reply.tool) {
      const delta = { role: 'assistant', tool_calls: [{ index: 0, id: `local_model_${number}`, type: 'function', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.arguments) } }] };
      response.end(`${chunk(delta, null)}${chunk({}, 'tool_calls')}data: [DONE]\n\n`);
      return true;
    }
    // Pace only the simulated model transport. Native host projection observes
    // these real SSE deltas; the script emits no workflow or frontend events.
    const characters = Array.from(reply.text);
    for (let offset = 0; offset < characters.length; offset += 50) {
      if (offset) await delay(80);
      if (response.destroyed) return true;
      response.write(chunk({ ...(offset ? {} : { role: 'assistant' }), content: characters.slice(offset, offset + 50).join('') }, null));
    }
    response.end(`${chunk({}, 'stop')}data: [DONE]\n\n`);
    return true;
  };
}

async function attachExistingAccount(app, { terminal }) {
  const mt5 = app.mt5, native = mt5?.native;
  if (!native || (await realpath(native.terminal)).toLowerCase() !== (await realpath(terminal)).toLowerCase()) fail('REAL_ACCOUNT_UNAVAILABLE', 'The production MT5 plugin could not locate the requested existing terminal.');
  const entry = app.runtime.plugins.entry('sesame/mt5');
  const { controlTerminal } = await import(pathToFileURL(join(entry.root, 'backend/process.js')));
  const read = async tool => {
    const receipt = await mt5.official.python.call(tool, {}, {}, AbortSignal.timeout(20000));
    if (receipt.error || receipt.result === false || receipt.result === null || receipt.result === undefined) fail('REAL_ACCOUNT_UNAVAILABLE', `The existing terminal did not confirm ${tool}; no fictional account fallback is allowed.`);
    return receipt.result;
  };
  // inspect only: never close/restart a terminal, import credentials, or log in.
  await controlTerminal(native, 'inspect');
  await read('initialize');
  const actual = await read('account_info'), terminalInfo = await read('terminal_info');
  if (!actual.login || !actual.server || terminalInfo.connected !== true) fail('REAL_ACCOUNT_UNAVAILABLE', 'An already connected real MT5 account is required.');
  // This configuration belongs solely to the disposable host profile. configure
  // replaces the Python worker; attaching its replacement uses no login/password.
  await mt5.official.configure({ expected_version: mt5.official.settings().version,
    account: { login: String(actual.login), server: actual.server }, allow_trading: false, allow_host_operations: false,
    servers: { terminal: { enabled: false }, metaeditor: { enabled: false }, marketdata: { enabled: false } } });
  await controlTerminal(native, 'inspect');
  await read('initialize');
  const verified = await read('account_info');
  if (String(verified.login) !== String(actual.login) || verified.server !== actual.server) fail('ACCOUNT_CHANGED', 'The connected account changed during preview setup.');
  return { accountId: String(actual.login), server: actual.server };
}

export async function launchPreview({ hostRoot, terminal, python, port = 0, delayMs = 1200, timeoutMs = 180000 } = {}) {
  if (!hostRoot || !terminal || !python) fail('CONFIGURATION_REQUIRED', 'Supply --host-root, --terminal and --python paths.');
  hostRoot = await realpath(hostRoot);
  terminal = await realpath(terminal);
  python = await realpath(python);
  // These environment values affect only this new process/profile, not the
  // user's running app. Imports and plugin installation use unmodified sources.
  process.env.SESAME_OPTIONAL_PLUGINS_DIR = packagesRoot;
  process.env.MT5AGENT_PYTHON = python;
  await import(pathToFileURL(join(hostRoot, 'modules/plugins/sdk-loader.js')));
  const [{ fixture }, { createTools }, { createHostContext }] = await Promise.all([
    import(pathToFileURL(join(hostRoot, 'tests/fixture-provider.js'))),
    import(pathToFileURL(join(hostRoot, 'modules/agent/tools.js'))),
    import(pathToFileURL(join(hostRoot, 'modules/plugins/context.js'))),
  ]);
  const observed = [], app = await fixture({ port, mt5: { disabled: false, directory: dirname(terminal) }, responseHandler: createModelResponder({ delayMs, observed }) });
  let closed = false, closePromise;
  const close = () => closePromise ??= (async () => { closed = true; await app.dispose(); })();
  let sequence = 0;
  const main = async (name, args = {}) => {
    const tool = createTools(app.runtime, 'conv_main').find(value => value.name === name);
    if (!tool) fail('TOOL_UNAVAILABLE', `The installed host does not expose ${name}.`);
    const result = await tool.execute(`preview-main-${++sequence}`, args);
    if (result.isError) fail('REAL_TOOL_FAILED', `${name} failed; inspect the temporary host diagnostics locally.`);
    return result.details;
  };
  try {
    // Register actual per-role model selections in this disposable host. Every
    // model uses the same loopback responder; the UI explicitly labels them mock.
    app.runtime.modelRuntime.registerProvider('local-preview', { baseUrl: app.modelUrl, api: 'openai-completions', apiKey: 'fixture-key',
      models: [...new Set(Object.values(previewModels))].map(id => ({ id, name: id, reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })) });
    await app.runtime.modelRuntime.setRuntimeApiKey('local-preview', 'fixture-key');
    const actual = await attachExistingAccount(app, { terminal });
    const snapshot = await main('mt5_trading_context', { action: 'snapshot', history_days: 1 });
    assert.equal(snapshot.account.accountId, actual.accountId);
    assert.equal(snapshot.account.server, actual.server);
    assert.ok(Array.isArray(snapshot.positions) && Array.isArray(snapshot.orders));
    app.runtime.options.plugins['sesame/manual-trading'] = { mockModelResponses: true };
    const draft = join(app.runtime.workspaces.root('conv_main'), 'manual-trading-live-preview');
    await cp(packageRoot, draft, { recursive: true });
    const checked = await app.runtime.plugins.manager.test('conv_main', { path: draft });
    if (!checked.passed) fail('PLUGIN_CHECK_FAILED', 'The current manual-trading package failed the real host preflight.');
    const installed = await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
    if (installed.runtime_status !== 'ready') fail('PLUGIN_INSTALL_FAILED', 'The current manual-trading package is not ready in the real host.');
    app.runtime.plugins.activate('conv_main', installed.id);
    const configured = await main('manual_trading_models');
    const agentModels = Object.fromEntries(roles.map(role => {
      const descriptor = configured.models.find(value => value.provider === 'local-preview' && value.id === previewModels[role]);
      if (!descriptor?.configurationDigest) fail('MODEL_UNAVAILABLE', 'The local model endpoint was not registered by the real host.');
      return [role, { provider: descriptor.provider, id: descriptor.id, configurationDigest: descriptor.configurationDigest }];
    }));
    const plan = await main('manual_trading_plan', { action: 'save', plan: {
      title: '真实账户 · Team 协作查看器（模型响应模拟）', backend: 'mt5', model: agentModels.manager, agent_models: agentModels,
      mode: 'team', symbols: [], event_keys: ['local.preview.start'], account_events: false, debate_rounds: 1, task_timeout_seconds: 120, enabled: true,
      instructions: '本地查看器：只有模型文本与模型选择的工具调用由 loopback endpoint 模拟。账户、调度、原生 Agent loop、上下文、报告传递、决策保存、执行回执与归档全部真实。仅允许 unchanged:true、targets:[]、pause_strategies:[]。不下单、不停止策略，不编造行情/新闻/收益。',
    } });
    const triggered = await main('manual_trading_event', { key: 'local.preview.start', event_id: randomUUID(), observed_at: Date.now(), data: { source: 'local-preview-launcher', purpose: 'one real Team workflow, simulated model responses' } });
    if (triggered.runs.length !== 1) fail('RUN_NOT_STARTED', 'The real event dispatcher did not create exactly one run.');
    const runId = triggered.runs[0].id;
    const activity = await main('manual_trading_activity', { run_id: runId });
    if (activity.runId !== runId || activity.mode !== 'live' || !activity.url) fail('ACTIVITY_UNAVAILABLE', 'The activity tool did not return this real run’s live URL.');
    const completed = (async () => {
      const deadline = Date.now() + timeoutMs;
      while (!closed && Date.now() < deadline) {
        const run = await main('manual_trading_runs', { action: 'read', run_id: runId });
        if ((run.report || run.reportError) && run.tasks.every(task => !['queued', 'running'].includes(task.status))) {
          if (run.status !== 'completed' || run.reportError || run.memoryError) fail('WORKFLOW_FAILED', 'The real Team workflow or archive did not complete successfully.');
          assert.deepEqual(run.tasks.map(task => task.role), roles);
          assert.ok(run.tasks.every(task => task.status === 'completed'));
          assert.equal(run.mockModelResponses, true);
          assert.equal(run.trigger.kind, 'event');
          assert.equal(run.decision.unchanged, true);
          assert.deepEqual(run.decision.targets, []);
          assert.deepEqual(run.decision.pause_strategies, []);
          assert.equal(run.execution.status, 'unchanged');
          assert.deepEqual(run.execution.orders, []);
          assert.deepEqual(run.execution.pauses, []);
          assert.equal(run.report.state, 'archived');
          const backendCommands = app.mt5Host.storage.list('mt5_command');
          assert.ok(backendCommands.length > 0 && backendCommands.every(command => command.operation_class === 'standard'));
          const mainHost = createHostContext(app.runtime, app.runtime.plugins.entry(installed.id), 'conv_main');
          const files = mainHost.reports.files.forSpace ? mainHost.reports.files.forSpace('research') : mainHost.reports.files;
          assert.ok(await files.read({ path: run.report.path }));
          return { runId, status: run.status, roles: run.tasks.length, reports: run.reports.length, modelRequests: observed.length, nativeReadCommands: backendCommands.length, orderCommands: 0, archive: run.report.state, modelResponses: 'mock', accountSource: 'live-mt5', workflowSource: 'native-host' };
        }
        await delay(250);
      }
      fail(closed ? 'PREVIEW_CLOSED' : 'WORKFLOW_TIMEOUT', closed ? 'Preview stopped.' : 'The real Team workflow exceeded the preview wait deadline.');
    })();
    // Prevent an unhandled rejection while a caller opens the URL before awaiting.
    completed.catch(() => {});
    return { url: activity.url, runId, planId: plan.id, completed, close, main, app };
  } catch (error) { await close(); throw error; }
}

async function cli() {
  const { values } = parseArgs({ options: {
    'host-root': { type: 'string', default: process.env.SESAME_HOST_ROOT },
    terminal: { type: 'string', default: process.env.MT5AGENT_MT5_DIR ? join(process.env.MT5AGENT_MT5_DIR, 'terminal64.exe') : 'D:/mt5/terminal64.exe' },
    python: { type: 'string', default: process.env.MT5AGENT_PYTHON ?? 'D:/Anaconda/python.exe' },
    port: { type: 'string', default: '0' }, 'delay-ms': { type: 'string', default: '1200' }, once: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  } });
  if (values.help) { console.log('node manual-trading-live-preview.mjs --host-root <existing mt5agent source> [--terminal <running terminal64.exe>] [--python <Windows Python with MetaTrader5>] [--delay-ms 1200] [--port 0] [--once]\nDefault: real Team workflow with only model responses simulated; live viewer remains available until Ctrl+C. Requires an already connected MT5 account.'); return; }
  const port = Number(values.port), delayMs = Number(values['delay-ms']);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5000) fail('INVALID_ARGUMENT', 'Use port 0..65535 and delay-ms 0..5000.');
  const preview = await launchPreview({ hostRoot: values['host-root'], terminal: values.terminal, python: values.python, port, delayMs });
  let stopping = false;
  const stop = () => { stopping = true; void preview.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log(JSON.stringify({ state: 'ready', url: preview.url, runId: preview.runId, modelResponses: 'mock', accountSource: 'live-mt5', workflowSource: 'native-host' }));
  try { console.log(JSON.stringify({ state: 'completed', ...await preview.completed })); }
  catch (error) { if (!stopping) { await preview.close(); throw error; } }
  if (values.once) await preview.close();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => {
    // Do not print tool response bodies, account identities, or host access tokens.
    console.error(JSON.stringify({ state: 'failed', code: error.code ?? 'PREVIEW_FAILED', message: error.code === 'ERR_ASSERTION' ? 'Real workflow verification failed.' : error.message }));
    process.exitCode = 1;
  });
}
