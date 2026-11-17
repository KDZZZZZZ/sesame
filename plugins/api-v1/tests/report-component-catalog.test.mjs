import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPONENT_PROTOCOL, documentSchema, getComponentSchema, getChartSchema, getBlockSchema, listComponents, describeComponents } from '../packages/reports/component-catalog.js';
import { renderStructuredReport } from '../packages/reports/report-content.js';
import { chartDefinition, chartValue, kitKinds } from '../packages/reports/report-chart-fields.js';
import { normalizeComponentContent } from '../packages/reports/component-input.js';

const host = process.env.SESAME_HOST_ROOT;
const manifest = JSON.parse(await readFile(new URL('../packages/reports/capabilities.json', import.meta.url), 'utf8'));
const publicationSchema = manifest.capabilities.find(item => item.id === 'report_render').inputSchema.properties.input;
const publicBlocks = publicationSchema.$defs.block.oneOf;
const publicKinds = publicBlocks.find(item => item.properties.type.const === 'chart').properties.kind.enum;
const all = listComponents({ limit: 100 });
const details = all.items.flatMap((_, index, items) => index % 12 ? [] : describeComponents(items.slice(index, index + 12).map(item => item.id)).items);
const asDocument = item => ({ kind: 'document', sections: [{ title: item.label, blocks: [item.example] }] });
const args = item => ({ title: '组件目录演示', locale: 'zh-CN', provenance_kind: 'demo', data: [], ...item.exampleContext, target: 'answer', content: asDocument(item) });

test('catalog exposes exactly the public document components and no internal projections', async () => {
  assert.equal(COMPONENT_PROTOCOL, 'sesame-components/1');
  assert.equal(all.schemaVersion, 1);
  assert.equal(all.total, 55);
  assert.equal(publicKinds.length, 38);
  assert.equal(publicBlocks.length, 15);
  assert.deepEqual(all.items.filter(item => item.id.startsWith('chart.')).map(item => item.id.slice(6)).sort(), [...publicKinds].sort());
  assert.deepEqual(all.items.filter(item => item.id.startsWith('block.')).map(item => item.id.slice(6)).sort(), publicBlocks.map(item => item.properties.type.const).sort());
  assert.deepEqual(all.items.filter(item => !/^(chart|block)\./.test(item.id)).map(item => item.id).sort(), ['layout.columns', 'layout.stack']);
  assert.equal(new Set(all.items.map(item => item.id)).size, 55);
  assert.equal(all.categories.reduce((sum, category) => sum + category.count, 0), 55);
  for (const item of all.items) {
    assert.match(item.label, /[\u3400-\u9fff]/);
    assert.match(item.whenToUse, /[\u3400-\u9fff]/);
    assert.ok(all.categories.some(category => category.id === item.category));
    assert.ok(item.placement.length > 0);
    assert.ok(item.placement.every(path => !path.includes('appendix')));
    assert.equal(Object.hasOwn(item, 'inputSchema'), false, 'list stays a compact index');
    assert.equal(Object.hasOwn(item, 'example'), false);
  }
  for (const item of details) assert.equal(item.exampleContext.provenance_kind, 'demo', item.id);
  for (const item of details.filter(item => item.id.startsWith('chart.'))) {
    const example = (await normalizeComponentContent({}, asDocument(item))).sections[0].blocks[0];
    for (const field of ['title', 'columns', 'takeaway', 'source_note']) {
      assert.equal(Object.hasOwn(item.example, field), false, `${item.id} keeps ${field} optional`);
      assert.equal(item.inputSchema.required.includes(field), false, `${item.id} schema keeps ${field} optional`);
    }
    const definition = { kind: example.kind, columns: example.columns, options: example.options, data_requirements: 'Supplied demo records' };
    chartDefinition(definition);
    chartValue({ rows: example.rows, ...(example.nodes ? { nodes: example.nodes } : {}) }, definition);
    assert.ok(Object.keys(item.inputSchema.properties.options.properties).length > 2, item.id);
  }
});

test('pagination is bounded, stable and bound to the current search', () => {
  const first = listComponents();
  assert.equal(first.items.length, 20);
  assert.equal(first.total, 55);
  assert.ok(first.nextCursor);
  const second = listComponents({ cursor: first.nextCursor });
  const third = listComponents({ cursor: second.nextCursor });
  assert.equal(third.items.length, 15);
  assert.equal(Object.hasOwn(third, 'nextCursor'), false);
  assert.deepEqual([...first.items, ...second.items, ...third.items].map(item => item.id), all.items.map(item => item.id));
  for (const limit of [0, -1, 101, 1.5, '20', null]) assert.throws(() => listComponents({ limit }), /limit/);
  for (const cursor of ['', 'not-a-cursor', 2, null]) assert.throws(() => listComponents({ cursor }), /cursor/);
  assert.throws(() => listComponents({ query: '分布', cursor: first.nextCursor }), /cursor/);
  assert.throws(() => listComponents({ category: 'distribution', cursor: first.nextCursor }), /cursor/);
  assert.throws(() => listComponents({ category: 'unknown' }), /category/);
  assert.throws(() => listComponents({ query: [] }), /query/);
  assert.throws(() => listComponents({ extra: true }), /filter/);
});

test('Chinese purposes, English terms, ids and category filters discover the intended components', () => {
  const ids = filter => listComponents({ ...filter, limit: 100 }).items.map(item => item.id);
  assert.ok(ids({ query: '有序' }).includes('chart.line'));
  assert.ok(ids({ query: '两个 状态' }).includes('chart.dumbbell'));
  assert.ok(ids({ query: '离散 异常值' }).includes('chart.boxplot'));
  assert.ok(ids({ query: 'center spread' }).includes('chart.boxplot'));
  assert.deepEqual(ids({ query: 'CHART.CANDLESTICK' }), ['chart.candlestick']);
  assert.deepEqual(ids({ query: '不存在的组件名称' }), []);
  for (const item of listComponents({ category: 'distribution' }).items) assert.equal(item.category, 'distribution');
  const first = listComponents({ query: 'chart', category: 'comparison', limit: 2 });
  const next = listComponents({ query: ' CHART ', category: 'comparison', limit: 2, cursor: first.nextCursor });
  assert.ok(next.items.every(item => !first.items.some(firstItem => firstItem.id === item.id)));
});

test('describe rejects unknown ids, keeps order and returns independent contract copies', () => {
  for (const ids of [[], null, 'chart.line', Array(13).fill('chart.line')]) assert.throws(() => describeComponents(ids), /1–12/);
  for (const id of ['chart.projection', 'module.M01', 'layout.freeform', 'chart.unknown', null]) assert.throws(() => describeComponents([id]), /Unknown component id/);
  assert.deepEqual(describeComponents(['layout.stack', 'chart.boxplot']).items.map(item => item.id), ['layout.stack', 'chart.boxplot']);
  const result = describeComponents(['chart.line']).items[0];
  result.example.rows[0].value = 999;
  result.inputSchema.properties.kind.const = 'wrong';
  result.placement.push('wrong');
  const fresh = describeComponents(['chart.line']).items[0];
  assert.equal(fresh.example.rows[0].value, 2);
  assert.equal(fresh.inputSchema.properties.kind.const, 'line');
  assert.ok(!fresh.placement.includes('wrong'));
  const schema = getChartSchema('line'); schema.required.push('wrong');
  assert.ok(!getChartSchema('line').required.includes('wrong'));
  assert.deepEqual(getBlockSchema('paragraph'), publicBlocks.find(item => item.properties.type.const === 'paragraph'));
  assert.deepEqual(documentSchema, { ...publicationSchema.properties.content, $defs: publicationSchema.$defs });
});

test('every component example renders through the production document renderer', async () => {
  for (const item of details) {
    const before = structuredClone(item.example);
    const html = await renderStructuredReport({}, args(item));
    assert.match(html, /<!doctype html>/);
    assert.match(html, /演示/);
    assert.deepEqual(item.example, before, item.id);
    if (item.id.startsWith('chart.')) {
      const config = JSON.parse(html.match(/<script id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
      assert.equal(config[0].kind, item.example.kind);
      assert.deepEqual(config[0].rows, item.example.rows);
    }
  }
});

test('all examples satisfy their standalone derived schemas and the public document contract', { skip: !host && 'Set SESAME_HOST_ROOT' }, async () => {
  const { validateSchemas } = await import(pathToFileURL(join(host, 'modules/shared/schema-service.js')));
  for (const item of details) {
    try {
      await validateSchemas([{ schema: item.inputSchema, value: item.example }, { schema: documentSchema, value: asDocument(item) }]);
    } catch (error) { throw new Error(`${item.id}: ${error.message}`, { cause: error }); }
  }
  const invalid = [
    ['chart.line', example => { delete example.options.x; }],
    ['chart.line', example => { example.options.series = 'group'; example.options.y = ['a', 'b']; }],
    ['chart.histogram', example => { example.options.sampleCount = 0; }],
    ['chart.parallel', example => { example.options.dimensions = []; }],
    ['chart.calendar', example => { example.options.weekStart = 7; }],
    ['chart.bump', example => { example.options.ties = 'guessed'; }],
    ['chart.flow', example => { delete example.nodes; }],
    ['chart.spectrum', example => { delete example.options.focus; }],
    ['chart.line', example => { example.data_id = 'also-bound'; }],
    ['chart.line', example => { example.options.onSelect = 'callback'; }],
  ];
  for (const [id, mutate] of invalid) {
    const item = describeComponents([id]).items[0]; mutate(item.example);
    await assert.rejects(validateSchemas([{ schema: getComponentSchema(id), value: item.example }]), undefined, id);
  }
  // Renderer accepts every day of the week; the catalog must not narrow it to
  // Monday/Sunday just because those are common authoring choices.
  const calendar = describeComponents(['chart.calendar']).items[0];
  calendar.example.options.weekStart = 6;
  await validateSchemas([{ schema: calendar.inputSchema, value: calendar.example }]);
});

test('all public chart kinds mount in the actual browser and match the renderer registry', { skip: !host && 'Set SESAME_HOST_ROOT', timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => route.abort());
  const content = { kind: 'document', sections: details.map(item => ({ title: item.id, blocks: [item.example] })) };
  // The document has a public 50-section limit; combine adjacent examples.
  content.sections = content.sections.flatMap((section, index, sections) => index % 2 ? [] : [{ title: section.title,
    blocks: [section.blocks[0], ...(sections[index + 1]?.blocks ?? [])] }]);
  const html = await renderStructuredReport({}, { title: '组件目录浏览器演示', locale: 'zh-CN', provenance_kind: 'demo', data: [], target: 'answer',
    ...details.find(item => item.id === 'block.attachments').exampleContext, content });
  await page.setContent(html.replace('</head>', '<script>window.report={track:promise=>(window.catalogRender=promise,promise)};</script></head>'));
  await page.evaluate(() => window.catalogRender);
  const registry = await page.evaluate(() => SesameCharts.kinds());
  assert.deepEqual([...new Set([...registry, ...kitKinds])].sort(), [...publicKinds].sort());
  const charts = details.filter(item => item.example.type === 'chart');
  assert.equal(await page.locator('.module-chart-plot').count(), charts.length);
  for (let index = 0; index < charts.length; index++) {
    const chart = page.locator('.module-chart-plot').nth(index);
    assert.ok(await chart.locator(charts[index].example.kind === 'candlestick' ? 'canvas' : 'svg').count(), charts[index].id);
    assert.equal(await chart.evaluate(element => [...element.querySelectorAll('svg *')].some(node => [...node.attributes].some(attribute => /NaN|Infinity/.test(attribute.value)))), false, charts[index].id);
  }
  assert.deepEqual(errors, []);
});
