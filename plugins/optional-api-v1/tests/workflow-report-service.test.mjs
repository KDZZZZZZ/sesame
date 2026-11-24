import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCapabilities } from '../../api-v1/packages/reports/index.js';
import { reportDescription } from './workflow-report-fixture.mjs';
import { resourceFixture } from '../../api-v1/tests/mt5-resource-fixture.js';
import { writeDailyReport } from '../packages/trading-decision/reports.js';

// Real report service source and published bytes; the inspector is an explicit
// synthetic port, not browser/rendering or installed-host verification.
async function fixture(t) {
  const directory = await mkdtemp(join(fileURLToPath(new URL('.', import.meta.url)), '.workflow-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = { context: { pluginId: 'sesame/reports', pluginVersion: 'fixture', pluginRevision: 'fixture', workspaceRoot: directory } };
  const resources = resourceFixture(host), receipts = new Map(), calls = [];
  const state = { renderer: 'sesame-report-inspector', status: 'rendered', wrongRevision: false };
  const create = host.resources.create, read = host.resources.read;
  host.resources.create = async (input, options) => create(input.source?.path ? { ...input, source: { content: (await readFile(input.source.path)).toString('base64'), encoding: 'base64' } } : input, options);
  host.resources.read = async (ref, options) => {
    if (options.part === 'receipts') return { items: structuredClone(receipts.get(ref.id) ?? []) };
    if (resources.managed.has(ref.id)) {
      const bytes = resources.managed.get(ref.id).bytes, offset = options.offset ?? 0, end = Math.min(bytes.length, offset + (options.length ?? bytes.length));
      return { content: bytes.subarray(offset, end).toString(options.encoding ?? 'utf8'), total: bytes.length, ...(end < bytes.length ? { nextOffset: end } : {}) };
    }
    return read(ref, options);
  };
  host.views = { inspect: async target => {
    assert.equal(target.surface, 'artifact');
    const items = receipts.get(target.ref.id) ?? [];
    const receipt = { artifact: { ...target.ref, ...(state.wrongRevision ? { revision: 'wrong-revision' } : {}) }, renderer: { name: state.renderer }, status: state.status, observedAt: items.length + 1 };
    items.push(receipt); receipts.set(target.ref.id, items); return receipt;
  } };
  const handlers = createCapabilities(host);
  host.capabilities = { invoke: async (id, input, options = {}) => {
    calls.push({ id, input: structuredClone(input) });
    if (id === 'sesame/workspace#write') {
      const path = join(directory, input.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, input.content);
      return { type: 'result', value: { path } };
    }
    if (id === 'host.reports.describe') return { type: 'result', value: reportDescription() };
    if (id === 'host.reports.publish') {
      const metadata = { title:input.title, summary:input.summary, locale:input.locale ?? 'zh-CN', provenanceKind:input.provenanceKind, features:input.features ?? [] };
      const rendered = await handlers.find(handler => handler.name === 'report_render').execute({ metadata, input:input.input, data:input.data ?? [], related:input.related ?? [], references:input.references ?? [] }, options.signal);
      const root = await host.resources.create({kind:'directory',lifetime:'durable',name:'fixture-report'}, {operationId:input.operationId+':root'});
      for (const file of rendered.files) await host.resources.create({kind:'file',parent:root,lifetime:'durable',name:file.path,source:{content:file.content,encoding:file.encoding}}, {operationId:input.operationId+':'+file.path});
      const provenance = {kind:input.provenanceKind,references:input.references ?? []};
      const published = await host.resources.publish(root, {kind:'report',schemaVersion:'1.0.0',content:{title:input.title,summary:input.summary,entry:rendered.entry,runtime:'sesame-report/1',runtimeRevision:'1.0.0',data:input.data ?? [],provenance},dependencies:input.references ?? [],provenance,
        blobs:rendered.files.map(({path,mediaType})=>({path,mediaType}))}, {operationId:input.operationId});
      return {type:'result',value:{ref:published.ref,renderStatus:'not_checked'}};
    }
    assert.ok(id.startsWith('sesame/reports#'));
    const handler = handlers.find(value => value.name === id.split('#')[1]); assert.ok(handler);
    return { type: 'result', value: await handler.execute(input, options.signal) };
  } };
  return { host, state, calls, ...resources };
}
const decisionRun = () => ({ id: 'direct-service-decision', createdAt: 1, plan: { title: 'Fixed decision', reportFolder: 'Retained-plan-location', researchRefs: [] }, status: 'completed', executionDisposition: 'withheld_by_review',
  reports: [{ role: 'manager', status: 'completed', text: '# Frozen decision\n\nNo trade after the blocked review.' }], decision: { unchanged: true, targets: [] }, reviewChecks: { reviewer: { verdict: 'block' } } });

test('native decision report sends content directly through the common publication service without another Agent', async t => {
  const f = await fixture(t), run = decisionRun(), report = await writeDailyReport(f.host, run);
  const html = (await f.host.resources.read(report.ref, { part: 'content', entry: report.entry })).content;
  assert.match(html, /data-sesame-report/); assert.match(html, /--report-/);
  assert.match(html, /<h1>Frozen decision<\/h1>/); assert.match(html, /复核阻止本轮执行/);
  assert.equal(report.renderStatus, 'rendered'); assert.equal(report.inspection.renderer.name, 'sesame-report-inspector');
  assert.deepEqual(JSON.parse((await f.host.resources.read(report.ref, { part: 'content', entry: 'run.json' })).content), run);
  assert.deepEqual(f.calls.filter(call => call.id.startsWith('sesame/reports#')).map(call => call.id.split('#')[1]), ['components_show', 'report_check']);
  const publication = f.calls.find(call => call.id.endsWith('#components_show')).input;
  assert.equal(publication.target, 'report');
  assert.equal(publication.lead, '本轮决定维持当前仓位。');
  assert.deepEqual(publication.highlights, [{ label: '交易执行', value: '复核阻止本轮执行，未执行交易。' }]);
  assert.equal(publication.content.kind, 'document');
  assert.equal(Object.hasOwn(publication, 'html_path'), false);
  assert.equal(Object.hasOwn(publication, 'body_html'), false);
  assert.equal(publication.style, undefined, 'Use the report provider default theme');
  assert.equal(f.calls.filter(call => call.id === 'sesame/workspace#write').length, 1, 'Only raw run evidence is written, never an intermediate HTML page');
});

test('untrusted attachment write return paths never become report sources or intermediate HTML templates', async t => {
  for (const mismatch of ['different-file', 'outside-workspace']) {
    const f = await fixture(t), invoke = f.host.capabilities.invoke;
    f.host.capabilities.invoke = async (id, input, options) => {
      const result = await invoke(id, input, options);
      if (id === 'sesame/workspace#write') result.value.path = mismatch === 'different-file' ? result.value.path + '.other' : join(f.host.context.workspaceRoot, '..', 'outside-report.html');
      return result;
    };
    const run = decisionRun(), report = await writeDailyReport(f.host, run);
    const publication = f.calls.find(call => call.id.endsWith('#components_show')).input;
    const write = f.calls.find(call => call.id === 'sesame/workspace#write').input;
    assert.deepEqual(publication.assets, [{ path: 'run.json', source_path: write.path, media_type: 'application/json' }]);
    assert.equal(Object.hasOwn(publication, 'html_path'), false);
    assert.equal(f.calls.some(call => call.id.endsWith('#report_document_template')), false);
    assert.deepEqual(JSON.parse((await f.host.resources.read(report.ref, { part: 'content', entry: 'run.json' })).content), run);
  }
});

test('export preflight or another report revision cannot satisfy actual workflow publication inspection', async t => {
  for (const mismatch of ['renderer', 'revision']) {
    const f = await fixture(t), run = decisionRun();
    if (mismatch === 'renderer') f.state.renderer = 'sesame-report-export-inspector'; else f.state.wrongRevision = true;
    const options = { onSnapshot: snapshot => { run.reportSnapshot = snapshot; }, onPublication: publication => { run.reportPublication = publication; } };
    await assert.rejects(writeDailyReport(f.host, run, options), { code: 'REPORT_NOT_RENDERED' });
    const ref = structuredClone(run.reportPublication.ref);
    f.state.renderer = 'sesame-report-inspector'; f.state.wrongRevision = false;
    const report = await writeDailyReport(f.host, run, options);
    assert.deepEqual(report.ref, ref); assert.equal(report.renderStatus, 'rendered');
    assert.equal(f.calls.filter(call => call.id.endsWith('#components_show')).length, 1);
  }
});

test('raw report evidence preserves inert HTML examples without authorizing executable report markup', async t => {
  const f = await fixture(t), run = decisionRun();
  run.reports[0].text += '\n\nAn inert source example: <iframe src="https://example.invalid"></iframe>';
  const report = await writeDailyReport(f.host, run);
  const html = (await f.host.resources.read(report.ref, { part: 'content', entry: report.entry })).content;
  assert.doesNotMatch(html, /<iframe\b/); assert.match(html, /&lt;iframe/);
  assert.deepEqual(JSON.parse((await f.host.resources.read(report.ref, { part: 'content', entry: 'run.json' })).content), run);
});

test('a retained decision-only snapshot archives through the installed provider and Electron inspector', {
  skip: !process.env.SESAME_HOST_ROOT, timeout: 120000,
}, async t => {
  const { pathToFileURL } = await import('node:url');
  const load = name => import(pathToFileURL(join(process.env.SESAME_HOST_ROOT, name)));
  const { fixture: createHost } = await load('tests/fixture-provider.js');
  const { createHostContextV2 } = await load('modules/plugins/host-v2/context.js');
  const app = await createHost({ optionalPlugins: ['trading-decision'], reportRenderer: 'electron' });
  t.after(() => app.dispose());
  const entry = app.runtime.plugins.entry('sesame/trading-decision');
  const host = createHostContextV2(app.runtime, entry, 'conv_main');
  const run = decisionRun();
  run.executionDisposition = 'decision_only';
  run.reports[0].text = '经理保留当前目标。\n\n' + '等待观察条件。'.repeat(600);
  const retained = structuredClone(run);
  run.reportSnapshot = retained;
  const result = await writeDailyReport(host, run, { onPublication: published => { run.reportPublication = published; } });
  assert.deepEqual(result.inspection.artifact, result.ref);
  assert.equal(result.renderStatus, 'rendered');
  const file = name => app.runtime.contractArtifacts.resource(result.ref, name).bytes.toString('utf8');
  const { input } = JSON.parse(file('sesame-report-input.json'));
  assert.equal(input.lead, '本轮决定维持当前仓位。');
  assert.deepEqual(input.highlights, [{ label: '交易执行', value: '本轮仅交付决策，未执行交易。' }]);
  assert.deepEqual(input.content.sections[0].blocks[0], { type: 'details', title: '查看完整经理总结', blocks: [{ type: 'markdown', text: retained.reports[0].text }] });
  assert.deepEqual(JSON.parse(file('run.json')), retained);
  assert.deepEqual((await writeDailyReport(host, run)).ref, result.ref);
});
