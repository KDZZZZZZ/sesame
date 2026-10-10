import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createTools as reportTools } from '../packages/reports/index.js';

const root = fileURLToPath(new URL('../packages/', import.meta.url));

test('standard MCP servers return their declared schemas and ten exact sample results', () => {
  let samples = 0;
  for (const name of ['web-extract', 'rss-collect', 'market-data-parser', 'quantskills-catalog']) {
    const directory = fileURLToPath(new URL(`../../optional-api-v1/packages/${name}/`, import.meta.url)), manifest = JSON.parse(readFileSync(join(directory, 'plugin.json'))), extension = manifest.extensions['bot.sesame'];
    assert.equal(extension.id, `sesame/${name}`); assert.equal(extension.apiVersion, '1'); assert.equal(manifest.version, JSON.parse(readFileSync(join(directory, 'package.json'))).version);
    const operations = [{ method: 'initialize', params: {} }, { method: 'tools/list' }, ...extension.tests.map(sample => ({ method: 'tools/call', params: { name: sample.tool, arguments: sample.arguments } }))];
    if (name !== 'quantskills-catalog') operations.push({ method: 'tools/call', params: { name: extension.tests[0].tool, arguments: { file_path: '../../package.json' } } });
    const run = spawnSync('python3', ['-I', join(directory, 'server.py')], { cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' }, timeout: 10000, maxBuffer: 1024 * 1024, input: operations.map((operation, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, ...operation })).join('\n') + '\n' });
    assert.equal(run.status, 0, run.stderr); const responses = run.stdout.trim().split('\n').map(line => JSON.parse(line).result);
    assert.equal(responses[0].serverInfo.version, manifest.version);
    assert.deepEqual(responses[1].tools, JSON.parse(readFileSync(join(directory, 'tools.json'))).analysis);
    extension.tests.forEach((sample, index) => { assert.equal(responses[index + 2].isError, false); assert.deepEqual(responses[index + 2].structuredContent, sample.expected); samples++; });
    if (name !== 'quantskills-catalog') assert.equal(responses.at(-1).isError, true);
  }
  assert.equal(samples, 10);
});

test('report template escapes authored text and retains only local chart assets and the read-only bridge', async () => {
  // Schema generation is validated by the application. This source test exercises
  // template output with a narrow host port and no private application modules.
  const Type = new Proxy({}, { get: () => () => ({}) }), writes = [];
  const tools = reportTools({ tools: { Type, string: () => ({}), optional: () => ({}), define: (name, _description, _properties, execute) => ({ name, execute }) }, workspace: { file: async (...args) => writes.push(args) } });
  const template = tools.find(tool => tool.name === 'report_template');
  await template.execute({ output_path: 'report.html', title: '</title><script>invalid()</script>', summary: '<strong>Untrusted text</strong>', data_id: '</script><script>invalid()</script>', chart_title: 'Demo', takeaway: 'Fictional sample', source_note: 'Demo only', kind: 'line', x: 'month', y: 'value', unit: '%', columns: ['month', 'value'], demo: true });
  const html = writes[0][2];
  assert.match(html, /&lt;script&gt;invalid\(\)&lt;\/script&gt;/); assert.match(html, /\\u003c\/script>/);
  assert.doesNotMatch(html, /<script>invalid\(\)/); assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/i);
  assert.match(html, /reportKit\.render/); assert.match(html, /reportKit\.rows\(config.dataId\)/);
  assert.match(html, /kit-verdict-headline/); assert.match(html, /kit-appendix/);
  assert.match(html, /window\.report\.track\(initialize\(\)\)/); assert.match(html, /readData\(dataId/); assert.match(html, /DEMO SAMPLE/);
  await assert.rejects(template.execute({ kind: 'matrix' }), /value column/);
});

test('the committed gallery is reproducible from its original local assets and explicit demo input', () => {
  const path = join(root, 'reports/examples/editorial-demo.html'), before = readFileSync(path);
  const build = spawnSync(process.execPath, [join(root, 'reports/scripts/build-demo.mjs')], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr); assert.deepEqual(readFileSync(path), before);
  const data = JSON.parse(readFileSync(join(root, 'reports/examples/demo-data.json'))); assert.equal(data.provenance.kind, 'demo');
  assert.equal(data.monthly.filter(row => row.change === null).length, 1);
  assert.match(before.toString(), /FICTIONAL DEMO/); assert.doesNotMatch(before.toString(), /<script[^>]+src=|<link[^>]+href=/i);
});

// Exercise the migrated data adapter without a browser: no host globals beyond
// the public read-only bridge are available in the new report runtime.
test('reportKit pages exact fixed bindings, retains strings and reports cursor and row-budget failures', async () => {
  const source = readFileSync(join(root, 'reports/assets/report-kit.js'), 'utf8');
  const build = readData => { const context = { window: { report: { readData } }, document: { documentElement: { lang: 'en' } } }; runInNewContext(source, context); return context.window.reportKit; };
  const calls = [], values = [{ value: '9007199254740993.0000000000001' }, { value: null }];
  const kit = build(async (id, options) => { calls.push({ id, ...options }); return options.cursor ? { rows: [values[1]], page: { nextCursor: null } } : { rows: [values[0]], page: { nextCursor: 'page-two' } }; });
  assert.equal(JSON.stringify(await kit.rows('exact-binding')), JSON.stringify(values));
  assert.deepEqual(calls.map(call => call.id), ['exact-binding', 'exact-binding']);
  assert.equal(calls[1].cursor, 'page-two');
  await assert.rejects(build(async () => ({ rows: [], page: { nextCursor: 'repeated' } })).rows('data'), /cursor repeated/);
  await assert.rejects(build(async () => ({ rows: values, page: {} })).rows('data', { maxRows: 1 }), /row budget/);
  await assert.rejects(build(async () => { throw new Error('unbound fixed data'); }).rows('not-bound'), /unbound fixed data/);
});
