/** Actual host installation and tool-enabled Agent loop; local model + fictional account only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertTradingTask, verifyExecutionAuthorization } from '../packages/mt5/tools/trading-context.js';

const root = process.env.SESAME_HOST_ROOT;
const packageRoot = new URL('../packages/manual-trading/', import.meta.url);
let sequence = 0;

function respond(response, text, tool) {
  const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_manual_fixture_${++sequence}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] } : { role: 'assistant', content: text };
  const chunk = (value, reason) => JSON.stringify({ id: 'manual-trading-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: value, finish_reason: reason }] });
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, tool ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
}

function taskInput(body) {
  const message = body.messages.filter(value => value.role === 'user').at(-1)?.content;
  const text = typeof message === 'string' ? message : message?.map(part => part.text ?? '').join('');
  const marker = '\n\nInput JSON:\n';
  const offset = text?.lastIndexOf(marker) ?? -1;
  return offset < 0 ? null : JSON.parse(text.slice(offset + marker.length));
}

function toolResponses(body) {
  const calls = new Map(body.messages.flatMap(message => message.tool_calls ?? []).map(call => [call.id, call.function.name]));
  return body.messages.filter(message => message.role === 'tool').map(message => {
    const text = typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('');
    return { name: calls.get(message.tool_call_id), value: JSON.parse(text) };
  });
}

test('installed workflow composes independent portfolio execution and produces one final report per run through the actual host', { skip: !root, timeout: 180000 }, async () => {
  const { fixture, eventually } = await import(pathToFileURL(join(root, 'tests/fixture-provider.js')));
  const { createTools } = await import(pathToFileURL(join(root, 'modules/agent/tools.js')));
  const { createHostContextV2 } = await import(pathToFileURL(join(root, 'modules/plugins/host-v2/context.js')));
  const contexts = [], modelRequests = [], backendCalls = [], actualFills = [], authorizations = [], commands = new Map(), transportFailures = [];
  const account = { accountId: '42', server: 'Fictional-Agent-Demo', revision: '1' };
  const positions = [
    { ticket: '7001', symbol: 'QUANT_FIXTURE', type: 0, volume: 0.3, price_open: 99, profit: 0, magic: 777, comment: 'fictional quantitative strategy position' },
    { ticket: '7002', symbol: 'MANUAL_FIXTURE', type: 1, volume: 0.1, price_open: 101, profit: 0, magic: 0, comment: 'fictional manual position' },
  ];
  let currentPositions = structuredClone(positions), deploymentStatus = 'running', closePhase = false, tradeSends = 0;
  const assertAuthorized = (host, action, parameters, executionContext) => {
    const task = assertTradingTask(host, account, true, false, executionContext);
    assert.equal(host.context.kind, 'subagent');
    assert.equal(task.pluginId, 'sesame/manual-trading');
    assert.equal(task.input.role, 'executor');
    assert.equal(task.status, 'running');
    assert.equal(task.input.tradingPlan.ownerConversationId, 'conv_main');
    assert.deepEqual(task.input.tradingPlan.account, account);
    assert.equal(task.input.execution.pluginId, 'sesame/portfolio-execution');
    assert.deepEqual(task.input.execution.context, { bindingId: 'fixture-execution', backend: 'mt5', account });
    assert.equal(task.input.executionPublicKey, undefined);
    assert.equal(parameters.authorization, undefined);
    assert.deepEqual(verifyExecutionAuthorization(task, action, parameters, Date.now(), executionContext), parameters);
    const proof = executionContext.provenance;
    assert.deepEqual(proof.chain.slice(-3), [
      { pluginId: 'sesame/manual-trading', capabilityId: 'sesame/manual-trading#manual_trading_apply' },
      { pluginId: 'sesame/portfolio-execution', capabilityId: 'sesame/portfolio-execution#portfolio_execution_apply' },
      { pluginId: 'sesame/mt5', capabilityId: `sesame/mt5#${action}` },
    ], 'Native writes use the actual live host call chain; model input cannot supply its authority.');
    authorizations.push({ action, taskId: task.id, runId: task.input.runId });
    return task;
  };
  const snapshot = () => ({
    account, capturedAt: Date.now(), summary: { balance: 10000, equity: 10000, currency: 'USD' }, positions: structuredClone(currentPositions),
    deployments: [{ id: 'fixture-ea', status: deploymentStatus, symbol: 'QUANT_FIXTURE' }],
    orders: [], fills: [{ ticket: 'fixture-fill', symbol: 'QUANT_FIXTURE', volume: 0.3, time_msc: Date.now() - 60000 }, ...structuredClone(actualFills)], historicalOrders: [{ ticket: 'fixture-order', symbol: 'QUANT_FIXTURE' }],
    historyCoverage: { requestedDays: 30, complete: true, source: 'fictional-fixture' },
  });
  const app = await fixture({ responseHandler: (body, response) => {
    try {
    const input = taskInput(body);
    if (!input) { respond(response, 'Local fixture ready.'); return true; }
    modelRequests.push({ role: input.role, runId: input.runId, tools: body.tools.map(tool => tool.function.name) });
    const outputs = toolResponses(body), names = outputs.map(output => output.name);
    const failed = outputs.find(output => output.value?.error);
    assert.equal(failed, undefined, JSON.stringify(failed));
    const call = (name, extra = {}) => respond(response, null, { name, arguments: { run_id: input.runId, ...extra } });
    const closeQuant = input.trigger.id === 'close-quant-fixture-run';
    if (input.role === 'manager') {
      assert.ok(body.tools.some(tool => tool.function.name === 'memory_trading_context'));
      assert.ok(body.tools.some(tool => tool.function.name === 'memory_read'));
      assert.equal(body.tools.some(tool => tool.function.name === 'memory_manage'), false);
      if (!names.includes('memory_trading_context')) {
        respond(response, null, { name: 'memory_trading_context', arguments: {} }); return true;
      }
      const personalMemory = outputs.find(output => output.name === 'memory_trading_context').value;
      assert.equal(personalMemory.risk_state, 'missing'); assert.equal(personalMemory.complete, true);
      const pages = outputs.filter(output => output.name === 'manual_trading_context');
      if (!pages.length) call('manual_trading_context', { section: 'all', offset: 0, limit: 1 });
      else if (pages.length === 1) {
        assert.equal(pages[0].value.positions.total, 2);
        assert.equal(pages[0].value.positions.nextOffset, 1);
        contexts.push(pages[0].value);
        call('manual_trading_context', { section: 'all', offset: 1, limit: 1 });
      } else if (!names.includes('plugin_read')) {
        respond(response, null, { name: 'plugin_read', arguments: { pluginId: 'sesame/abu-indicators', part: 'resource', path: 'examples/input.json' } });
      } else if (!names.includes('abu_indicators_analyze')) {
        const example = JSON.parse(outputs.find(output => output.name === 'plugin_read').value.content);
        respond(response, null, { name: 'abu_indicators_analyze', arguments: { input: example } });
      } else if (!names.includes('manual_trading_decide')) {
        contexts.push(pages[1].value);
        const decision = closeQuant
          ? { unchanged: false, targets: [{ symbol: 'QUANT_FIXTURE', quantity: '0', unit: 'lots' }], pause_strategies: [{ deployment_id: 'fixture-ea', reason: '虚构风控事件显示该挂载继续运行会重复增加风险敞口，应先停止再将该量化持仓平仓。' }], rationale: '量化持仓仍属于全账户风险；先停止高风险挂载，再将 QUANT_FIXTURE 目标设为零，未列出的人工持仓保持。', evidence_dataset_ids: [] }
          : { unchanged: true, targets: [], pause_strategies: [], rationale: '已核对量化策略与人工来源的全部持仓。虚构环境无新增证据，本轮目标仓位不变。', evidence_dataset_ids: [] };
        const analysis = outputs.find(output => output.name === 'abu_indicators_analyze').value;
        assert.equal(analysis.baseline, true); assert.match(analysis.implementation_sha256, /^sha256:/);
        decision.evidence_artifacts = [analysis.result_artifact];
        call('manual_trading_decide', { decision });
      } else respond(response, closeQuant ? '已保存零目标和极大风险挂载暂停理由，等待实际执行回执。' : '已检查全账户和交易历史，保存目标仓位不变。');
    } else if (input.role === 'executor') {
      assert.equal(body.tools.some(tool => tool.function.name.startsWith('memory_')), false);
      assert.equal(input.execution.pluginId, 'sesame/portfolio-execution');
      assert.equal(input.tradingPlan.backend, undefined);
      if (!names.includes('manual_trading_apply')) call('manual_trading_apply');
      else respond(response, `实际执行回执 ${outputs.at(-1).value.status}；仅根据返回的订单和账户核对结果报告，不从目标推算成交或收益。`);

    } else throw new Error(`Unexpected fixture role: ${input.role}`);
    return true;
    } catch (error) {
      transportFailures.push({ message: error.message, lastTool: JSON.stringify(body.messages.filter(message => message.role === 'tool').at(-1)).slice(0, 3000) });
      respond(response, 'Local fixture assertion failed; no further actions.'); return true;
    }
  } });
  try {
    const memory = app.runtime.plugins.entries.get('sesame/memory');
    if (!memory?.capabilityManifest.capabilities.some(cap => cap.id === 'memory_trading_context')) {
      const memoryDraft = join(app.runtime.workspaces.root('conv_main'), 'trading-memory-draft');
      await cp(fileURLToPath(new URL('../../api-v1/packages/memory/', import.meta.url)), memoryDraft, { recursive: true });
      const checkedMemory = await app.runtime.plugins.manager.test('conv_main', { path: memoryDraft });
      assert.equal(checkedMemory.passed, true, JSON.stringify(checkedMemory.results));
      const installedMemory = await app.runtime.plugins.manager.install('conv_main', { path: memoryDraft, digest: checkedMemory.digest, ...(memory ? { expected_digest: memory.digest } : {}) }, Boolean(memory));
      assert.equal(installedMemory.runtime_status, 'ready');
    }
    const baselineDraft = join(app.runtime.workspaces.root('conv_main'), 'abu-indicators-draft');
    await cp(fileURLToPath(new URL('../packages/abu-indicators/', import.meta.url)), baselineDraft, { recursive: true });
    const baselineChecked = await app.runtime.plugins.manager.test('conv_main', { path: baselineDraft });
    assert.equal(baselineChecked.passed, true, JSON.stringify(baselineChecked.results));
    const baselineInstalled = await app.runtime.plugins.manager.install('conv_main', { path: baselineDraft, digest: baselineChecked.digest });
    assert.equal(baselineInstalled.runtime_status, 'ready');
    const backendManifest = JSON.parse(await readFile(new URL('../packages/mt5/plugin.json', import.meta.url)));
    const backendManifestV2 = JSON.parse(await readFile(new URL('../packages/mt5/capabilities.json', import.meta.url)));
    const fixtureTools = ['mt5_trading_context', 'mt5_trading_pause', 'mt5_catalog', 'mt5_python', 'mt5_trading_order', 'mt5_trading_command', 'mt5_settings'];
    const capabilities = fixtureTools.map(name => {
      const declaration = backendManifestV2.capabilities.find(capability => capability.id === name);
      assert.ok(declaration, `Published backend capability missing: ${name}`);
      return declaration;
    });
    const definitions = capabilities.map(capability => ({ name: capability.id, label: capability.id, description: capability.description, parameters: capability.inputSchema }));
    app.runtime.plugins.register({
      id: 'sesame/mt5', apiVersion: '2', version: backendManifest.version, digest: `sha256:${'c'.repeat(64)}`, title: 'Fictional account fixture', description: 'Only static account observations; no broker I/O.',
      default_state: 'mounted', agent_scope: 'all', execution: 'native', runtime_status: 'ready', tool_names: definitions.map(definition => definition.name),
      main_tool_names: backendManifest.main_tool_names.filter(name => fixtureTools.includes(name)), definitions, resources: [], skills: [], diagnostics: [], dependency_lock: [],
      capabilityManifest: { ...backendManifestV2, capabilities, sources: [], services: [], hooks: [], views: [], knowledge: [], stateCollections: [], artifactSchemas: [] },
      module: Promise.resolve({ createCapabilities: backendHost => capabilities.map(capability => ({ name: capability.id, execute: async (args, _signal, executionContext) => {
        const name = capability.id;
        backendCalls.push({ name, args: structuredClone(args), scope: backendHost.context.kind });
        if (!closePhase) assert.equal(name, 'mt5_trading_context', 'An unchanged decision must not invoke a broker action.');
        let value;
        if (name === 'mt5_trading_context') {
          assert.ok(['identity', 'snapshot'].includes(args.action));
          value = args.action === 'identity' ? { account } : snapshot();
        } else if (name === 'mt5_trading_pause') {
          assertAuthorized(backendHost, name, args, executionContext);
          assert.equal(args.deployment_id, 'fixture-ea'); assert.deepEqual(args.account, account);
          assert.match(args.reason, /风险/);
          deploymentStatus = 'stopped';
          value = { status: 'stopped', deployment: { id: 'fixture-ea', status: deploymentStatus, symbol: 'QUANT_FIXTURE' }, reason: args.reason };
        } else if (name === 'mt5_catalog') {
          value = { items: [{ server: 'python', tools: [{ name: 'order_send', callable: true, inputSchema: { properties: { execution_guard: { type: 'object' } } } }] }] };
        } else if (name === 'mt5_python') {
          assert.equal(args.server, 'python');
          const native = {
            account_info: { login: 42, server: account.server, balance: 10000, equity: 10000, currency: 'USD', trade_allowed: true, trade_expert: true },
            terminal_info: { connected: true },
            symbol_info: { name: args.arguments.symbol, volume_min: 0.01, volume_max: 1, volume_step: 0.01, filling_mode: 2, trade_exemode: 2, trade_tick_size: 0.01, point: 0.01 },
            positions_get: currentPositions.filter(position => position.symbol === args.arguments.symbol),
            symbol_info_tick: { time_msc: Date.now(), bid: 100, ask: 101 },
            orders_get: [], history_deals_get: structuredClone(actualFills),
          };
          assert.ok(Object.hasOwn(native, args.tool), `Unexpected fictional native read: ${args.tool}`);
          value = { status: 'returned', result: { result: structuredClone(native[args.tool]) } };
        } else if (name === 'mt5_trading_order') {
          const task = assertAuthorized(backendHost, name, args, executionContext);
          assert.equal(deploymentStatus, 'stopped', 'The risky mount must be stopped before the close reaches the native backend.');
          assert.equal(args.server, 'python'); assert.equal(args.tool, 'order_send');
          const { request, execution_guard: guard } = args.arguments;
          assert.equal(request.action, 'TRADE_ACTION_DEAL'); assert.equal(request.type, 'ORDER_TYPE_SELL');
          assert.equal(request.symbol, 'QUANT_FIXTURE'); assert.equal(request.position, '7001'); assert.equal(request.volume, 0.3);
          assert.equal(guard.expected_account, account.accountId); assert.equal(guard.expected_server, account.server); assert.equal(guard.side, 'sell');
          assert.deepEqual(guard.expected_positions, [{ ticket: '7001', type: 0, volume: '0.3' }], 'The native guard includes every observed position for this symbol and excludes the unrelated manual symbol.');
          assert.ok(guard.expires_at > Date.now()); assert.equal(guard.max_quote_age_ms, 5000); assert.equal(guard.max_quote_to_send_ms, 1000);
          assert.ok(Number(guard.price_limit) <= 100);
          assert.ok(!commands.has(args.command_id), 'The fake native endpoint must receive this close exactly once.');
          assert.ok(currentPositions.some(position => position.ticket === '7001' && position.magic === 777));
          tradeSends++;
          currentPositions = currentPositions.filter(position => position.ticket !== '7001');
          actualFills.push({ ticket: '9101', order: '9001', position_id: '7001', symbol: request.symbol, volume: request.volume, type: 1, price: 100, time_msc: Date.now(), comment: request.comment });
          value = { status: 'returned', result: { result: { retcode: 10009, order: '9001', deal: '9101', volume: 0.3, price: 100 }, execution_timing: { quote_to_send_ms: 0, send_to_receipt_ms: 1 } } };
          commands.set(args.command_id, { receipt: structuredClone(value), owner: task.input.tradingPlan.ownerConversationId });
        } else if (name === 'mt5_trading_command') {
          const command = commands.get(args.command_id);
          assert.ok(command);
          assert.equal(backendHost.context.kind, 'main', 'The parent conversation can recover its completed background order receipt.');
          assert.equal(backendHost.context.sessionId, command.owner);
          value = command.receipt;
        } else if (name === 'mt5_settings') {
          assert.equal(backendHost.context.kind, 'main');
          value = { settings: { version: 1, account: { login: 42, server: account.server } } };
        } else throw new Error(`Unexpected fake backend tool: ${name}`);
        return value;
      } })) }),
    });
    const draft = join(app.runtime.workspaces.root('conv_main'), 'manual-agent-draft');
    await cp(fileURLToPath(packageRoot), draft, { recursive: true });
    const checked = await app.runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(checked.passed, true, JSON.stringify(checked.results));
    const installed = await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
    assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
    app.runtime.plugins.activate('conv_main', installed.id);
    assert.ok(app.runtime.plugins.services.has(installed.id), 'The actual activation hook must have started the trading scheduler.');
    const executionDraft = join(app.runtime.workspaces.root('conv_main'), 'portfolio-execution-draft');
    await cp(fileURLToPath(new URL('../packages/portfolio-execution/', import.meta.url)), executionDraft, { recursive: true });
    const executionChecked = await app.runtime.plugins.manager.test('conv_main', { path: executionDraft });
    assert.equal(executionChecked.passed, true, JSON.stringify(executionChecked.results));
    const executionInstalled = await app.runtime.plugins.manager.install('conv_main', { path: executionDraft, digest: executionChecked.digest });
    assert.equal(executionInstalled.runtime_status, 'ready', JSON.stringify(executionInstalled.diagnostics));
    app.runtime.plugins.activate('conv_main', executionInstalled.id);

    const main = async (name, args = {}) => {
      const tool = createTools(app.runtime, 'conv_main').find(candidate => candidate.name === name);
      assert.ok(tool, `Installed tool missing: ${name}`);
      const value = await tool.execute(`main-manual-fixture-${++sequence}`, args);
      assert.ok(!value.isError, JSON.stringify(value));
      return value.details;
    };
    const configured = await main('manual_trading_models');
    const descriptor = configured.models.find(model => model.provider === 'fixture' && model.id === 'fixture');
    assert.ok(descriptor?.configurationDigest, JSON.stringify(configured));
    const model = { provider: descriptor.provider, id: descriptor.id, configurationDigest: descriptor.configurationDigest };
    const execution = await main('portfolio_execution_configure', { id: 'fixture-execution', backend: 'mt5' });
    const research = { plugins: ['sesame/abu-indicators', app.runtime.plugins.toolOwners.get('plugin_read')], tools: ['plugin_read', 'abu_indicators_analyze'] };
    const plan = await main('manual_trading_plan', { action: 'save', plan: { title: '虚构账户日报', execution, model, research, mode: 'single', symbols: ['MANUAL_FIXTURE'], interval_minutes: 5, event_keys: ['fixture.change'], enabled: true } });
    assert.deepEqual(plan.account, account);
    assert.equal(plan.backend, undefined);
    assert.equal(plan.execution.pluginId, executionInstalled.id);
    assert.equal(plan.model.configurationDigest, model.configurationDigest);
    assert.ok(plan.reportFolder.startsWith('手工交易日报/'));
    const mainHost = createHostContextV2(app.runtime, app.runtime.plugins.entry(installed.id), 'conv_main');
    const files = app.runtime.reportLibrary;
    const targetFor = run => files.boundTarget(app.runtime.runs.read(run.workflow.id).executionSessionId);
    const rawFor = async run => JSON.parse((await mainHost.resources.read(run.report.ref, { part: 'content', entry: 'run.json' })).content);

    const first = await main('manual_trading_run', { plan_id: plan.id, request_id: 'first-fixture-run' });
    const finish = async (id, expectedExecution = 'unchanged') => {
      const done = await eventually(async () => {
        const run = await main('manual_trading_runs', { action: 'read', run_id: id });
        return (run.report || run.reportError || ['failed', 'interrupted', 'cancelled'].includes(run.status))
          && run.tasks.every(task => !['queued', 'running'].includes(task.status)) ? run : false;
      }, 40000);
      assert.equal(done.status, 'completed', JSON.stringify({ error: done.error, reportError: done.reportError, transportFailures, tasks: done.tasks.map(task => { const run = app.runtime.runs.read(task.id); return { ...task, hostError: run.error, messages: app.runtime.messages(run.executionSessionId).slice(-2) }; }) }));
      assert.equal(done.reportPending, false, JSON.stringify(done.reportError));
      assert.equal(done.execution.status, expectedExecution, JSON.stringify(done.execution));
      if (expectedExecution === 'unchanged') { assert.deepEqual(done.execution.orders, []); assert.equal(done.execution.targetReached, null); }
      assert.deepEqual(done.tasks.map(task => task.role), ['manager', 'executor']);
      assert.ok(done.tasks.every(task => task.status === 'completed'));
      assert.equal(done.memoryError, undefined, JSON.stringify(done.memoryError));
      return done;
    };
    const done = await finish(first.id);
    assert.deepEqual(done.snapshot.positions.map(position => position.magic), [777, 0]);
    assert.ok(contexts.some(context => context.positions.items[0]?.magic === 777), 'Manager saw the quantitative position even though it was not a watch-list symbol.');
    assert.ok(contexts.some(context => context.positions.items[0]?.magic === 0));
    assert.ok(contexts.some(context => context.fills.items[0]?.ticket === 'fixture-fill'));
    const target = targetFor(done);
    assert.equal(target.space, 'research');
    assert.ok(target.path.startsWith(`${plan.reportFolder}/`));
    const html = await files.read({ space: target.space, path: target.path });
    assert.match(html.content, /目标仓位不变/);
    assert.match(html.content, /QUANT_FIXTURE/);
    assert.match(html.content, /fixture-fill/);
    const raw = await rawFor(done);
    assert.equal(raw.id, done.id);
    assert.equal(raw.execution.status, 'unchanged');
    assert.deepEqual(raw.snapshot.positions, positions);
    assert.equal(raw.evidence.length, 1);
    assert.equal(raw.evidence[0].dataset.rows[0].baseline, true);
    assert.deepEqual(raw.evidence[0].artifact, raw.decision.evidence_artifacts[0]);
    assert.equal(done.report.ref.kind, 'report');
    assert.ok((await mainHost.resources.read(done.report.ref, { part: 'manifest' })).blobs.some(blob => blob.path === 'run.json'));

    const count = modelRequests.length;
    assert.equal((await main('manual_trading_run', { plan_id: plan.id, request_id: 'first-fixture-run' })).id, first.id);
    assert.equal(modelRequests.length, count, 'Retrying a completed request does not repeat the model or execution.');
    const archivedAgain = await main('manual_trading_report', { run_id: first.id });
    assert.deepEqual(archivedAgain.ref, done.report.ref);
    assert.equal((await files.read({ space: target.space, path: target.path })).content, html.content);

    const delivered = await main('manual_trading_event', { key: 'fixture.change', event_id: 'second-fixture-run', observed_at: Date.now(), data: { cause: 'fictional quote changed' } });
    assert.equal(delivered.runs.length, 1);
    const second = await finish(delivered.runs[0].id);
    assert.notEqual(targetFor(second).path, target.path, 'Each completed run keeps one final report.');
    assert.equal((await files.read({ space: target.space, path: target.path })).content, html.content, 'The later cycle must preserve the earlier report.');
    assert.equal(backendCalls.every(call => call.name === 'mt5_trading_context'), true);
    assert.ok(backendCalls.some(call => call.args.action === 'identity'));
    assert.ok(backendCalls.filter(call => call.args.action === 'snapshot').length >= 6);
    assert.ok(modelRequests.filter(request => request.role === 'manager').every(request => !request.tools.includes('manual_trading_apply')));
    assert.ok(modelRequests.filter(request => request.role === 'manager').every(request => request.tools.includes('abu_indicators_analyze') && request.tools.includes('plugin_read')));
    assert.ok(modelRequests.filter(request => request.role === 'executor').every(request => !request.tools.some(name => name.startsWith('abu_'))));
    assert.equal(modelRequests.some(request => request.role === 'reporter'), false);
    assert.ok(modelRequests.every(request => !request.tools.includes('manual_trading_plan') && !request.tools.includes('mt5_settings')));

    closePhase = true;
    const closeRun = await main('manual_trading_run', { plan_id: plan.id, request_id: 'close-quant-fixture-run' });
    const closed = await finish(closeRun.id, 'target_observed');
    assert.equal(tradeSends, 1);
    assert.equal(closed.decision.unchanged, false);
    assert.deepEqual(closed.decision.targets, [{ symbol: 'QUANT_FIXTURE', quantity: '0', unit: 'lots' }]);
    assert.equal(closed.decision.pause_strategies[0].deployment_id, 'fixture-ea');
    assert.equal(closed.execution.pauses[0].status, 'stopped');
    assert.equal(closed.execution.targetReached, true);
    assert.equal(closed.execution.orders.length, 1);
    const order = closed.execution.orders[0], receipt = order.receipt;
    assert.equal(receipt.action, 'close'); assert.equal(receipt.side, 'sell'); assert.equal(receipt.quantity, '0.3');
    assert.equal(receipt.intent.positionId, '7001'); assert.equal(receipt.status, 'execution_reported');
    assert.equal(receipt.receipt.result.result.deal, '9101');
    assert.deepEqual(closed.execution.after.positions, [positions[1]], 'The unrelated manual position must remain untouched.');
    assert.equal(closed.execution.after.fills.find(fill => fill.ticket === '9101').position_id, '7001');
    const pauseIndex = backendCalls.findIndex(call => call.name === 'mt5_trading_pause'), sendIndex = backendCalls.findIndex(call => call.name === 'mt5_trading_order');
    assert.ok(pauseIndex >= 0 && sendIndex > pauseIndex);
    assert.equal(backendCalls[sendIndex].scope, 'subagent');
    assert.deepEqual(authorizations.map(proof => proof.action), ['mt5_trading_pause', 'mt5_trading_order']);
    assert.ok(authorizations.every(proof => proof.runId === closed.id && proof.taskId === authorizations[0].taskId));
    assert.ok(backendCalls.slice(pauseIndex + 1, sendIndex).some(call => call.name === 'mt5_trading_context' && call.args.action === 'identity' && call.scope === 'subagent'), 'The native adapter must obtain background account identity through the scoped context API.');
    assert.ok(backendCalls.slice(pauseIndex + 1, sendIndex).some(call => call.name === 'mt5_python' && call.args.tool === 'orders_get' && call.args.arguments.symbol === 'QUANT_FIXTURE' && call.scope === 'subagent'), 'The scheduled executor reads current symbol orders before dispatching its guarded close.');
    const durable = await main('manual_trade_status', { operation_id: order.operationId });
    assert.equal(durable.id, receipt.id); assert.equal(durable.intent.positionId, '7001');
    assert.equal(durable.planExecution, true);
    const refreshed = await main('manual_trade_status', { operation_id: order.operationId, refresh: true });
    assert.equal(refreshed.id, durable.id); assert.equal(refreshed.status, 'execution_reported');
    assert.deepEqual(refreshed.checkedAccount, account); assert.ok(refreshed.checkedAt > 0);
    assert.equal(refreshed.evidence.command.result.result.deal, '9101');
    assert.deepEqual(refreshed.evidence.deals, actualFills);
    assert.deepEqual(refreshed.evidence.positions, []);
    assert.equal(backendCalls.filter(call => call.name === 'mt5_trading_command' && call.scope === 'main' && call.args.command_id === durable.backendCommandId).length, 1);
    assert.equal(tradeSends, 1, 'Refreshing a saved plan receipt must not submit a replacement order.');
    const closedRaw = await rawFor(closed);
    assert.equal(closedRaw.decision.targets[0].quantity, '0', 'Target zero is a portfolio objective.');
    assert.equal(closedRaw.execution.orders[0].receipt.quantity, '0.3', 'Actual close quantity remains a separate durable receipt.');
    assert.equal(closedRaw.execution.orders[0].receipt.receipt.result.result.deal, '9101');
    assert.deepEqual(closedRaw.execution.after.positions, [positions[1]]);
    assert.equal((await files.read({ space: target.space, path: target.path })).content, html.content, 'Trading in a later cycle cannot rewrite the earlier unchanged decision.');
    const afterCloseRequests = modelRequests.length;
    assert.equal((await main('manual_trading_run', { plan_id: plan.id, request_id: 'close-quant-fixture-run' })).id, closed.id);
    assert.equal(tradeSends, 1); assert.equal(modelRequests.length, afterCloseRequests);
    const finalReports = (await files.list({ space: 'research', recursive: true })).entries.filter(entry => entry.kind === 'file' && entry.path.startsWith(`${plan.reportFolder}/`) && entry.path.endsWith('.html'));
    assert.equal(finalReports.length, 3, 'Three completed runs produce three summaries, with no per-role HTML.');

    const paused = await main('manual_trading_plan', { action: 'pause', plan_id: plan.id });
    assert.equal(paused.enabled, false);
    await assert.rejects(main('manual_trading_run', { plan_id: plan.id, request_id: 'paused-fixture-run' }), /paused|PLAN_PAUSED/i);
    await Promise.allSettled(app.runtime.agentTasks.running.values());
    const workflows = app.runtime.runs.list({ kind: 'workflow' });
    assert.equal(workflows.length, 3);
    assert.ok(workflows.every(run => run.status === 'completed' && run.executionSessionId !== 'conv_main'));
    const agents = app.runtime.runs.list({ kind: 'agent' });
    assert.equal(agents.length, 6);
    assert.ok(agents.every(run => run.status === 'completed' && workflows.some(parent => parent.id === run.parentRunId)));
    assert.ok(agents.every(run => run.output.toolCalls.every(call => call.status === 'returned')));
    assert.deepEqual(transportFailures, []);
    assert.equal(app.runtime.messages('conv_main').length, 0, 'Native collaboration retains child activity outside the main chat');
  } finally { await app.dispose(); }
});
