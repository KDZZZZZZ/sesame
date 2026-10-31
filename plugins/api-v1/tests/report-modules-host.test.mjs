/** Real host/registry/resource/report integration with explicit fictional data.
 * No market provider, account, model or user's application state is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildLock } from '../scripts/plugin-lock.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
test('real host loads adjustable field tools and publishes/checks default and user-shaped reports', { skip: !hostRoot, timeout: 300000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js'), { Runtime } = await load('modules/agent/runtime.js');
  const { ModelRuntime } = await load('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const source = fileURLToPath(new URL('../', import.meta.url));
  const example = JSON.parse(await readFile(join(source, 'packages/reports/examples/module-report-input.json'), 'utf8'));
  const visuals = JSON.parse(await readFile(join(source, 'packages/reports/examples/module-visual-fixtures.json'), 'utf8'));
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-report-modules-'))), bundle = join(root, 'bundle');
  const output = process.env.SESAME_REPORT_MODULE_OUTPUT;
  let store, runtime;
  try {
    const lock = buildLock(source); await mkdir(bundle);
    for (const pkg of lock.packages) await cp(join(source, 'packages', pkg.directory), join(bundle, pkg.directory), { recursive: true });
    await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    modelRuntime.registerProvider('fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'fixture', name: 'Uncalled fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    store = new Store(join(root, 'state'));
    runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: bundle, modelRuntime, model: modelRuntime.getModel('fixture', 'fixture') }).init();
    const entry = runtime.plugins.entry('sesame/reports');
    assert.equal(entry.runtime_status, 'ready', JSON.stringify(entry.diagnostics));
    let callNumber = 0;
    const call = async (name, args) => {
      const tool = runtime.plugins.definitions({ conversationId: 'conv_main' }).find(item => item.name === name);
      assert.ok(tool, `${name} must be available through the real tool registry`);
      const result = await tool.execute(`modules-${name}-${++callNumber}`, args);
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result.details;
    };
    const catalog = await call('report_structure', {});
    assert.equal(catalog.modules.length, 19); assert.equal(catalog.compositions.length, 11);
    const custom = await call('report_structure', example.custom_structure);
    assert.deepEqual(custom.sections.map(section => section.id), ['M02']);
    store.put('dataset', { id: 'historical-demo', rows: example.history_rows, provenance: { kind: 'demo' } });
    const history = await call('report_data', { operation_id: 'module-history', dataset_id: 'historical-demo' });
    const resolveDemoRefs = value => {
      if (Array.isArray(value)) return value.map(resolveDemoRefs);
      if (value && typeof value === 'object') return value.id === 'history' && value.digest ? history.ref : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveDemoRefs(item)]));
      return value;
    };
    example.rows = resolveDemoRefs(example.rows);
    visuals.rows = resolveDemoRefs(visuals.rows);
    store.put('dataset', { id: 'module-demo', rows: example.rows, provenance: { kind: 'demo' } });
    const data = await call('report_data', { operation_id: 'module-data', dataset_id: 'module-demo' });
    const receipts = [];
    for (const variant of ['default', 'custom']) {
      const composed = await call('report_compose', { output_path: `module-${variant}.html`, title: variant === 'default' ? example.title : '按用户要求调整 · 技术情景演示', summary: example.summary, structure: example[`${variant}_structure`], results_ref: data.ref });
      assert.equal(composed.researchValidation, 'not_evaluated'); assert.equal(composed.renderStatus, 'not_checked');
      const published = await call('report_publish', { ...composed.publish, operation_id: `module-report-${variant}` });
      const artifact = runtime.contractArtifacts.read(published.ref);
      assert.equal(artifact.manifest.content.provenance.kind, 'demo');
      assert.deepEqual(runtime.contractArtifacts.reportData(published.ref, 'research-results').rows, example.rows);
      const html = runtime.contractArtifacts.resource(published.ref, 'index.html').bytes.toString('utf8');
      assert.match(html, /data-sesame-provenance="demo"/);
      if (variant === 'custom') {
        assert.match(html, /哪些证据会改变判断/);
        assert.doesNotMatch(html, /<h2>新闻主题|<h3>结果概率/);
      }
      let receipt;
      if (process.env.SESAME_REPORT_INSPECT === '1') {
        receipt = await call('report_check', { ref: published.ref });
        assert.equal(receipt.status, 'rendered', JSON.stringify(receipt));
        assert.deepEqual(receipt.checks.map(check => check.width), [1000, 390]);
      }
      receipts.push({ variant, ref: published.ref, completeness: composed.completeness, researchValidation: composed.researchValidation, render: receipt ?? { status: 'not_checked' } });
      if (output) {
        await mkdir(output, { recursive: true });
        await writeFile(join(output, `report-modules-${variant}.html`), html);
        await writeFile(join(output, `report-modules-${variant}.manifest.json`), JSON.stringify(artifact.manifest, null, 2) + '\n');
      }
    }
    store.put('dataset', { id: 'visual-demo', rows: visuals.rows, provenance: { kind: 'demo' } });
    const visualData = await call('report_data', { operation_id: 'module-visual-data', dataset_id: 'visual-demo', dependencies: [history.ref] });
    const index = [];
    const requested = process.env.SESAME_REPORT_MODULE_TEMPLATES?.split(',');
    const templates = [...catalog.modules, ...catalog.compositions].filter(template => !requested || requested.includes(template.id));
    if (requested) assert.equal(templates.length,new Set(requested).size,'Every requested recheck template must exist');
    for (const template of templates) {
      const composed = await call('report_compose', { output_path: `visual-${template.id}.html`, title: template.title, structure: { template_id: template.id }, results_ref: visualData.ref });
      const published = await call('report_publish', { ...composed.publish, operation_id: `visual-${template.id}` });
      const html = runtime.contractArtifacts.resource(published.ref, 'index.html').bytes.toString('utf8');
      const config = JSON.parse(html.match(/id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
      assert.ok(config.length >= 2, `${template.id} should render its visual candidates`);
      let render;
      if (process.env.SESAME_REPORT_INSPECT === '1') {
        render = await call('report_check', { ref: published.ref });
        assert.equal(render.status, 'rendered', `${template.id}: ${JSON.stringify(render)}`);
        assert.deepEqual(render.diagnostics, [], `${template.id}: ${JSON.stringify(render.diagnostics)}`);
      }
      index.push({ id: template.id, title: template.title, charts: config.length, ref: published.ref, render });
      if (output) await writeFile(join(output, `visual-${template.id}.html`), html);
    }
    const customExamples = [];
    for (const [index, example] of visuals.custom_examples.entries()) {
      const file = `custom-${index + 1}.html`;
      const composed = await call('report_compose', { output_path: file, title: example.title, structure: example.structure, results_ref: visualData.ref });
      for (const [i,section] of example.structure.sections.entries()) assert.deepEqual(composed.structure.sections[i].fields.map(field => field.key), section.fields.map(field => typeof field === 'string' ? field : field.key));
      const published = await call('report_publish', {...composed.publish,operation_id:`custom-example-${index+1}`});
      let render;
      if (process.env.SESAME_REPORT_INSPECT === '1') {
        render = await call('report_check', {ref:published.ref});
        assert.equal(render.status,'rendered',JSON.stringify(render));
        assert.deepEqual(render.diagnostics,[]);
      }
      customExamples.push({title:example.title,file,ref:published.ref,render});
      if (output) await writeFile(join(output,file),runtime.contractArtifacts.resource(published.ref,'index.html').bytes.toString('utf8'));
    }
    // A changed binding cannot publish the static projection of the original source.
    const malformed = await call('report_compose', { output_path: 'missing-binding.html', title: 'Demo', structure: example.custom_structure, results_ref: data.ref });
    const publishTool = runtime.plugins.definitions({ conversationId: 'conv_main' }).find(item => item.name === 'report_publish');
    await assert.rejects(publishTool.execute('missing-binding', { ...malformed.publish, data: [], operation_id: 'missing-binding' }), /original fixed data/);
    if (output) {
      await writeFile(join(output, 'report-modules-verification.json'), JSON.stringify({ version: JSON.parse(await readFile(join(source, 'packages/reports/plugin.json'), 'utf8')).version, source: 'fictional demo', modelExecuted: false, receipts, visualTemplates: index,customExamples }, null, 2) + '\n');
      await writeFile(join(output, 'report-modules-input.json'), JSON.stringify(example, null, 2) + '\n');
    }
    t.diagnostic(JSON.stringify({ catalog: { modules: catalog.modules.length, compositions: catalog.compositions.length }, reports: receipts.map(item => ({ variant: item.variant, status: item.render.status })), visualTemplates: index.map(item => ({ id: item.id, charts: item.charts, status: item.render?.status ?? 'not_checked' })) }));
  } finally { await runtime?.close(); store?.close(); await rm(root, { recursive: true, force: true }); }
});
