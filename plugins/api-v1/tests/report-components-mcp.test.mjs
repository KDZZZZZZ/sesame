/** Real MCP transport and publication; synthetic values, isolated workspace.
 * Opt in with SESAME_HOST_ROOT. No user workspace, account or model is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLock } from '../scripts/plugin-lock.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
const output = process.env.SESAME_COMPONENTS_MCP_OUTPUT;
const core = fileURLToPath(new URL('../', import.meta.url));
const names = ['components_list', 'components_describe', 'components_validate', 'components_show'];

test('component tools cross real HTTP and stdio MCP into immutable, inspectable reports', { skip: !hostRoot, timeout: 120000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)).href);
  const base = output || tmpdir(); await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(join(base, 'components-mcp-')));
  let app, modelCalls = 0;
  t.after(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const stage = join(root, 'source'), bundle = join(root, 'bundle');
  await mkdir(join(stage, 'packages'), { recursive: true }); await mkdir(bundle);
  for (const name of ['workspace', 'data-access', 'reports']) {
    await cp(join(core, 'packages', name), join(stage, 'packages', name), { recursive: true });
  }
  const lock = buildLock(stage);
  for (const pkg of lock.packages) await cp(join(stage, 'packages', pkg.directory), join(bundle, pkg.directory), { recursive: true });
  await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock, null, 2) + '\n');
  const [{ startServer }, { ModelRuntime }, { createHostContextV2 }] = await Promise.all([
    load('modules/agent/server.js'), load('node_modules/@earendil-works/pi-coding-agent/dist/index.js'),
    load('modules/plugins/host-v2/context.js'),
  ]);
  const models = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
  models.registerProvider('uncalled-components-fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'synthetic-never-called',
    models: [{ id: 'unused', name: 'Synthetic component fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  app = await startServer({ port: 0, dataDir: join(root, 'state'), runtimeOptions: { officialPluginsDirectory: bundle, piDir: join(root, 'pi'), modelRuntime: models, model: models.getModel('uncalled-components-fixture', 'unused') } });
  app.runtime.modelTransport.fetch = async () => { modelCalls++; throw Error('This transport test must not call a model'); };
  const version = JSON.parse(await readFile(join(core, 'packages/reports/plugin.json'), 'utf8')).version;
  assert.equal(app.runtime.plugins.entry('sesame/reports').version, version);
  assert.equal(app.runtime.plugins.entry('sesame/reports').runtime_status, 'ready');
  const host = createHostContextV2(app.runtime, app.runtime.capabilities.hostEntry, 'conv_main');
  const accessResponse = await fetch(`${app.origin}/api/v1/plugins/mcp-access`, { headers: { Authorization: `Bearer ${app.token}` } });
  assert.equal(accessResponse.status, 200);
  const access = await accessResponse.json();
  const rpc = async (method, params = {}, token = access.token) => {
    const response = await fetch(`${app.origin}/api/v1/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Mcp-Method': method },
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }) });
    return { status: response.status, body: await response.json() };
  };
  const call = async (name, args) => {
    const response = await rpc('tools/call', { name, arguments: args });
    assert.equal(response.status, 200);
    assert.equal(response.body.error, undefined, response.body.error?.message);
    assert.equal(response.body.result.isError, false, response.body.result.content?.[0]?.text);
    return response.body.result.structuredContent;
  };
  assert.equal((await rpc('tools/list', {}, 'wrong')).status, 401);
  const initialized = (await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'component-test', version: '1' } })).body.result;
  assert.deepEqual(initialized.capabilities, { tools: {} }, 'Do not advertise unimplemented MCP Apps resources');
  const tools = (await rpc('tools/list')).body.result.tools;
  for (const name of names) assert.equal(tools.find(tool => tool.name === name)?.inputSchema.type, 'object', name);
  assert.ok(!tools.some(tool => tool.name === 'report_render'), 'Internal HTML renderer stays private');
  const listed = await call('components_list', { limit: 100 });
  assert.equal(listed.items.filter(item => item.id.startsWith('chart.')).length, 38);
  const described = await call('components_describe', { ids: ['chart.line', 'layout.columns'] });
  assert.equal(described.items.length, 2);
  assert.ok(described.items.every(item => item.inputSchema && item.example));
  const line = structuredClone(described.items.find(item => item.id === 'chart.line').example);
  const content = { kind: 'document', sections: [{ title: '合成序列比较', blocks: [
    { type: 'paragraph', text: '仅验证组件协议与渲染；不是市场研究结果。' }, line,
    { type: 'details', title: '用户主动提供的明细', blocks: [{ type: 'table', columns: ['记录', '值'], rows: [['精确原值', '9007199254740993.0000001']] }] },
  ] }] };
  const draft = { title: '组件 MCP 合成验收', locale: 'zh-CN', provenance_kind: 'demo', data: [], content };
  const before = app.store.list('artifact').length;
  const valid = await call('components_validate', draft);
  assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
  assert.equal(app.store.list('artifact').length, before, 'Validation must not publish anything');
  const invalid = structuredClone(draft); invalid.content.sections[0].blocks[1].data_id = 'missing-binding'; delete invalid.content.sections[0].blocks[1].rows;
  const rejected = await call('components_validate', invalid);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.diagnostics.length > 0);
  const missingMapping = structuredClone(line); delete missingMapping.options.x;
  const mappingFailure = await call('components_validate', { title: draft.title, provenance_kind: 'demo', component: missingMapping });
  assert.equal(mappingFailure.valid, false, 'Discovery and validation use the same required chart mappings');

  // The short form accepts the exact discovered example without document scaffolding.
  const concise = { operation_id: 'components-mcp-single', title: '单组件合成验收', provenance_kind: 'demo', component: line };
  assert.equal((await call('components_show', concise)).ref.kind, 'report');
  const simpleInput = { target: 'answer', provenance_kind: 'demo', component: line };
  assert.equal((await call('components_validate', simpleInput)).valid, true);
  const simple = await call('components_show', simpleInput);
  const simpleArtifact = app.runtime.contractArtifacts.read(simple.ref);
  assert.equal(simpleArtifact.manifest.content.provenance.kind, 'demo');
  const simpleStored = JSON.parse(app.runtime.contractArtifacts.resource(simple.ref, 'sesame-report-input.json').bytes.toString()).input;
  assert.deepEqual(simpleStored.content.sections[0].blocks[0].columns, [...new Set(line.rows.flatMap(Object.keys))]);
  assert.equal(simpleStored.content.sections[0].blocks[0].takeaway, undefined);
  assert.equal(simpleStored.content.sections[0].blocks[0].source_note, undefined);
  assert.notEqual((await call('components_show', simpleInput)).ref.id, simple.ref.id, 'A new MCP call with identical content is a new intent, not a content-hash retry');
  const answer = await call('components_show', { ...concise, operation_id: 'components-mcp-answer', target: 'answer', summary: '只用于报告索引的摘要' });
  const answerArtifact = app.runtime.contractArtifacts.read(answer.ref);
  assert.deepEqual(answerArtifact.manifest.content.rendering.presentation.metadata, { layout: 'unified', surface: 'answer', protocol: 'sesame-components/1' });
  const answerInput = JSON.parse(app.runtime.contractArtifacts.resource(answer.ref, 'sesame-report-input.json').bytes.toString());
  assert.equal(answerInput.input.target, 'answer', 'Answer placement is part of the fixed input, not just tool output');
  // Mount the real published package through the host, which rebuilds HTML roots
  // and verifies packaged assets. A raw HTML preview cannot prove this path.
  const { chromium } = createRequire(join(hostRoot, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 800 } }), browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(app.launchUrl);
  await page.evaluate(async report => {
    const { mountArtifactReport } = await import('/modules/frontend/report-runtime/artifact-host.js');
    const container = document.createElement('main'); container.id = 'component-mcp-preview';
    container.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--bg,#fff);padding:20px';
    document.body.append(container);
    const dispose = await mountArtifactReport(container, report, async path => {
      const response = await fetch(`/api/v1${path}`);
      if (!response.ok) throw new Error(`Report request failed: ${response.status}`);
      return response.json();
    }, { sizeToContent: true });
    container.querySelector('iframe').style.cssText += ';display:block;width:100%;border:0';
    await dispose.ready;
  }, app.runtime.report(answer.ref.id, 1));
  const frame = page.frameLocator('#component-mcp-preview iframe');
  await frame.locator('#content-chart-1 svg').waitFor();
  assert.equal(await frame.locator('.report-header').isVisible(), false);
  assert.equal(await frame.locator('.report-subtitle').isVisible(), false);
  assert.equal(await frame.locator('#content-chart-1 svg').getAttribute('aria-label'), line.kind);
  assert.equal(await frame.locator('figcaption strong').count(), 0, 'An unnamed chart does not acquire a generated visible title');
  assert.equal(await frame.locator('body').evaluate(body => getComputedStyle(body).padding), '0px');
  assert.equal(await page.locator('#component-mcp-preview iframe').getAttribute('sandbox'), 'allow-scripts');
  if (output) await page.locator('#component-mcp-preview').screenshot({ path: join(output, 'mcp-answer-host.png') });
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(browserErrors, []);
  await page.close();
  const parallel = await call('components_validate', { title: draft.title, provenance_kind: 'demo', components: [line, line], layout: 'columns' });
  assert.equal(parallel.valid, true, JSON.stringify(parallel.diagnostics));

  // Read fixed data through the real artifact protocol, not a mocked row reader.
  app.store.put('dataset', { id: 'components-fixed-data', rows: line.rows, provenance: { kind: 'demo' } });
  const snapshot = await host.capabilities.invoke('sesame/data-access#data_snapshot', { operationId: 'components-fixed-snapshot', title: 'Components fixed data', source: { providerId:'host#datasets', revision:'host:2' }, input: { datasetId:'components-fixed-data' } });
  assert.equal(snapshot.type, 'result');
  const boundChart = { ...line, data_id: 'series' }; delete boundChart.rows;
  const bound = { title: draft.title, provenance_kind: 'demo', component: boundChart, data: [{ id: 'series', ref: snapshot.value.ref, usage: 'Synthetic component series' }] };
  const boundValidation = await call('components_validate', bound);
  assert.equal(boundValidation.valid, true, JSON.stringify(boundValidation.diagnostics));
  const boundReport = await call('components_show', { ...bound, operation_id: 'components-mcp-bound' });
  assert.ok(app.runtime.contractArtifacts.read(boundReport.ref).manifest.dependencies.some(ref => ref.digest === snapshot.value.ref.digest));
  const inherited = await call('components_show', { component: boundChart, data: bound.data, target: 'answer' });
  assert.equal(app.runtime.contractArtifacts.read(inherited.ref).manifest.content.provenance.kind, 'demo', 'Fixed data provenance is inherited without an extra agent field');
  const publication = { ...draft, operation_id: 'components-mcp-publication' };
  const shown = await call('components_show', publication);
  assert.equal(shown.ref.kind, 'report');
  for (const key of ['id', 'revision', 'digest', 'schemaVersion']) assert.equal(typeof shown.ref[key], 'string');
  assert.ok(!JSON.stringify(shown).includes('<!doctype'), 'Tool responses carry fixed references, not large HTML');
  assert.deepEqual((await call('components_show', publication)).ref, shown.ref, 'Retries preserve one report revision');
  const artifact = app.runtime.contractArtifacts.read(shown.ref);
  assert.equal(artifact.manifest.content.rendering.provider.pluginId, 'sesame/reports');
  const html = app.runtime.contractArtifacts.resource(shown.ref, 'index.html').bytes.toString();
  assert.match(html, /9007199254740993\.0000001/);
  assert.doesNotMatch(html, /id="sesame-evidence-appendix-runtime"/);
  const inspection = await host.capabilities.invoke('sesame/reports#report_check', { ref: shown.ref });
  assert.equal(inspection.type, 'result');
  assert.equal(inspection.value.status, 'rendered', JSON.stringify(inspection.value.diagnostics));
  assert.deepEqual(inspection.value.checks.map(check => check.width), [1000, 390]);
  assert.deepEqual(inspection.value.diagnostics, []);
  await app.runtime.reportLibrary.flush();
  assert.ok((await app.runtime.reportLibrary.list({ space: 'research', recursive: true })).entries.some(entry => entry.reportId === shown.ref.id));

  // The existing stdio adapter must expose the same real MCP tools without a new server.
  const child = spawn(process.execPath, [join(hostRoot, 'scripts/plugin-mcp.mjs')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MT5AGENT_MCP_URL: `${app.origin}/api/v1/mcp`, MT5AGENT_MCP_TOKEN: access.token } });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 'stdio-list', method: 'tools/call', params: { name: 'components_list', arguments: { query: 'chart', limit: 2 } } }) + '\n');
  assert.equal(await exited, 0, stderr);
  const stdio = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(stdio.length, 1); assert.equal(stdio[0].id, 'stdio-list');
  assert.equal(stdio[0].result?.isError, false, JSON.stringify(stdio[0].error));
  assert.ok(stdio[0].result.structuredContent.items.length <= 2);
  await app.runtime.plugins.configure('sesame/reports', 'disabled', app.runtime.plugins.policy().version);
  assert.ok(!(await rpc('tools/list')).body.result.tools.some(tool => names.includes(tool.name)));
  assert.ok((await rpc('tools/call', { name: 'components_list', arguments: {} })).body.error);
  assert.equal(modelCalls, 0);
  if (output) {
    await writeFile(join(output, 'mcp-publication.html'), html);
    await writeFile(join(output, 'mcp-verification.json'), JSON.stringify({ version, transports: ['Streamable HTTP', 'stdio adapter'], tools: names,
      fixedReport: shown.ref, inspection: inspection.value, modelCalls, scope: 'Synthetic values in an isolated host; no user workspace or account accessed.' }, null, 2) + '\n');
  }
  t.diagnostic(JSON.stringify({ version, tools: names.length, transports: 2, inspection: inspection.value.status, modelCalls }));
});
