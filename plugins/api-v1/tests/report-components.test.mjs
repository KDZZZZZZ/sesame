import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { createCapabilities } from '../packages/reports/index.js';
import { renderReport } from '../packages/reports/report-provider.js';

// Synthetic software fixtures only; no research data or live installation is used.
const protocol = 'sesame-components/1';
const fixed = (id, kind = 'data') => ({ id, revision: 'fixture-v1', digest: `sha256:${'a'.repeat(64)}`, kind, schemaVersion: '1.0.0' });
const document = blocks => ({ kind: 'document', sections: [{ title: 'Synthetic comparison', blocks }] });
const chart = extra => ({ type: 'chart', kind: 'bar', title: 'Supplied counts', columns: ['label', 'value'],
  options: { x: 'label', y: 'value' }, takeaway: 'B has the larger supplied count', source_note: 'Synthetic fixture only', ...extra });
const args = (content = document([{ type: 'paragraph', text: 'Synthetic test only' }]), extra = {}) => ({
  title: 'Components fixture', locale: 'en', provenance_kind: 'demo', data: [], content, ...extra,
});
const capability = (host, name) => {
  const value = createCapabilities(host).find(item => item.name === name);
  assert.ok(value, `${name} must be wired into Reports`);
  return value.execute;
};
const publication = extra => ({ ...args(), operation_id: 'component-show-fixture', ...extra });
const readonlyHost = () => {
  const entries = new Map(), reads = [], writes = [];
  const denied = name => () => { writes.push(name); assert.fail(`${name} is not allowed during validation`); };
  const host = { resources: {
    create: denied('resource.create'), publish: denied('resource.publish'),
    read: async (ref, request) => {
      reads.push({ ref, request });
      const entry = entries.get(ref.id);
      assert.ok(entry, `No synthetic resource for ${ref.id}`);
      assert.deepEqual(ref, entry.ref, 'read the exact fixed identity');
      if (request.part === 'manifest') return entry.manifest;
      assert.equal(request.part, 'content'); assert.equal(request.entry, entry.path);
      assert.equal(request.encoding, 'base64');
      const offset = request.offset ?? 0, end = Math.min(offset + 19, entry.bytes.length);
      return { content: entry.bytes.subarray(offset, end).toString('base64'), total: entry.bytes.length,
        ...(end < entry.bytes.length ? { nextOffset: end } : {}) };
    },
  }, capabilities: { invoke: denied('capability.invoke') } };
  const put = (ref, value, { path = 'rows.json', mediaType = 'application/json', format = 'json-rows' } = {}) => {
    entries.set(ref.id, { ref, path, bytes: Buffer.from(JSON.stringify(value)),
      manifest: { content: { format, path, provenance: { kind: 'demo' } }, blobs: [{ path, mediaType }] } });
  };
  return { host, entries, reads, writes, put };
};

test('component capabilities use the shared catalog and expose bounded discovery schemas', async () => {
  const catalog = await import('../packages/reports/component-catalog.js');
  const list = capability({}, 'components_list'), describe = capability({}, 'components_describe');
  assert.deepEqual(await list({ limit: 3 }), catalog.listComponents({ limit: 3 }));
  const all = catalog.listComponents({ limit: 100 });
  const ids = all.items.slice(0, 2).map(item => item.id);
  assert.deepEqual(await describe({ ids }), catalog.describeComponents(ids));
  await assert.rejects(describe({ ids: [] }), /1|12|ids|component/i);
  await assert.rejects(describe({ ids: Array(13).fill(ids[0]) }), /1|12|ids|component/i);
  const manifest = JSON.parse(await readFile(new URL('../packages/reports/capabilities.json', import.meta.url), 'utf8'));
  const plugin = JSON.parse(await readFile(new URL('../packages/reports/plugin.json', import.meta.url), 'utf8'));
  for (const name of ['components_list', 'components_describe', 'components_validate', 'components_show']) {
    const cap = manifest.capabilities.find(item => item.id === name);
    assert.equal(cap.inputSchema.type, 'object'); assert.equal(cap.outputSchema.type, 'object');
    assert.equal(cap.binding.type, 'native'); assert.ok(plugin.mcp_export.includes(name));
    assert.ok(JSON.stringify(cap.inputSchema).length < 20000, 'tool schemas must not embed the full component catalog');
  }
  assert.equal(plugin.execution, 'native'); assert.equal(plugin.version, '5.1.0');
  const listing = manifest.capabilities.find(item => item.id === 'components_list').inputSchema;
  assert.equal(listing.properties.limit.default, 20); assert.equal(listing.properties.limit.maximum, 100);
  assert.ok(plugin.resources.includes('skills/report-design/component-protocol.md'));
  assert.ok(manifest.knowledge.some(item => item.path === 'skills/report-design/component-protocol.md'));
});

test('discovery accepts its own cursor for the longest supported search query', async () => {
  const list = capability({}, 'components_list'), query = Array(30).fill('chart').join(' ');
  const first = await list({ query, limit: 1 });
  assert.ok(first.nextCursor.length > 200);
  const second = await list({ query, limit: 1, cursor: first.nextCursor });
  assert.notEqual(second.items[0].id, first.items[0].id);
});

test('validation renders combined content without publication and explicitly excludes browser checks', async () => {
  const fixture = readonlyHost();
  const content = { ...document([{ type: 'group', layout: 'columns', blocks: [
    { type: 'judgment', text: 'Compare the supplied counts' },
    chart({ rows: [{ label: 'A', value: 2 }, { label: 'B', value: 4 }] }),
  ] }]), overview: { conclusion: 'B has the larger supplied count', facts: [{ label: 'B', value: '4', format: 'number' }] },
  appendix: [{ type: 'details', title: 'Original records', blocks: [{ type: 'table', columns: ['value'], rows: [[2], [4]] }] }] };
  const original = args(content), before = structuredClone(original);
  const result = await capability(fixture.host, 'components_validate')(original);
  assert.equal(result.valid, true); assert.deepEqual(result.diagnostics, []); assert.equal(result.protocol, protocol);
  assert.equal(result.coverage.browser, 'not_run'); assert.equal(result.coverage.renderer, 'passed');
  assert.deepEqual(original, before); assert.deepEqual(fixture.writes, []);
  assert.equal(Object.hasOwn(result, 'html'), false); assert.equal(Object.hasOwn(result, 'ref'), false);
});

test('validation reports paths for unknown components, raw HTML, CSS, callbacks and absent data bindings', async () => {
  const validate = capability(readonlyHost().host, 'components_validate');
  const cases = [
    [args(document([{ type: 'html', html: '<script>alert(1)</script>' }])), '/content/sections/0/blocks/0'],
    [args(document([{ type: 'paragraph', text: 'x', css: 'display:none' }])), '/content/sections/0/blocks/0'],
    [args(document([chart({ rows: [{ label: 'A', value: 2 }], options: { x: 'label', y: 'value', onClick: 'script' } })])), '/content/sections/0/blocks/0'],
    [args(document([chart({ data_id: 'absent' })])), '/content/sections/0/blocks/0'],
    [args(document([chart({ rows: [{ label: 'A' }] })])), '/content/sections/0/blocks/0'],
    [args(undefined, { body_html: '<h1>raw</h1>' }), '/body_html'],
    [args(undefined, { style: { css: 'body{display:none}' } }), '/style'],
    [args({ kind: 'document', sections: [{ title: 'Invalid', blocks: 'not an array' }] }), '/content/sections/0'],
    [args({ kind: 'signal-study', run: {} }), '/content/kind'],
  ];
  for (const [input, path] of cases) {
    const result = await validate(input);
    assert.equal(result.valid, false, JSON.stringify(input));
    assert.ok(result.diagnostics.some(item => item.path.startsWith(path) && item.message), JSON.stringify(result));
  }
});

test('fixed chart data is read completely and checked against real columns, including nested and overview charts', async () => {
  const fixture = readonlyHost(), ref = fixed('bound-counts');
  fixture.put(ref, [{ label: 'A', value: 2 }, { label: 'B', value: 4 }]);
  const binding = { id: 'counts', ref, usage: 'Synthetic source counts' };
  const content = { ...document([{ type: 'group', layout: 'stack', blocks: [chart({ data_id: binding.id })] }]),
    overview: { conclusion: 'Recorded comparison', facts: [], chart: chart({ data_id: binding.id }) } };
  const validate = capability(fixture.host, 'components_validate');
  const valid = await validate(args(content, { data: [binding] }));
  assert.equal(valid.valid, true); assert.equal(valid.coverage.fixedData, 'passed');
  assert.ok(fixture.reads.filter(item => item.request.part === 'content').length > 1, 'consume all fixed resource pages');
  fixture.put(ref, [{ label: 'A', other: 2 }]);
  const invalid = await validate(args(content, { data: [binding] }));
  assert.equal(invalid.valid, false); assert.match(invalid.diagnostics[0].message, /column.*value|value.*column/i);
  assert.match(invalid.diagnostics[0].path, /^\/content\/(overview\/chart|sections\/0\/blocks\/0\/blocks\/0)/);
  fixture.put(ref, [{ label: 'A', value: 2 }], { format: 'unknown' });
  const unsupported = await validate(args(content, { data: [binding] }));
  assert.equal(unsupported.valid, false); assert.match(unsupported.diagnostics[0].message, /json-rows|format/i);
  assert.deepEqual(fixture.writes, []);
});

test('validation and show enforce the same chart-specific schemas returned by describe', async () => {
  const { describeComponents } = await import('../packages/reports/component-catalog.js');
  const examples = describeComponents(['chart.line', 'chart.parallel', 'chart.flow']).items.map(item => item.example);
  delete examples[0].options.x; delete examples[1].options.dimensions; delete examples[2].nodes;
  const fixture = readonlyHost(), validate = capability(fixture.host, 'components_validate'), show = capability(fixture.host, 'components_show');
  for (const example of examples) {
    const result = await validate(args(document([example])));
    assert.equal(result.valid, false, example.kind);
    assert.ok(result.diagnostics[0].path.startsWith('/content/sections/0/blocks/0'));
    await assert.rejects(show(publication({ content: document([example]) })), /\/content\/sections\/0\/blocks\/0/);
  }
  assert.deepEqual(fixture.writes, []);
});

test('fixed binding row budgets use the selected chart schema, and read failures remain incomplete', async () => {
  const { describeComponents } = await import('../packages/reports/component-catalog.js');
  const example = describeComponents(['chart.funnel']).items[0].example;
  const fixture = readonlyHost(), ref = fixed('funnel-rows'), binding = { id: 'funnel', ref, usage: 'Synthetic stages' };
  const bound = { ...example, data_id: binding.id }; delete bound.rows;
  fixture.put(ref, Array.from({ length: 13 }, () => example.rows[0]));
  const validate = capability(fixture.host, 'components_validate');
  const tooMany = await validate(args(document([bound]), { data: [binding] }));
  assert.equal(tooMany.valid, false); assert.match(tooMany.diagnostics[0].path, /\/content\/sections\/0\/blocks\/0\/rows/);
  fixture.host.resources.read = async () => { throw new Error('Synthetic missing resource'); };
  const unreadable = await validate(args(document([bound]), { data: [binding] }));
  assert.equal(unreadable.valid, false); assert.equal(unreadable.status, 'incomplete');
  assert.equal(unreadable.coverage.fixedData, 'unavailable'); assert.match(unreadable.diagnostics[0].message, /Could not read/);
  assert.deepEqual(fixture.writes, []);
});

test('show performs the same fixed-row preflight without requiring a validation call', async () => {
  const fixture = readonlyHost(), ref = fixed('show-counts'), data = [{ id: 'counts', ref, usage: 'Synthetic counts' }], calls = [];
  fixture.host.capabilities.invoke = async (id, request) => { calls.push({ id, request }); return { type: 'result', value: { ref: fixed('shown', 'report') } }; };
  const input = publication({ data, content: document([chart({ data_id: 'counts' })]) });
  fixture.put(ref, [{ label: 'A', wrong: 1 }]);
  await assert.rejects(capability(fixture.host, 'components_show')(input), /column.*value|value.*column/i);
  assert.equal(calls.length, 0);
  fixture.put(ref, [{ label: 'A', value: 1 }]);
  const shown = await capability(fixture.host, 'components_show')(input);
  assert.equal(shown.ref.id, 'shown'); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request.data, data); assert.deepEqual(calls[0].request.input.content, input.content);
  assert.deepEqual(fixture.writes, []);
});

test('single and multiple components use the existing document layout and default empty data', async () => {
  const calls = [], host = { capabilities: { invoke: async (id, request) => { calls.push({ id, request }); return { type: 'result', value: { ref: fixed('convenience', 'report') } }; } } };
  const one = chart({ rows: [{ label: 'A', value: 2 }, { label: 'B', value: 4 }] });
  const single = { title: 'One supplied component', provenance_kind: 'demo', component: one };
  const validated = await capability(host, 'components_validate')(single);
  assert.equal(validated.valid, true); assert.equal(calls.length, 0);
  await capability(host, 'components_show')({ ...single, operation_id: 'single-component' });
  assert.deepEqual(calls[0].request.data, []);
  assert.equal(calls[0].request.input.content.kind, 'document');
  assert.equal(calls[0].request.input.content.sections[0].title, '', 'the wrapper must not repeat the report title');
  assert.deepEqual(calls[0].request.input.content.sections[0].blocks, [one]);
  const components = [{ type: 'judgment', text: 'Compare the supplied counts' }, one];
  await capability(host, 'components_show')({ title: 'Two supplied components', provenance_kind: 'demo', operation_id: 'multiple-components', components, layout: 'columns' });
  assert.equal(calls[1].request.input.content.sections[0].title, '');
  assert.deepEqual(calls[1].request.input.content.sections[0].blocks, [{ type: 'group', layout: 'columns', blocks: components }]);
  assert.equal(Object.hasOwn(calls[1].request, 'components'), false);
  for (const extra of [{ content: document([]) }, { components: [one] }, { input_ref: { ref: fixed('input', 'resource'), entry: 'input.json' } }]) {
    await assert.rejects(capability(host, 'components_show')({ ...single, operation_id: 'ambiguous-input', ...extra }));
  }
  const invalid = await capability(host, 'components_validate')({ component: { type: 'range', label: 'Invalid bounds', min: 2, max: 1, value: 1 } });
  assert.equal(invalid.valid, false); assert.ok(invalid.diagnostics[0].path.startsWith('/component'));
  await assert.rejects(capability(host, 'components_show')({ operation_id: 'bad-range', title: 'Invalid bounds', provenance_kind: 'demo', component: { type: 'range', label: 'Invalid bounds', min: 2, max: 1, value: 1 } }), /component|range|finite/i);
});

test('validation reuses fixed attachment checks and reads workspace attachments without creating imports', async t => {
  const fixture = readonlyHost(), ref = fixed('attachment', 'resource');
  fixture.put(ref, { exact: '9007199254740993.00001' }, { path: 'original.json' });
  const content = document([{ type: 'attachments', items: [{ label: 'Original JSON', path: 'evidence/original.json' }] }]);
  const asset = { path: 'evidence/original.json', media_type: 'application/json', ref, entry: 'original.json' };
  const validate = capability(fixture.host, 'components_validate');
  assert.equal((await validate(args(content, { assets: [asset], references: [ref] }))).valid, true);
  const mismatched = await validate(args(content, { assets: [asset], references: [{ ...ref, revision: 'changed' }] }));
  assert.equal(mismatched.valid, false); assert.equal(mismatched.diagnostics[0].path, '/assets/0/ref');
  const workspace = await mkdtemp(resolve('tests', '.components-workspace-'));
  t.after(async () => { const target = resolve(workspace); assert.ok(target.startsWith(resolve('tests') + '\\')); await rm(target, { recursive: true, force: true }); });
  fixture.host.context = { workspaceRoot: workspace };
  await writeFile(join(workspace, 'fixture.json'), '{"synthetic":true}');
  assert.equal((await validate(args(content, { assets: [{ path: asset.path, media_type: 'application/json', source_path: 'fixture.json' }] }))).valid, true);
  assert.deepEqual(fixture.writes, []);
  const escaped = await validate(args(content, { assets: [{ path: asset.path, media_type: 'application/json', source_path: '../report-components.test.mjs' }] }));
  assert.equal(escaped.valid, false); assert.equal(escaped.diagnostics[0].path, '/assets/0/source_path');
});

test('show delegates content and revisions to the host-selected provider and returns real fixed metadata', async () => {
  const calls = [], signal = new AbortController().signal;
  const receipt = { ref: fixed('published', 'report'), renderStatus: 'not_checked', provider: { pluginId: 'fixture/selected', serviceId: 'report', revision: 'selected-revision', version: '2.0.0' },
    presentation: { id: 'fixture/selected', version: '2.0.0' }, inputDigest: 'sha256:' + 'b'.repeat(64) };
  const host = { capabilities: { invoke: async (...values) => { calls.push(values); return { type: 'result', value: receipt }; } } };
  const input = publication({ artifact_id: 'existing-report', expected_revision: 'original-revision', space: 'research' });
  const before = structuredClone(input), result = await capability(host, 'components_show')(input, signal);
  assert.deepEqual(input, before); assert.equal(calls.length, 1); assert.equal(calls[0][0], 'host.reports.publish');
  assert.equal(calls[0][2].signal, signal); assert.deepEqual(calls[0][1].input.content, input.content);
  assert.equal(calls[0][1].artifactId, 'existing-report'); assert.equal(calls[0][1].expectedRevision, 'original-revision');
  assert.equal(calls[0][1].summary, ''); assert.equal(Object.hasOwn(calls[0][1], 'provider'), false);
  assert.deepEqual(result.ref, receipt.ref); assert.deepEqual(result.renderer, receipt.presentation);
  assert.equal(result.protocol, protocol); assert.deepEqual(result.componentRef.ref, receipt.ref);
  assert.equal(result.componentRef.inputDigest, receipt.inputDigest); assert.equal(result.renderStatus, 'not_checked');
  assert.equal(Object.hasOwn(result, '_meta'), false); assert.equal(Object.hasOwn(result, 'html'), false);
});

test('show rejects alternate layouts, active uploads and provider overrides before host publication', async () => {
  const calls = [], host = { capabilities: { invoke: async (...values) => { calls.push(values); throw new Error('must not publish'); } } };
  const show = capability(host, 'components_show');
  for (const extra of [{ content: { kind: 'backtest' } }, { body_html: '<p>HTML</p>' }, { html_path: 'fake.html' }, { provider: 'other/report' }]) {
    await assert.rejects(show(publication(extra)), /document|property|HTML|provider/i);
  }
  assert.deepEqual(calls, []);
});

test('show checks document inputRef without rewriting its fixed identity and lets the host publish it', async () => {
  const fixture = readonlyHost(), ref = fixed('prepared-input', 'resource'), calls = [];
  fixture.put(ref, { content: args().content }, { path: 'input.json' });
  fixture.host.capabilities.invoke = async (id, request) => { calls.push({ id, request }); return { type: 'result', value: { ref: fixed('out', 'report') } }; };
  const input = publication({ input_ref: { ref, entry: 'input.json' } }); delete input.content;
  await capability(fixture.host, 'components_show')(input);
  assert.deepEqual(calls[0].request.inputRef, input.input_ref); assert.equal(Object.hasOwn(calls[0].request, 'input'), false);
  fixture.put(ref, { content: { kind: 'backtest' } }, { path: 'input.json' });
  await assert.rejects(capability(fixture.host, 'components_show')(input), /document/);
  fixture.put(ref, { content: args().content }, { path: 'input.json', mediaType: 'text/html' });
  await assert.rejects(capability(fixture.host, 'components_show')(input), /JSON|json/);
  assert.equal(calls.length, 1); assert.deepEqual(fixture.writes, []);
});

test('a combined component document renders its bound chart through the existing browser runtime', { skip: !process.env.SESAME_HOST_ROOT, timeout: 30000 }, async t => {
  const rows = [{ label: 'A', value: 2 }, { label: 'B', value: 4 }], data = [{ id: 'counts', ref: fixed('counts'), usage: 'Synthetic counts' }];
  const content = document([{ type: 'group', layout: 'columns', blocks: [
    { type: 'judgment', text: 'B has the larger supplied count' }, chart({ data_id: 'counts' }),
  ] }]);
  const fixture = readonlyHost(); fixture.put(data[0].ref, rows);
  assert.equal((await capability(fixture.host, 'components_validate')(args(content, { data }))).valid, true);
  const result = await renderReport({}, { metadata: { title: 'Synthetic components', summary: '', locale: 'en', provenanceKind: 'demo', features: ['interactive'] }, data, related: [], references: [], input: { content } });
  const { chromium } = createRequire(join(process.env.SESAME_HOST_ROOT, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('readFixtureRows', () => ({ rows }));
  await page.addInitScript(() => { window.report = { readData: window.readFixtureRows }; });
  await page.goto('about:blank');
  await page.evaluate(() => { window.report = { readData: window.readFixtureRows }; });
  await page.setContent(result.files[0].content);
  await page.locator('#content-chart-1 svg').waitFor();
  const heights = await page.locator('#content-chart-1 svg rect').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('height'))));
  assert.equal(heights.length, 2); assert.ok(heights[1] > heights[0]);
  assert.match(await page.locator('#content-chart-1 svg').textContent(), /A.*B/s);
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.deepEqual(errors, []);
});
