/** Real API2 installation, state persistence and renderer integration.
 * All content and data are synthetic software fixtures. The temporary host has
 * no user account, network provider, real model call or daily application state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLock } from '../scripts/plugin-lock.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
const output = process.env.SESAME_REPORT_CONTENT_HOST_OUTPUT;
const core = fileURLToPath(new URL('../', import.meta.url));

test('real API2 Report stores versioned styles and renders content bound to exact data and style revisions', { skip: !hostRoot, timeout: 120000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)).href);
  const previousEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(MT5AGENT_|SESAME_)/.test(key)));
  for (const key of Object.keys(previousEnvironment)) delete process.env[key];
  process.env.SESAME_OFFICIAL_PLUGINS_REQUIRED = '1';
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-report-content-host-')));
  let runtime, store, host, models, stage = 'initialization', modelCalls = 0, networkCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls++; throw Error('Network is prohibited in this synthetic Report host fixture'); };
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  try {
    const sourceStage = join(root, 'source'), bundle = join(root, 'bundle');
    await mkdir(join(sourceStage, 'packages'), { recursive: true }); await mkdir(bundle);
    for (const name of ['workspace', 'data-access']) await cp(join(core, 'packages', name), join(sourceStage, 'packages', name), { recursive: true });
    const lock = buildLock(sourceStage);
    for (const item of lock.packages) await cp(join(sourceStage, 'packages', item.directory), join(bundle, item.directory), { recursive: true });
    await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const [{ Store }, { Runtime }, { ModelRuntime }, { createHostContextV2 }] = await Promise.all([
      load('modules/agent/store.js'), load('modules/agent/runtime.js'),
      load('node_modules/@earendil-works/pi-coding-agent/dist/index.js'), load('modules/plugins/host-v2/context.js'),
    ]);
    models = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    models.registerProvider('uncalled-report-fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'synthetic-never-called',
      models: [{ id: 'unused', name: 'Uncalled synthetic fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    const open = async () => {
      store = new Store(join(root, 'state'));
      runtime = await new Runtime(store, { officialPluginsDirectory: bundle, piDir: join(root, 'pi'), modelRuntime: models, model: models.getModel('uncalled-report-fixture', 'unused') }).init();
      runtime.modelTransport.fetch = async () => { modelCalls++; throw Error('Models are prohibited in this fixture'); };
      host = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
    };
    await open();
    const invoke = async (name, input) => {
      const result = await host.capabilities.invoke('sesame/reports#' + name, input);
      assert.equal(result.type, 'result'); return result.value;
    };
    const workspace = runtime.workspaces.root('conv_main'); await mkdir(workspace, { recursive: true });
    const draft = join(workspace, 'reports-draft'); await cp(join(core, 'packages/reports'), draft, { recursive: true });
    stage = 'real plugin test and install';
    const checked = await runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(checked.passed, true, JSON.stringify(checked));
    const installed = await runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
    assert.equal(installed.runtime_status, 'ready'); assert.equal(installed.version, JSON.parse(await readFile(join(core,'packages/reports/plugin.json'),'utf8')).version);
    for (const name of ['report_styles', 'report_style_save', 'report_document_template', 'report_publish', 'report_check']) {
      assert.ok(runtime.plugins.definitions({ conversationId: 'conv_main' }).some(tool => tool.name === name), name + ' is registered');
    }

    stage = 'declared collection query';
    const initial = await invoke('report_styles', {});
    assert.equal(initial.default.id, 'unified'); assert.equal(Object.hasOwn(initial,'presets'),false); assert.deepEqual(initial.saved, []);
    const styleDefinition = { reason: 'Synthetic comparison needs a readable figure', tokens: { accent: '#334eac', context: '#71717a', accent_dark: '#7da9ff', heading: 'sans', body_size: 17, content_width: 1000, section_gap: 48, chart_height: 300, columns: 2 } };
    const create = { operation_id: 'fixture-style-create', id: 'synthetic-comparison', title: '合成比较样式', description: '仅验证真实宿主状态；不表示行情或模型结果', style: styleDefinition, expected_version: 0 };
    stage = 'real state commit and compare-and-swap';
    const first = await invoke('report_style_save', create);
    assert.equal(first.version, 1); assert.deepEqual(first.style, { saved_id: create.id, saved_version: 1 });
    assert.deepEqual(await invoke('report_style_save', create), first, 'same operation is idempotent');
    await assert.rejects(invoke('report_style_save', { ...create, title: 'changed under reused operation' }), /operation|different|conflict/i);
    await assert.rejects(invoke('report_style_save', { ...create, operation_id: 'fixture-stale-create' }), /version|conflict/i);
    const updated = await invoke('report_style_save', { ...create, operation_id: 'fixture-style-update', expected_version: 1,
      style: { ...styleDefinition, tokens: { ...styleDefinition.tokens, body_size: 19, accent: '#667788' } } });
    assert.equal(updated.version, 2);
    await assert.rejects(invoke('report_style_save', { ...create, operation_id: 'fixture-stale-update', expected_version: 1 }), /version|conflict/i);
    await assert.rejects(invoke('report_style_save', { ...create, operation_id: 'fixture-css', id: 'unsafe-style',
      style: { ...styleDefinition, tokens: { ...styleDefinition.tokens, css: 'body{display:none}' } } }), /schema|property|invalid|token/i);
    const listing = await invoke('report_styles', {});
    assert.equal(listing.saved.length, 1); assert.deepEqual(listing.saved[0].style, updated.style);
    assert.equal(listing.saved[0].definition.tokens.body_size, 19);

    // These are real host.state calls, not a mock or direct database mutations.
    const reportHost = createHostContextV2(runtime, runtime.plugins.entries.get('sesame/reports'), 'conv_main');
    const key = { collection: 'report-styles', key: create.id };
    const historicalState = await reportHost.state.read(key, { version: 1 });
    assert.equal(historicalState.version, 1); assert.deepEqual(historicalState.value.style, styleDefinition);
    assert.equal((await reportHost.state.read(key)).version, 2);
    const page = await reportHost.state.query({ collection: 'report-styles', limit: 1 });
    assert.equal(page.items.length, 1); assert.equal(page.items[0].version, 2); assert.deepEqual(page.items[0].key, key);
    await assert.rejects(reportHost.state.commit([{ op: 'put', key, expectedVersion: 2,
      value: { ...page.items[0].value, style: { ...styleDefinition, tokens: { css: 'body{display:none}' } } },
    }], { operationId: 'invalid-direct-style-state' }), /schema/i);
    assert.equal((await reportHost.state.read(key)).version, 2, 'failed state schema validation cannot create a new version');
    assert.throws(() => reportHost.state.read(key, { version: 3 }), /not exist|not found/i);
    assert.throws(() => host.state.read({ collection: 'sesame/reports::report-styles', key: create.id }), /private|undeclared|forbidden/i);

    stage = 'restart persistence and fixed-version template';
    await close(); await open();
    assert.equal(runtime.plugins.entry('sesame/reports').runtime_status, 'ready');
    assert.deepEqual((await invoke('report_styles', {})).saved[0].style, updated.style);
    const rows = [{ label: '合成甲', value: 2 }, { label: '合成乙', value: 5 }];
    store.put('dataset', { id: 'synthetic-style-results', rows, provenance: { kind: 'demo' } });
    const snapshot = await invoke('report_data', { operation_id: 'synthetic-style-data', dataset_id: 'synthetic-style-results' });
    const data = [{ id: 'comparison', ref: snapshot.ref, usage: 'Synthetic software fixture values' }];
    const content = { kind: 'document', sections: [{ title: '合成软件验收', blocks: [
      { type: 'judgment', text: '演示：报告只显示输入的内容和数值', note: '没有执行模型或读取市场数据。' },
      { type: 'group', layout: 'columns', blocks: [
        { type: 'range', label: '输入区间', min: 0, max: 10, value: 5, unit: '个', note: '预先给定的合成数值' },
        { type: 'scores', min: 0, max: 10, unit: '分', items: [{ label: '输入分数', value: 4, note: '不表示概率' }] },
      ] },
      { type: 'formula', latex: String.raw`\frac{1}{2} + \sqrt{4}`, caption: '合成公式' },
      { type: 'chart', title: '固定引用数据', kind: 'bar', columns: ['label', 'value'], options: { x: 'label', y: 'value' },
        data_id: 'comparison', takeaway: '仅展示固定快照中的两个输入数值', source_note: 'Synthetic fixture; not observed market data' },
      { type: 'details', title: '完整合成证据说明', blocks: [{ type: 'paragraph', text: '<script>Not executable</script> 是原始文字' }] },
    ] }] };
    const args = { title: '真实隔离宿主 · 合成内容验收', summary: 'DEMO：只验证 API2 内容、样式和渲染契约', provenance_kind: 'demo', locale: 'zh-CN', data, content, style: first.style };
    const preview = await invoke('report_document_template', { ...args, output_path: 'synthetic-content-preview.html' });
    assert.equal(preview.editable, false); assert.deepEqual(preview.publish, { content, style: first.style });
    const previewHtml = await readFile(join(workspace, 'synthetic-content-preview.html'), 'utf8');
    assert.match(previewHtml, /--report-body-size:17px;/); assert.match(previewHtml, /--report-accent:#334eac;/);
    assert.doesNotMatch(previewHtml, /--report-body-size:19px;/);
    await assert.rejects(invoke('report_document_template', { ...args, output_path: 'wrong-version.html', style: { saved_id: create.id, saved_version: 99 } }), /not exist|not found|version/i);
    await assert.rejects(invoke('report_document_template', { ...args, output_path: 'html-rejected.html', body_html: '<h1>Untrusted HTML</h1>' }), /schema|property|HTML|invalid/i);

    stage = 'content publication and actual dual-viewport renderer';
    const published = await invoke('report_publish', { ...args, ...preview.publish, operation_id: 'synthetic-content-publication' });
    assert.equal(published.renderStatus, 'not_checked');
    const artifact = runtime.contractArtifacts.read(published.ref);
    assert.ok(artifact.manifest.dependencies.some(ref=>ref.id===snapshot.ref.id && ref.digest===snapshot.ref.digest));
    assert.equal(artifact.manifest.content.provenance.kind, 'demo');
    assert.deepEqual(runtime.contractArtifacts.reportData(published.ref, 'comparison').rows, rows);
    const html = runtime.contractArtifacts.resource(published.ref, 'index.html').bytes.toString('utf8');
    assert.match(html, /--report-body-size:17px;/); assert.match(html, /&lt;script&gt;Not executable&lt;\/script&gt;/);
    const inspected = await invoke('report_check', { ref: published.ref });
    assert.deepEqual(inspected.artifact, published.ref); assert.equal(inspected.renderer.name, 'sesame-report-inspector');
    assert.equal(inspected.status, 'rendered', JSON.stringify(inspected));
    assert.deepEqual(inspected.checks.map(check => check.width), [1000, 390]);
    assert.deepEqual(inspected.diagnostics, []);
    const read = await invoke('report_read', { ref: published.ref, include_checks: true });
    assert.ok(read.checks.some(receipt => receipt.id === inspected.id), 'real rendered receipt persists with this exact published revision');
    stage = 'host-only provider and complete fixed input JSON';
    const hostCall = async (id, input) => { const result=await host.capabilities.invoke(id,input); assert.equal(result.type,'result'); return result.value; };
    const description=await hostCall('host.reports.describe',{});
    assert.equal(description.provider.pluginId,'sesame/reports');
    assert.ok(description.inputSchema.$defs.block,'host describes the selected plugin component schema');
    assert.equal(runtime.plugins.definitions({conversationId:'conv_main'}).some(tool=>tool.name==='report_render'),false,'internal renderer is not an agent tool');
    const completeInput={content,style:first.style};
    const inputBytes=JSON.stringify(completeInput);
    const inputResource=await host.resources.create({kind:'file',name:'input.json',lifetime:'durable',source:{content:inputBytes,encoding:'utf8'}});
    const inputArtifact=await host.resources.publish(inputResource,{kind:'resource',schemaVersion:'1.0.0',content:{title:'Synthetic complete provider input'},dependencies:[snapshot.ref],blobs:[{entry:'input.json',path:'input.json',mediaType:'application/json'}]}, {operationId:'synthetic-provider-input'});
    const viaRef={operationId:'synthetic-content-fixed-input',title:args.title,summary:args.summary,locale:args.locale,provenanceKind:'demo',data,inputRef:{ref:inputArtifact.ref,entry:'input.json'}};
    const byRef=await hostCall('host.reports.publish',viaRef);
    assert.deepEqual(await hostCall('host.reports.publish',viaRef),byRef,'retry reuses exact host publication');
    const recordedInput=JSON.parse(runtime.contractArtifacts.resource(byRef.ref,'sesame-report-input.json').bytes.toString('utf8'));
    assert.deepEqual(recordedInput.input,completeInput,'long content and formula escapes are not retyped');
    assert.deepEqual(runtime.contractArtifacts.resource(byRef.ref,'index.html').bytes,runtime.contractArtifacts.resource(published.ref,'index.html').bytes,'inline input and complete JSON reference produce identical content bytes');
    assert.ok(runtime.contractArtifacts.read(byRef.ref).manifest.dependencies.some(ref=>ref.id===inputArtifact.ref.id&&ref.digest===inputArtifact.ref.digest));
    const viaFacade=await invoke('report_publish',{operation_id:'synthetic-facade-fixed-input',title:args.title,summary:args.summary,locale:args.locale,provenance_kind:'demo',data,input_ref:viaRef.inputRef});
    assert.deepEqual(runtime.contractArtifacts.resource(viaFacade.ref,'index.html').bytes,runtime.contractArtifacts.resource(byRef.ref,'index.html').bytes);
    stage = 'packaged attachment component through complete fixed input JSON';
    assert.ok(description.inputSchema.$defs.block.oneOf.some(block=>block.properties.type.const==='attachments'));
    const evidencePath='evidence/samples.json', evidenceEntry=runtime.contractArtifacts.read(snapshot.ref).manifest.blobs.find(blob=>blob.mediaType==='application/json').path;
    const attachmentInput={...completeInput,content:{...content,appendix:[{type:'details',title:'完整合成附件',blocks:[{type:'attachments',items:[{label:'下载完整样本',path:evidencePath,description:'合成输入；不代表行情'}]}]}]},
      assets:[{path:evidencePath,ref:snapshot.ref,entry:evidenceEntry,media_type:'application/json'}]};
    const attachmentResource=await host.resources.create({kind:'file',name:'attachment-input.json',lifetime:'durable',source:{content:JSON.stringify(attachmentInput),encoding:'utf8'}});
    const attachmentSource=await host.resources.publish(attachmentResource,{kind:'resource',schemaVersion:'1.0.0',content:{title:'Synthetic input with exact attachment'},dependencies:[snapshot.ref],blobs:[{entry:'attachment-input.json',path:'input.json',mediaType:'application/json'}]}, {operationId:'synthetic-attachment-input'});
    const attachmentPublished=await hostCall('host.reports.publish',{...viaRef,operationId:'synthetic-attachment-publication',inputRef:{ref:attachmentSource.ref,entry:'input.json'}});
    assert.match(runtime.contractArtifacts.resource(attachmentPublished.ref,'index.html').bytes.toString('utf8'),/<a href="evidence\/samples\.json">下载完整样本<\/a>/);
    assert.deepEqual(runtime.contractArtifacts.resource(attachmentPublished.ref,evidencePath).bytes,runtime.contractArtifacts.resource(snapshot.ref,evidenceEntry).bytes,'packaged download preserves the exact original bytes');
    const attachmentInspected=await invoke('report_check',{ref:attachmentPublished.ref});
    assert.equal(attachmentInspected.status,'rendered',JSON.stringify(attachmentInspected));
    assert.deepEqual(attachmentInspected.diagnostics,[]);
    const wrongAttachmentInput=structuredClone(attachmentInput);
    wrongAttachmentInput.content.appendix[0].blocks[0].items[0].path='evidence/unregistered.json';
    const wrongAttachmentRequest={...viaRef,operationId:'bad-undeclared-attachment',input:wrongAttachmentInput};delete wrongAttachmentRequest.inputRef;
    await assert.rejects(hostCall('host.reports.publish',wrongAttachmentRequest),/declared packaged asset/i);
    const badContent={...viaRef,operationId:'bad-provider-content',input:{content:{kind:'document',sections:[{title:'Bad',blocks:[{type:'html',text:'<script>bad()</script>'}]}]}}};delete badContent.inputRef;
    await assert.rejects(hostCall('host.reports.publish',badContent),/schema|input|property/i);
    await assert.rejects(invoke('report_document_template',{...args,style:{preset:'editorial'},output_path:'old-preset-rejected.html'}),/schema|property|invalid/i);
    assert.equal(modelCalls, 0); assert.equal(networkCalls, 0);
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(join(output, 'isolated-host-report.html'), html);
      await writeFile(join(output, 'isolated-host-receipt.json'), JSON.stringify({ status: 'passed', checkedAt: new Date().toISOString(),
        fixture: 'synthetic content/data in a temporary isolated real API2 host; not a real model or market result',
        installation: { version: installed.version, digest: checked.digest, runtime_status: installed.runtime_status },
        modelCalls, networkCalls, state: { createdVersion: first.version, latestVersion: updated.version, renderedVersion: first.version, persistedAcrossRestart: true, rawQueryShapeVerified: true, privateCollectionVerified: true },
        publication: published, inspection: inspected, attachmentPublication: attachmentPublished, attachmentInspection: attachmentInspected,
        verified: ['real manager test/install and public capability schemas', 'real declared state query/read/commit', 'idempotency and stale-version refusal', 'saved exact version remains immutable after update and restart', 'unsafe token and custom HTML rejection', 'generic content with fixed data binding', 'real host Playwright renderer at 1000 and 390 pixels', 'exact immutable render receipt readback', 'host-selected renderer hidden from agent tools', 'complete inputRef JSON preserves exact formula and content bytes', 'inline and inputRef packages are byte-identical', 'host publication retry and facade share the same path'],
      }, null, 2) + '\n');
    }
    t.diagnostic(JSON.stringify({ version: installed.version, savedVersions: [first.version, updated.version], renderedVersion: first.version, inspection: inspected.status, widths: inspected.checks.map(check => check.width), modelCalls, networkCalls }));
  } catch (error) {
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(join(output, 'isolated-host-failure.json'), JSON.stringify({ status: 'failed', checkedAt: new Date().toISOString(), stage,
        code: error.code, message: error.message, modelCalls, networkCalls, isolated: true }, null, 2) + '\n');
    }
    throw error;
  } finally {
    await close(); globalThis.fetch = previousFetch; await rm(root, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (/^(MT5AGENT_|SESAME_)/.test(key)) delete process.env[key];
    Object.assign(process.env, previousEnvironment);
  }
});
