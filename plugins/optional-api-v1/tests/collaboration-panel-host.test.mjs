import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { TradingRuntime } from '../packages/manual-trading/runtime.js';
import { TradingActivityViewer } from '../packages/manual-trading/viewer.js';
import { hasElectron, launchPage } from './helpers/collaboration-electron.mjs';

test('plugin collaboration reaches the isolated report HTML through native authenticated SSE', { skip: !hasElectron, timeout: 60000 }, async t => {
  const hostRoot = process.env.SESAME_HOST_ROOT;
  const { fixture } = await import(pathToFileURL(join(hostRoot, 'tests/fixture-provider.js')));
  const { createHostContext } = await import(pathToFileURL(join(hostRoot, 'modules/plugins/context.js')));
  const app = await fixture({ configured: false });
  let closePage, phase = 'register';
  t.after(async () => { t.diagnostic(phase); await closePage?.(); await viewer.dispose(); await runtime.dispose(); await app.dispose(); });
  const entry = { id: 'fixture/collaboration-panel', version: '1.0.0', digest: `sha256:${'1'.repeat(64)}` };
  const host = createHostContext(app.runtime, entry), main = createHostContext(app.runtime, entry, 'conv_main');
  const runtime = new TradingRuntime(host, { timer: false }), viewer = new TradingActivityViewer(runtime);
  const now = Date.now(), model = { provider: 'fixture', id: 'gpt-5.4' };
  runtime.save({ id: 'panel-run', planId: 'panel-plan', status: 'executing', createdAt: now, startedAt: now,
    mockModelResponses: true,
    plan: { id: 'panel-plan', ownerConversationId: 'conv_main', title: '实时协作 · 报告面板验证', backend: 'mt5', account: { accountId: 'fictional' }, mode: 'single', reportFolder: '手工交易日报/panel-fixture' },
    tasks: [{ id: 'manager', role: 'manager', round: 0, stageIndex: 0, model, status: 'completed', completedAt: now },
      { id: 'executor', role: 'executor', round: 1, stageIndex: 1, model: { provider: 'fixture', id: 'claude-sonnet-4-6' }, status: 'running', startedAt: now },
      { id: 'reporter', role: 'reporter', round: 0, stageIndex: 2, model, status: 'queued' }],
    reports: [{ taskId: 'manager', role: 'manager', round: 0, model, createdAt: now, text: '## 目标仓位\n\n保持不变，等待执行核对。' }],
  });
  const opened = await viewer.open(main, 'panel-run');
  assert.equal(opened.panel, 'report'); assert.equal(opened.url, undefined);
  let streamResponse;
  app.server.on('request', (request, response) => { if (request.url === `/api/v1/live-reports/${opened.viewId}/events`) streamResponse = response; });
  const { page, close } = await launchPage(); closePage = close; page.setDefaultTimeout(10000);
  await page.context().addCookies([{ name: 'mt5agent_session', value: app.token, url: app.origin + '/api/v1/', httpOnly: true, sameSite: 'Strict' }]);
  await page.route(app.origin + '/panel-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><style>html,body{margin:0;height:100%;background:#fafafa}main,iframe{width:100%;height:100%;border:0}</style><main id="report-panel"></main></html>' }));
  await page.goto(app.origin + '/panel-fixture');
  phase = 'mount';
  await page.evaluate(async viewId => {
    const document = await (await fetch(`/api/v1/live-reports/${viewId}/document`)).json();
    const { mountLiveReport } = await import('/modules/frontend/report-runtime/live-report-host.js');
    window.disposePanel = await mountLiveReport(window.document.getElementById('report-panel'), document);
    await window.disposePanel.ready;
  }, opened.viewId);
  const frame = page.frameLocator('iframe');
  phase = 'connect';
  await frame.locator('html[data-connected="true"]').waitFor();
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await frame.locator('#run-title').textContent(), '实时协作 · 报告面板验证');
  assert.equal(await frame.locator('.feed-report h2').textContent(), '目标仓位');
  assert.equal(await frame.locator('body').evaluate(node => getComputedStyle(node).padding), '0px');
  assert.match(await frame.locator('#run-title').evaluate(node => getComputedStyle(node).fontFamily), /Segoe UI/);
  assert.equal(await frame.locator('.model-summary-button').first().evaluate(node => getComputedStyle(node).borderRadius), '0px');
  assert.equal((await main.reports.files.forSpace('research').list({ recursive: true })).entries.filter(e => e.kind === 'file').length, 0);
  const exposed = await frame.locator('body').evaluate(() => ({ electron: typeof window.require, tools: typeof window.reportLive.tools, url: location.origin }));
  assert.equal(exposed.electron, 'undefined'); assert.equal(exposed.tools, 'undefined');

  runtime.update('panel-run', { tasks: runtime.run('panel-run').tasks.map(task => task.id === 'executor' ? { ...task, publicOutput: { text: '## 执行核对\n\n**全账户持仓** 已读取。' } } : task) });
  phase = 'stream'; await frame.getByText('全账户持仓', { exact: true }).waitFor();
  runtime.activity('panel-run', 'report.read', { fromTaskId: 'manager', toTaskId: 'executor', taskId: 'executor', role: 'executor', at: now + 1, message: '已读取目标仓位' });
  await frame.locator('.handoff-agent').waitFor();
  const camera = await frame.locator('#diagram').getAttribute('style');
  phase = 'disconnect'; assert.ok(streamResponse); streamResponse.destroy();
  await frame.getByText('正在重连', { exact: true }).waitFor();
  assert.equal(await frame.locator('.handoff-agent').count(), 0);
  phase = 'reconnect';
  await frame.locator('html[data-connected="true"]').waitFor();
  assert.equal(await frame.locator('.handoff-agent').count(), 0, 'Reconnect does not reenact old reads');
  assert.equal(await frame.locator('#diagram').getAttribute('style'), camera);

  runtime.update('panel-run', { status: 'completed', completedAt: now + 2, tasks: runtime.run('panel-run').tasks.map(task => ({ ...task, status: 'completed', completedAt: now + 2 })) });
  phase = 'archive'; const summary = await runtime.archive(main, 'panel-run');
  await frame.locator('#summary-path').filter({ hasText: summary.path }).waitFor();
  assert.equal(await frame.locator('.handoff-agent').count(), 0);
  assert.equal((await main.reports.files.forSpace('research').list({ recursive: true })).entries.filter(e => e.path.endsWith('.html')).length, 1);
  if (process.env.SESAME_COLLABORATION_SCREENSHOT) {
    const output = process.env.SESAME_COLLABORATION_SCREENSHOT;
    await mkdir(join(output, '..'), { recursive: true }); await page.screenshot({ path: output, fullPage: true });
  }
  await page.evaluate(() => window.disposePanel());
  assert.equal(await page.locator('iframe').count(), 0);
  for (let i = 0; i < 30 && app.runtime.liveReports.get(opened.viewId).listeners.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(app.runtime.liveReports.get(opened.viewId).listeners.size, 0);
  assert.equal(app.requests.length, 0, 'Presentation never invokes a model');
  phase = 'complete';
});
