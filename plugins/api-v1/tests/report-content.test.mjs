import {readPackageDirectory} from '../../protocol/directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderStructuredReport } from '../packages/reports/report-content.js';
import { renderReport } from '../packages/reports/report-provider.js';
import { createCapabilities } from '../packages/reports/index.js';

// All values in this file are explicitly synthetic software fixtures.
// No app, credential, model, market endpoint or real installation is contacted.
const hostRoot = process.env.SESAME_HOST_ROOT;
const fixed = (id = 'synthetic-results', digit = '1') => ({ id, revision: 'fixture-v1', digest: `sha256:${digit.repeat(64)}`, kind: 'data', schemaVersion: '1.0.0' });
const content = blocks => ({ kind: 'document', sections: [{ title: '合成测试判断', blocks }] });
const args = (body = content([{ type: 'paragraph', text: '明确标记的合成软件样本' }]), extra = {}) => ({
  operation_id: 'synthetic-content-test', title: '内容接口 · 合成测试', summary: '仅验证软件边界',
  lead: '以下合成样本用于验证统一视觉。', highlights: [{ label: 'Fixture result', value: 'Supplied' }], locale: 'zh-CN', provenance_kind: 'demo', data: [], content: body, ...extra,
});
const chart = extra => ({ type: 'chart', title: '固定样本', kind: 'bar', columns: ['label', 'value'],
  options: { x: 'label', y: 'value' }, ...extra });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test('chart content keeps exact source data in its configuration without a default detail block', async () => {
  const rows = [{ label: 'A', value: 1, original: '9007199254740993.0000001' }];
  const html = await renderStructuredReport({}, args(content([chart({ rows })])));
  assert.equal(html.includes('<details'), false);
  const config = JSON.parse(html.match(/<script id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(config[0].rows, rows);
  assert.equal(Object.hasOwn(config[0], 'source_note'), false);
});

test('untitled sections omit empty headings while retaining authored component titles', async () => {
  const html = await renderStructuredReport({}, args({kind:'document',sections:[{title:'',blocks:[chart({rows:[{label:'A',value:1}]})]}]}));
  assert.doesNotMatch(html, /<h2>\s*<\/h2>/);
  assert.equal((html.match(/<strong>固定样本<\/strong>/g) ?? []).length, 1);
  assert.match(html, /<h1>内容接口 · 合成测试<\/h1>/);
});

test('generic judgments preserve explicit labels, exact values and escaped details', async () => {
  const items = freeze([{ label: '判断', value: '已有结论', details: [{ label: '原值', value: '9007199254740993.0000001' }, { label: '<img src=x>', value: '<script>literal</script>' }] }]);
  const html = await renderStructuredReport({}, args(content([{ type: 'judgments', items }])));
  assert.match(html, /class="report-judgments"/); assert.match(html, /9007199254740993\.0000001/);
  assert.match(html, /&lt;img src=x&gt;/); assert.doesNotMatch(html, /<img src=x|<script>literal/);
  for(const invalid of [null, {}, [], Array(201).fill({label:'Q',value:'J'}), [{label:'Q',value:'J',probability:0.8}]])
    await assert.rejects(renderStructuredReport({}, args(content([{type:'judgments',items:invalid}]))), /1–200/);
});
async function memoryHost(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'sesame-structured-content-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const files = new Map(), creates = [], published = [], reads = [], datasets = new Map();
  const ref = { ...fixed('synthetic-published-report', '9'), kind: 'report' };
  const host = { context: { workspaceRoot: workspace }, resources: {
    create: async value => {
      creates.push(value);
      const resource = { id: `fixture-resource-${creates.length}` };
      files.set(resource.id, value.source?.path ? await readFile(value.source.path)
        : value.source?.content ? Buffer.from(value.source.content, value.source.encoding) : Buffer.alloc(0));
      return resource;
    },
    read: async (ref, request) => {
      reads.push({ ref, request });
      if (request.part === 'manifest') return datasets.get(ref.id)?.manifest ?? { content: { provenance: { kind: 'demo' } } };
      const bytes = datasets.get(ref.id)?.bytes ?? files.get(ref.id);
      assert.ok(bytes, `Unexpected fixture content read: ${ref.id}`);
      return { content: bytes.toString('base64'), total: bytes.length };
    },
    publish: async (_root, manifest) => { published.push(manifest); return { ref }; },
  } };
  return { host, workspace, files, creates, published, reads, datasets,
    render: async input => {
      const { operation_id, title, summary, locale='zh-CN', provenance_kind, data=[], related=[], references=[], features=['interactive'], artifact_id, expected_revision, ...providerInput } = input;
      const result = await renderReport(host, { metadata:{title,summary,locale,provenanceKind:provenance_kind,features}, data,related,references,input:providerInput });
      for (const file of result.files) files.set(file.path,Buffer.from(file.content,file.encoding));
      return result;
    } };

}

test('structured provider escapes prose, preserves exact supplied values and returns files without publishing', async t => {
  const fixture = await memoryHost(t), ref = fixed();
  const attack = '</h2><img src=x onerror="window.CONTENT_ATTACK=1"><script>window.CONTENT_ATTACK=1</script>';
  const original = freeze(args(content([
    { type: 'paragraph', text: attack },
    { type: 'metrics', items: [{ label: attack, value: 0 }] },
    { type: 'table', columns: [attack], rows: [[false], [0], [null], [attack]], caption: attack },
    { type: 'reasoning', steps: [attack] },
  ]), { title: attack, summary: attack, data: [{ id: 'fixed-input', ref, usage: 'Synthetic evidence' }] }));
  const result = await fixture.render(original);
  assert.equal(result.entry, 'index.html');
  assert.equal(Object.hasOwn(result, 'ref'), false);
  assert.equal(fixture.published.length, 0);
  assert.deepEqual(original.data[0].ref, ref);
  const html = [...fixture.files.values()].map(bytes => bytes.toString()).find(text => text.startsWith('<!doctype html>'));
  assert.ok(html);
  assert.match(html, /&lt;img src=x onerror=/);
  assert.doesNotMatch(html, /<img src=x|<script>window\.CONTENT_ATTACK/);
  assert.match(html, /<td>false<\/td>/);
  assert.match(html, /<td>0<\/td>/);
  assert.match(html, /<td>—<\/td>/);
});

test('provider rejects custom HTML arguments before reading or creating resources', async t => {
  const fixture = await memoryHost(t);
  for (const extra of [{ html_path: 'uploaded.html' }, { body_html: '<h1>Uploaded HTML</h1>' }, { html_path: undefined }]) {
    await assert.rejects(fixture.render(args(undefined, extra)), /HTML|uploads are disabled/i);
  }
  assert.equal(fixture.reads.length, 0);
  assert.equal(fixture.creates.length, 0);
  assert.equal(fixture.published.length, 0);
});

test('unregistered styles and raw CSS are rejected while supported content and known styles render', async () => {
  for (const style of [{ theme: 'custom' }, { density: 'injected' }, { theme: 'blue', css: 'body{display:none}' },
    { theme: 'blue', html: '<style></style>' }, { stylesheet: 'https://example.invalid/custom.css' }, [], 'blue']) {
    await assert.rejects(renderStructuredReport({}, args(undefined, { style })), /style|theme|density|property/i);
  }
  for (const body of [{ kind: 'html', html: '<h1>custom</h1>' }, { ...content([]), html: '<script>bad()</script>' },
    content([{ type: 'script', text: 'bad()' }]), content([{ type: 'svg', text: '<svg/>' }]),
    content([{ type: 'paragraph', text: 'text', style: 'color:red' }]),
    { kind: 'document', sections: [{ title: 'Title', blocks: [], className: 'custom' }] },
    content([{ type: 'table', columns: ['x'], rows: [[{ html: '<img>' }]] }])]) {
    await assert.rejects(renderStructuredReport({}, args(body)), /layout|content|property|table/i);
  }
  const html = await renderStructuredReport({}, args());
  assert.match(html, /data-report-layout="unified"/);
  assert.match(html, /data-report-style="blue"/);
  assert.doesNotMatch(html, /data-report-preset/);
});

test('chart references must bind exactly one declared dataset rather than silently reading a different source', async () => {
  await assert.rejects(renderStructuredReport({}, args(content([chart({ data_id: 'missing' })]))), /binding/i);
  await assert.rejects(renderStructuredReport({}, args(content([chart({ data_id: 'bound', rows: [{ label: 'a', value: 1 }] })]),
    { data: [{ id: 'bound', ref: fixed() }] })), /fixed rows or a data binding/i);
  for (const options of [{ x: 'label', y: 'value', onSelect: 'window.BAD=1' },
    JSON.parse('{"x":"label","y":"value","__proto__":{"polluted":true}}')]) {
    await assert.rejects(renderStructuredReport({}, args(content([chart({ options, rows: [{ label: 'a', value: 1 }] })]))), /callbacks|options/i);
  }
  const html = await renderStructuredReport({}, args(content([chart({ data_id: 'bound' })]), { data: [{ id: 'bound', ref: fixed() }] }));
  const charts = JSON.parse(html.match(/<script id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(charts[0].dataId, 'bound');
  assert.equal(Object.hasOwn(charts[0], 'rows'), false, 'Bound data is not replaced by synthetic inline rows');
});



test('active HTML, CSS, JavaScript and SVG attachments are rejected before importing workspace bytes', async t => {
  const fixture = await memoryHost(t);
  for (const [path, media_type] of [['extra.html', 'text/html'], ['extra.xhtml', 'application/xhtml+xml'],
    ['extra.css', 'text/css'], ['extra.js', 'text/javascript'], ['extra.js', 'application/javascript'], ['extra.svg', 'image/svg+xml']]) {
    await assert.rejects(fixture.render(args(undefined, { assets: [{ path, source_path: 'nonexistent', media_type }] })), /attachments|uploads|inert/i);
  }
  assert.equal(fixture.creates.length, 0);
  assert.equal(fixture.published.length, 0);
});

test('executable asset extensions cannot disguise themselves as JSON or plain text', async t => {
  const fixture = await memoryHost(t);
  await writeFile(join(fixture.workspace, 'evidence.txt'), '<svg onload="window.BAD=1"></svg>');
  for (const path of ['payload.html', 'payload.HTM', 'payload.xhtml', 'payload.css', 'payload.js', 'payload.mjs', 'payload.svg']) {
    await assert.rejects(fixture.render(args(undefined, { assets: [{ path, source_path: 'evidence.txt', media_type: 'text/plain' }] })),
      /asset|attachment|extension|type|HTML|SVG/i);
  }
  assert.equal(fixture.published.length, 0);
});

test('inert JSON evidence can quote original markup without mutation or execution', async t => {
  const fixture = await memoryHost(t);
  const original = JSON.stringify({ sourceText: '<svg onload="window.BAD=1"></svg><script>window.BAD=2</script>', value: 0, exact: '9007199254740993.0000001' });
  await writeFile(join(fixture.workspace, 'run.json'), original);
  await fixture.render(args(undefined, { assets: [{ path: 'evidence/run.json', source_path: 'run.json', media_type: 'application/json' }] }));
  assert.ok([...fixture.files.values()].some(bytes => bytes.toString() === original));
  assert.equal(fixture.published.length, 0, 'provider never publishes its own artifact');
});

test('attachment blocks escape labels and preserve only declared inert package files', async t => {
  const fixture = await memoryHost(t), ref = fixed('download-evidence');
  const bytes = Buffer.from('{"precise":"9007199254740993.0000001","missing":null,"text":"<script>inert</script>"}');
  fixture.datasets.set(ref.id, { manifest: { blobs: [{ path: 'rows.json', mediaType: 'application/json' }] }, bytes });
  const path = 'evidence/完整 data.json', label = '<img src=x onerror="window.BAD=1">下载', description = '<script>not executable</script>';
  const input = freeze(args(content([{ type: 'details', title: '完整证据', blocks: [{ type: 'group', layout: 'stack', blocks: [
    { type: 'paragraph', text: description }, { type: 'attachments', items: [{ label, path }] },
  ] }] }]), { assets: [{ path, ref, entry: 'rows.json', media_type: 'application/json' }], references: [ref] }));
  const before = structuredClone(input), result = await fixture.render(input);
  const html = result.files.find(file => file.path === 'index.html').content;
  assert.match(html, /<a href="evidence\/%E5%AE%8C%E6%95%B4%20data\.json">&lt;img/);
  assert.match(html, /&lt;script&gt;not executable&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img src=x|<script>not executable/);
  const packaged = result.files.find(file => file.path === path);
  assert.deepEqual(Buffer.from(packaged.content, packaged.encoding), bytes);
  assert.deepEqual(input, before, 'Link presentation cannot alter the source declarations or evidence');
});

test('attachment links reject URL syntax, traversal, active files and undeclared or duplicate entries', async () => {
  const link = (path, extra = {}) => content([{ type: 'attachments', items: [{ label: '证据', path, ...extra }] }]);
  for (const path of ['https://example.invalid/a.json', '//example.invalid/a.json', '/absolute.json', '../a.json', 'x/../a.json',
    'x/./a.json', 'x//a.json', 'x\\a.json', 'x%2fa.json', 'x/%2e%2e/a.json', 'x/a.json?download=1', 'x/a.json#part', 'x/a\u0000.json', 'x/a\u007f.json']) {
    await assert.rejects(renderStructuredReport({}, args(link(path), { assets: [{ path, media_type: 'application/json' }] })), /safe literal relative/i);
  }
  for (const [path, media_type] of [['a.html', 'text/plain'], ['a.svg', 'image/svg+xml'], ['a.js', 'application/json'], ['a.json', 'text/html']]) {
    await assert.rejects(renderStructuredReport({}, args(link(path), { assets: [{ path, media_type }] })), /inert/i);
  }
  const path = 'evidence/valid.json', asset = { path, media_type: 'application/json' };
  await assert.rejects(renderStructuredReport({}, args(link(path))), /declared packaged/i);
  await assert.rejects(renderStructuredReport({}, args(link(path), { assets: [asset, asset] })), /one declared/i);
  for (const extra of [{ label: ' ' }, { label: 'x'.repeat(161) }, { description: 'x'.repeat(1001) }, { href: 'https://example.invalid' }]) {
    await assert.rejects(renderStructuredReport({}, args(link(path, extra), { assets: [asset] })), /label|description|property/i);
  }
  await assert.rejects(renderStructuredReport({}, args(content([{ type: 'attachments', items: [] }]))), /at least one/i);
  await assert.rejects(renderStructuredReport({}, args(content([{ type: 'attachments', items: [{ label: 'A', path }, { label: 'B', path }] }]), { assets: [asset] })), /repeat/i);
});

test('component and provider schemas expose the same inert attachment contract', async () => {
  const { capabilities } = readPackageDirectory(new URL('../packages/reports/', import.meta.url)).capabilities;
  const provider = capabilities.find(item => item.id === 'report_render').inputSchema.properties.input;
  const block = provider.$defs.block.oneOf.find(item => item.properties.type.const === 'attachments');
  assert.deepEqual(block.properties.items.items.required,['label','path']);
  assert.equal(block.properties.items.items.additionalProperties,false);
  const pathPattern = new RegExp(block.properties.items.items.properties.path.pattern);
  assert.ok(pathPattern.test('evidence/完整 data.json'));
  for(const path of ['../a.json','x/../a.json','/a.json','https://x/a.json','a.json?x'])assert.equal(pathPattern.test(path),false,path);
});
test('custom style tokens accept declared choices but refuse CSS, code, URLs and out-of-range values', async () => {
  const base = { reason: 'More room for a supplied comparison', tokens: { accent: '#334eac', context: '#71717a',
    accent_dark: '#7da9ff', context_dark: '#a1a1aa', heading: 'sans', body_size: 17, content_width: 1120, section_gap: 60, chart_height: 360, columns: 2 } };
  const original = freeze(structuredClone(base));
  const html = await renderStructuredReport({}, args(undefined, { style: { custom: original } }));
  assert.match(html, /data-report-layout="unified"/);
  assert.match(html, /--report-accent:#334eac;/);
  assert.match(html, /--report-body-size:17px;/);
  assert.deepEqual(original, base);
  for (const tokens of [{ accent: '#334eac;}body{display:none}' }, { accent: 'url(https://example.invalid/font)' },
    { heading: 'url(evil)' }, { body_size: 13 }, { body_size: 20.5 }, { columns: 4 },
    { content_width: 2000 }, { chart_height: Infinity }, { css: 'body{color:red}' }, { font_family: '<style>' }]) {
    await assert.rejects(renderStructuredReport({}, args(undefined, { style: { custom: { ...base, tokens } } })), /style|color|heading|integer|property/i);
  }
  await assert.rejects(renderStructuredReport({}, args(undefined, { style: { custom: { ...base, reason: '' } } })), /presentation need/i);
  await assert.rejects(renderStructuredReport({}, args(undefined, { style: { preset: 'compact', custom: base } })), /style property/i);
});

test('saved styles use exact versions, idempotent saves and compare-and-swap before changing user choices', async () => {
  const histories = new Map(), commits = [], reads = [];
  const host = { state: {
    read: async (key, options = {}) => {
      reads.push({ key, options });
      const versions = histories.get(key.key) ?? [], entry = options.version ? versions.find(row => row.version === options.version) : versions.at(-1);
      if (!entry) throw Object.assign(new Error('No saved fixture'), { code: 'NOT_FOUND' });
      return structuredClone(entry);
    },
    query: async ({ collection }) => { assert.equal(collection, 'report-styles'); return { items: [...histories.values()].map(rows => structuredClone(rows.at(-1))) }; },
    commit: async changes => {
      commits.push(structuredClone(changes));
      const entries = changes.map(change => {
        assert.equal(change.key.collection, 'report-styles');
        const history = histories.get(change.key.key) ?? [];
        assert.equal(change.expectedVersion, history.length);
        const entry = { value: structuredClone(change.value), version: history.length + 1 };
        histories.set(change.key.key, [...history, entry]); return entry;
      });
      return { entries };
    },
  } };
  const tools = new Map(createCapabilities(host).map(tool => [tool.name, tool.execute]));
  const input = { operation_id: 'save-fixture-style-1', id: 'fixture-comparison', title: '合成比较样式', description: '软件测试', expected_version: 0,
    style: { reason: 'Larger comparison labels', tokens: { body_size: 17, accent: '#334eac' } } };
  const v1 = await tools.get('report_style_save')(input);
  assert.deepEqual(v1.style, { saved_id: input.id, saved_version: 1 });
  assert.deepEqual(await tools.get('report_style_save')(structuredClone(input)), v1);
  assert.equal(commits.length, 1);
  await assert.rejects(tools.get('report_style_save')({ ...input, operation_id: 'save-fixture-style-2', style: { ...input.style, tokens: { body_size: 18 } } }), /current style version/i);
  await assert.rejects(tools.get('report_style_save')({ ...input, title: 'Different content under same operation' }), /already used/i);
  const v2 = await tools.get('report_style_save')({ ...input, operation_id: 'save-fixture-style-2', expected_version: 1, style: { ...input.style, tokens: { body_size: 18 } } });
  assert.equal(v2.version, 2);
  const catalog = await tools.get('report_styles')({});
  assert.equal(catalog.default.id, 'unified');
  assert.ok(catalog.blocks.includes('attachments'), 'The public component list includes real packaged evidence links');
  assert.equal(Object.hasOwn(catalog,'presets'), false);
  assert.deepEqual(catalog.saved[0].style, v2.style);
  const html = await renderStructuredReport(host, args(undefined, { style: v1.style }));
  assert.match(html, /--report-body-size:17px;/);
  assert.doesNotMatch(html, /--report-body-size:18px;/);
  assert.deepEqual(reads.at(-1).options, { version: 1 });
  await assert.rejects(renderStructuredReport(host, args(undefined, { style: { saved_id: input.id } })), /exact ID and version/i);
  await assert.rejects(renderStructuredReport({ state: { read: async () => ({ version: 2, value: { style: input.style } }) } },
    args(undefined, { style: v1.style })), /version differs/i);
  const before = commits.length;
  await assert.rejects(tools.get('report_style_save')({ ...input, operation_id: 'unsafe-style', expected_version: 2,
    style: { ...input.style, tokens: { accent: '#000000;background:url(evil)' } } }), /color/i);
  assert.equal(commits.length, before, 'Unsafe tokens cannot be persisted');
});

test('generic ranges, scores and groups require explicit finite scales and escape supplied judgments', async () => {
  const attack = '<img src=x onerror="window.BAD=1">';
  const body = content([{ type: 'judgment', text: attack }, { type: 'group', layout: 'columns', blocks: [
    { type: 'range', label: 'Observed interval', min: -5, max: 5, value: 0, unit: 'units' },
    { type: 'scores', min: 0, max: 5, unit: '/5', items: [{ label: attack, value: 4 }] },
  ] }]);
  const html = await renderStructuredReport({}, args(body));
  assert.match(html, /data-report-layout="unified"/);
  assert.match(html, /report-group-columns/);
  assert.match(html, /left:50%/);
  assert.match(html, /<meter min="0" max="5" value="4"/);
  assert.match(html, />4\/5<\/strong>/);
  assert.doesNotMatch(html, /<img src=x|80%/);
  for (const block of [{ type: 'range', label: 'Missing domain', value: 0 },
    { type: 'range', label: 'Outside domain', min: 0, max: 1, value: 2 },
    { type: 'scores', min: 0, max: 5, items: [{ label: 'Outside', value: 6 }] },
    { type: 'scores', min: 0, max: 0, items: [] }, { type: 'group', layout: 'uploaded-css', blocks: [] }]) {
    await assert.rejects(renderStructuredReport({}, args(content([block]))), /range|scale|finite|columns|stack/i);
  }
});




async function browserPage(t) {
  const { chromium } = createRequire(join(hostRoot, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  t.after(() => { assert.deepEqual(errors, [], 'Built-in content runtime has no browser exceptions'); assert.deepEqual(requests, [], 'Structured content must not fetch arbitrary remote assets'); });
  return page;
}

test('generic judgment reading order and explicit details remain readable at both widths', {skip:!hostRoot,timeout:30000}, async t => {
  const page = await browserPage(t), items = [{label:'候选甲',value:'保留观察',details:[{label:'记录',value:'完整原值甲'}]},{label:'候选乙',value:'暂缓采用',details:[{label:'记录',value:'完整原值乙'}]}];
  await page.setContent(await renderStructuredReport({},args(content([{type:'judgments',items}]))));
  for(const width of [1000,390]){
    await page.setViewportSize({width,height:850});
    const boxes = await page.locator('.report-judgment-item').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})));
    assert.equal(boxes[0].y === boxes[1].y,width===1000);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  assert.deepEqual(await page.locator('.report-judgment-item dd').allTextContents(),['完整原值甲','完整原值乙']);
  assert.equal(await page.locator('details').count(),0);
});

test('all fourteen packaged evidence links remain real anchors and click to their exact entries at both widths', { skip: !hostRoot, timeout: 30000 }, async t => {
  const page = await browserPage(t);
  // These names reproduce the reported attachment shape; bytes below remain
  // explicitly synthetic. Actual published evidence is audited separately.
  const names = ['prices-731.json', 'btc-original-bytes.json', 'exploration-plan.json', 'replay-code.json', 'historical-input.json',
    'historical-result.json', 'clock-audit-731.json', 'all-derived-evidence.json', 'X04-record.json', 'X06-record.json', 'X08-record.json',
    'fed-2024-03-20-original.json', 'fed-2024-06-12-original.json', 'fed-2024-09-18-original.json'];
  const items = names.map(name => ({ label: '下载 ' + name, path: 'evidence/' + name }));
  const assets = items.map(item => ({ path: item.path, media_type: 'application/json' }));
  const html = await renderStructuredReport({}, args(content([{ type: 'paragraph', text: '合成软件验收' },
    { type: 'details', title: '完整附件', blocks: [{ type: 'attachments', items }] },
  ]), { assets }));
  await page.setContent(html);
  await page.evaluate(() => {
    window.attachmentClicks = [];
    document.addEventListener('click', event => { const link = event.target.closest('.report-attachments a'); if (link) { event.preventDefault(); window.attachmentClicks.push(link.getAttribute('href')); } });
  });
  const details = page.locator('article details[data-report-evidence]');
  await details.locator(':scope > summary').click();
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 850 });
    const links = details.locator('.report-attachments a');
    assert.equal(await links.count(), 14);
    assert.deepEqual(await links.evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), items.map(item => item.path));
    for (let i = 0; i < items.length; i++) await links.nth(i).click();
    assert.deepEqual(await page.evaluate(() => window.attachmentClicks.splice(0)), items.map(item => item.path));
  }
});

test('Markdown, labels and chart rows cannot execute HTML, CSS, scripts or remote resource loads', { skip: !hostRoot, timeout: 30000 }, async t => {
  const page = await browserPage(t), payload = '</script><img src="https://example.invalid/evil.png" onerror="window.CONTENT_ATTACK=1">';
  const html = await renderStructuredReport({}, args(content([
    { type: 'markdown', text: '**允许的加粗**\n\n<style>body{display:none}</style>\n<script>window.CONTENT_ATTACK=1</script>\n'+payload+'\n[危险链接](javascript:alert(1))\n![远程图](https://example.invalid/tracker.png)' },
    chart({ rows: [{ label: payload, value: 1 }] }),
  ])));
  await page.setContent(html);
  await page.waitForFunction(() => document.querySelector('#content-chart-1 svg, #content-chart-1 canvas'));
  assert.equal(await page.evaluate(() => window.CONTENT_ATTACK), undefined);
  assert.equal(await page.locator('main img, main iframe, main object, main embed, main [onerror], main [onclick], main a[href^="javascript:"]').count(), 0);
  assert.equal(await page.locator('strong', { hasText: '允许的加粗' }).count(), 1);
  assert.equal(await page.locator('main').evaluate(node => getComputedStyle(node).display === 'none'), false);
});

test('LaTeX renders as native MathML and exact authored evidence stays in place', { skip: !hostRoot, timeout: 30000 }, async t => {
  const page = await browserPage(t), latex = String.raw`\frac{a_1}{\sqrt{b}} = \sum_{i=1}^{n} x_i`;
  const html = await renderStructuredReport({}, args(content([
    { type: 'paragraph', text: '正文判断保留' },
    { type: 'formula', latex, display: 'block' },
    { type: 'details', title: '原始证据', blocks: [{ type: 'table', columns: ['exact'], rows: [['9007199254740993.0000001']] }] },
  ])));
  await page.setContent(html);
  await page.locator('[data-math-rendered="true"] math').waitFor();
  assert.equal(await page.locator('[data-report-math]').getAttribute('data-report-math'), latex);
  assert.ok(await page.locator('math mfrac').count() > 0);
  assert.ok(await page.locator('math msqrt').count() > 0);
  assert.equal(await page.locator('math').first().evaluate(node => node.namespaceURI), 'http://www.w3.org/1998/Math/MathML');
  assert.equal(await page.locator('.katex-html').count(), 0);
  assert.equal(await page.locator('[data-report-evidence-appendix], .report-evidence-links').count(), 0);
  assert.equal(await page.locator('main > article details').count(), 1);
  assert.equal(await page.locator('article details td').textContent(), '9007199254740993.0000001');
});

test('Markdown deep headings and quotations keep body typography in reports and answers', { skip: !hostRoot, timeout: 30000 }, async t => {
  const page = await browserPage(t);
  const blocks = [{type:'paragraph',text:'正文参照'}, {type:'markdown',text:'#### 四级标题\n\n##### 五级标题\n\n###### 六级标题\n\n> 引用正文\n>\n> > 嵌套引用'}];
  for (const target of ['report','answer']) {
    await page.setContent(await renderStructuredReport({},args(content(blocks),{target})));
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      const styles = await page.evaluate(()=>{
        const read=node=>{const s=getComputedStyle(node);return {size:s.fontSize,color:s.color};};
        return {body:read(document.querySelector('.kit-section>p')),items:[...document.querySelectorAll('.report-prose h4,.report-prose h5,.report-prose h6,.report-prose blockquote,.report-prose blockquote p')].map(read)};
      });
      assert.equal(styles.items.length,7);
      for (const style of styles.items) assert.deepEqual(style,styles.body,`${target}/${theme}`);
    }
  }
});

test('formula presentation follows the theme while preserving mathematical scripts and source', { skip: !hostRoot, timeout: 30000 }, async t => {
  const page=await browserPage(t),latex=String.raw`\textcolor{red}{\tiny x_i} + \colorbox{yellow}{\small Y} + z^{n}`;
  await page.setContent(await renderStructuredReport({},args(content([{type:'formula',latex}]))));
  await page.locator('[data-math-rendered=true] math').waitFor();
  assert.equal(await page.locator('math [mathsize],math [mathcolor],math [mathbackground]').count(),0);
  assert.equal(await page.locator('math annotation').textContent(),latex);
  assert.equal(await page.locator('[data-report-math]').getAttribute('data-report-math'),latex);
  assert.equal(await page.locator('math msub').count(),1);assert.equal(await page.locator('math msup').count(),1);
  for (const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const values=await page.evaluate(()=>{
      const read=selector=>{const s=getComputedStyle(document.querySelector(selector));return {size:parseFloat(s.fontSize),color:s.color};};
      return {container:read('.report-formula'),base:read('msub mi:first-child'),sub:read('msub mi:last-child'),normal:read('msup mi:first-child'),super:read('msup mi:last-child')};
    });
    assert.equal(values.base.size,values.normal.size);
    assert.equal(values.base.color,values.container.color);
    assert.ok(values.sub.size<values.base.size);assert.ok(values.super.size<values.normal.size);
  }
});

test('charts use separate prose, one visible title and exact source values after resize', {skip:!hostRoot,timeout:30000}, async t => {
  const page = await browserPage(t), precise = '9007199254740993.0000001';
  const titles=['唯一图名 A','唯一图名 B'], prose=['仅输入数值 A','仅输入数值 B'];
  const blocks=['bar','units'].flatMap((kind,index)=>[{type:'paragraph',text:prose[index]},chart({kind,title:titles[index],columns:['label','value','original_decimal'],rows:[{label:'A',value:index,original_decimal:precise}]})]);
  await page.setContent(await renderStructuredReport({},args(content(blocks))));
  await page.locator('#content-chart-2 svg').waitFor();
  for(const width of [1000,390]){
    await page.setViewportSize({width,height:850});
    assert.deepEqual(await page.locator('figcaption strong').allTextContents(),titles);
    assert.deepEqual(await page.locator('.kit-section>p').allTextContents(),prose);
    assert.equal(await page.locator('figure.kit-chart>p').count(),0);
    for(const [index,title] of titles.entries())assert.ok((await page.locator('#content-chart-'+(index+1)+' svg[role="img"]').getAttribute('aria-label')).includes(title));
  }
  const config=await page.locator('#sesame-module-charts').evaluate(n=>JSON.parse(n.textContent));
  assert.equal(config[0].rows[0].original_decimal,precise);assert.equal(await page.locator('main details').count(),0);
});
