import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCapabilities } from '../../api-v1/packages/reports/index.js';
import { resourceFixture } from '../../api-v1/tests/mt5-resource-fixture.js';
import { writeDailyReport } from '../packages/trading-decision/reports.js';
import { archiveReport } from '../packages/auto-factor-mining/archive.js';

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
      return { type: 'result', value: { path: input.path } };
    }
    assert.ok(id.startsWith('sesame/reports#'));
    const handler = handlers.find(value => value.name === id.split('#')[1]); assert.ok(handler);
    return { type: 'result', value: await handler.execute(input, options.signal) };
  } };
  return { host, state, calls, ...resources };
}
const decisionRun = () => ({ id: 'direct-service-decision', createdAt: 1, plan: { title: 'Fixed decision', reportFolder: 'Retained-plan-location', researchRefs: [] }, status: 'completed', executionDisposition: 'withheld_by_review',
  reports: [{ role: 'manager', status: 'completed', text: '# Frozen decision\n\nNo trade after the blocked review.' }], decision: { unchanged: true, targets: [] }, reviewChecks: { reviewer: { verdict: 'block' } } });

test('native decision report uses the actual common template/publication service without another Agent', async t => {
  const f = await fixture(t), run = decisionRun(), report = await writeDailyReport(f.host, run);
  const html = (await f.host.resources.read(report.ref, { part: 'content', entry: report.entry })).content;
  assert.match(html, /data-sesame-report-template="report\/1"/); assert.match(html, /--report-/);
  assert.match(html, /<h1>Frozen decision<\/h1>/); assert.match(html, /复核阻止本轮执行/);
  assert.equal(report.renderStatus, 'rendered'); assert.equal(report.inspection.renderer.name, 'sesame-report-inspector');
  assert.deepEqual(JSON.parse((await f.host.resources.read(report.ref, { part: 'content', entry: 'run.json' })).content), run);
  assert.deepEqual(f.calls.filter(call => call.id.startsWith('sesame/reports#')).map(call => call.id.split('#')[1]), ['report_document_template', 'report_publish', 'report_check']);
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
    assert.equal(f.calls.filter(call => call.id.endsWith('#report_publish')).length, 1);
  }
});

test('factor report keeps native evidence and interactions inside the common service document', async t => {
  const f = await fixture(t);
  const run = { id: 'direct-factor', title: 'Synthetic factor fixture', goal: 'No measured performance is invented', status: 'completed', config: { evaluator: { plugin_id: 'fixture/evaluator', tool: 'evaluate' } }, data: { digest: 'fixture-input', synthetic: true, holdoutMode: 'none', inputRefs: [] }, tasks: [], trials: [], reflections: [], events: [], selection: { trialIds: [], reason: 'No accepted candidates', digest: 'fixture-selection' } };
  const report = await archiveReport(f.host, run, { rows: [] });
  const html = (await f.host.resources.read(report.ref, { part: 'content', entry: report.entry })).content;
  assert.match(html, /data-sesame-report-template="report\/1"/); assert.match(html, /id="status-filter"/); assert.match(html, /id="run-snapshot"/); assert.match(html, /本次仅使用开发集/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1, 'The common service owns the single report heading.');
  assert.equal((html.match(/<main\b/g) ?? []).length, 1, 'Factor controls do not nest another page document.');
  assert.match(html, /@scope \(\.factor-report\)/); assert.match(html, /--paper:var\(--report-paper\)/);
  assert.equal((await f.host.resources.read(report.ref, { part: 'manifest' })).content.provenance.kind, 'demo');
  assert.deepEqual(JSON.parse((await f.host.resources.read(report.ref, { part: 'content', entry: 'run.json' })).content), run);
});

test('raw report evidence preserves inert HTML examples without authorizing executable report markup', async t => {
  const f = await fixture(t), run = decisionRun();
  run.reports[0].text += '\n\nAn inert source example: <iframe src="https://example.invalid"></iframe>';
  const report = await writeDailyReport(f.host, run);
  const html = (await f.host.resources.read(report.ref, { part: 'content', entry: report.entry })).content;
  assert.doesNotMatch(html, /<iframe\b/); assert.match(html, /&lt;iframe/);
  assert.deepEqual(JSON.parse((await f.host.resources.read(report.ref, { part: 'content', entry: 'run.json' })).content), run);
});
