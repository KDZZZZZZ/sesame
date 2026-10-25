import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCapabilities } from '../packages/reports/index.js';
import { reportExportAdvice } from '../packages/reports/shared/report-export-contract.js';

const ref = { id: 'report', revision: 'fixed-revision', digest: `sha256:${'a'.repeat(64)}`, kind: 'report', schemaVersion: '1.0.0' };

test('document template uses editorial source without fabricating chart inputs or discarding interactions', async () => {
  const writes = [], calls = [];
  const host = { capabilities: { invoke: async (id, input, options) => { calls.push({ id, options }); writes.push(input); return { type: 'result', value: { path: input.path } }; } } };
  const tool = createCapabilities(host).find(tool => tool.name === 'report_document_template');
  const body = '<style>.finding{font-weight:600}</style><p class="finding">Actual evidence {{TITLE}}</p><button id="more">Inspect</button><script>document.querySelector("#more").onclick=()=>{document.querySelector(".finding").textContent="Verified detail"}</script>';
  const signal = new AbortController().signal;
  const result = await tool.execute({ title: '</title><script>bad()</script>', output_path: 'report.html', locale: 'zh-CN', body_html: body }, signal);
  const html = writes[0].content;
  assert.equal(calls[0].id, 'sesame/workspace#write'); assert.equal(calls[0].options.signal, signal);
  assert.match(html, /data-sesame-report-template="report\/1"/); assert.match(html, /lang="zh-CN"/);
  assert.ok(html.includes(body), 'authored body and placeholder-like text are preserved exactly');
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>bad\(\)/); assert.doesNotMatch(html, /reportKit\.rows|SesameCharts\.chart|demo-data/);
  assert.ok(html.includes(await readFile(new URL('../packages/reports/assets/editorial.css', import.meta.url), 'utf8')));
  assert.deepEqual(result, { path: 'report.html', bytes: Buffer.byteLength(html), runtime: 'sesame-report/1', runtimeRevision: '1.0.0', editable: true });
});

test('valid interactive publication reports PDF limitations without attempting any render', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'sesame-report-publication-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const html = '<!doctype html><html data-sesame-report-template="report/1"><body><h1>Recorded media evidence</h1><video src="data:video/mp4;base64,AA==" controls></video></body></html>';
  await writeFile(join(workspace, 'source.html'), html);
  const evidence = JSON.stringify({ originalMarkdown: 'Documented example: <iframe src="https://example.org"></iframe><script src="https://example.org/code.js"></script>' });
  await writeFile(join(workspace, 'run.json'), evidence);
  const files = new Map(), published = [];
  const host = { context: { workspaceRoot: workspace }, views: { inspect: () => assert.fail('Publication does not render or preflight') }, resources: {
    create: async value => { const id = `resource-${files.size}`; files.set(id, value.source?.path ? await readFile(value.source.path) : value.source?.content ? Buffer.from(value.source.content, value.source.encoding) : Buffer.alloc(0)); return { id }; },
    read: async value => { const bytes = files.get(value.id); return { content: bytes.toString('base64'), total: bytes.length }; },
    publish: async (_root, manifest) => { published.push(manifest); return { ref }; },
  } };
  const tool = createCapabilities(host).find(tool => tool.name === 'report_publish');
  const args = { operation_id: 'publication', title: 'Media evidence', summary: 'Actual evidence', html_path: 'source.html', provenance_kind: 'observed', data: [], assets: [{ path: 'run.json', source_path: 'run.json', media_type: 'application/json' }] };
  const result = await tool.execute(args);
  assert.deepEqual(result.ref, ref); assert.equal(result.renderStatus, 'not_checked'); assert.equal(published.length, 1);
  assert.equal(result.exportability.checked, 'source'); assert.equal(result.exportability.outputVerified, false);
  assert.equal(result.exportability.formats.pdf.status, 'unsupported'); assert.deepEqual(result.exportability.candidateFormats, ['png']);
  assert.ok([...files.values()].some(bytes => bytes.toString() === html), 'published media is not silently flattened or removed');
  assert.ok([...files.values()].some(bytes => bytes.toString() === evidence), 'inert JSON evidence is preserved byte-for-byte');
  await assert.rejects(tool.execute({ ...args, operation_id: 'active-evidence', assets: [{ path: 'evidence.html', source_path: 'run.json', media_type: 'text/html' }] }), /embedded frames/);
  assert.equal(published.length, 1, 'the same content declared as active HTML is still rejected');
});

test('report_export_check targets only a fixed ref on the dedicated host preflight surface', async () => {
  const signal = new AbortController().signal, answer = { checked: 'rendered-preflight', outputVerified: false, supportedFormats: ['png'], formats: { pdf: { status: 'unsupported', reasons: [{ code: 'shadow_dom', message: 'Closed shadow DOM' }] } } };
  const tool = createCapabilities({ views: { inspect: async (input, options) => {
    assert.deepEqual(input, { surface: 'report-export', ref }); assert.equal(options.signal, signal); return answer;
  } } }).find(tool => tool.name === 'report_export_check');
  assert.deepEqual(await tool.execute({ ref }, signal), answer);
  const manifest = JSON.parse(await readFile(new URL('../packages/reports/capabilities.json', import.meta.url), 'utf8'));
  for (const id of ['report_document_template', 'report_export_check']) {
    const declaration = manifest.capabilities.find(value => value.id === id);
    assert.equal(declaration.binding.name, id); assert.equal(declaration.inputSchema.additionalProperties, false);
  }
  assert.deepEqual(manifest.capabilities.find(value => value.id === 'report_export_check').effects, ['presentation.render']);
});

test('source-only checks never convert a plain report into a verified export claim', () => {
  const result = reportExportAdvice('<h1>Plain report</h1>');
  assert.equal(result.checked, 'source'); assert.deepEqual(result.supportedFormats, []);
  assert.deepEqual(result.candidateFormats, ['pdf', 'png']);
  assert.equal(result.formats.pdf.status, 'needs-render-check'); assert.equal(result.outputVerified, false);
});
