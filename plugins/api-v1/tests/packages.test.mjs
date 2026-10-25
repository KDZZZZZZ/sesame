import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../packages/', import.meta.url));

test('the MCP catalog returns its declared schemas and exact sample results', () => {
  let samples = 0;
  // The three parsers now use native capabilities. Their frozen samples and
  // transport are exercised by source-parser-transport.test.mjs.
  for (const name of ['quantskills-catalog']) {
    const directory = fileURLToPath(new URL(`../../optional-api-v1/packages/${name}/`, import.meta.url)), manifest = JSON.parse(readFileSync(join(directory, 'plugin.json'))), extension = manifest;
    assert.equal(extension.id, `sesame/${name}`); assert.equal(extension.apiVersion, '2'); assert.equal(manifest.version, JSON.parse(readFileSync(join(directory, 'package.json'))).version);
    const operations = [{ method: 'initialize', params: {} }, { method: 'tools/list' }, ...extension.tests.map(sample => ({ method: 'tools/call', params: { name: sample.tool, arguments: sample.arguments } }))];
    assert.equal(manifest.execution, 'mcp');
    const run = spawnSync(process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), ['-B', '-X', 'utf8', '-I', join(directory, 'server.py')], { cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' }, timeout: 10000, maxBuffer: 1024 * 1024, input: operations.map((operation, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, ...operation })).join('\n') + '\n' });
    assert.equal(run.status, 0, run.stderr); const responses = run.stdout.trim().split('\n').map(line => JSON.parse(line).result);
    assert.equal(responses[0].serverInfo.version, manifest.version);
    assert.deepEqual(responses[1].tools, JSON.parse(readFileSync(join(directory, 'capabilities.json'))).capabilities.map(cap => ({name:cap.binding.name,description:cap.description,inputSchema:cap.inputSchema,outputSchema:cap.outputSchema})));
    extension.tests.forEach((sample, index) => { assert.equal(responses[index + 2].isError, false); assert.deepEqual(responses[index + 2].structuredContent, sample.expected); samples++; });
  }
  assert.equal(samples, 5);
});

test('the committed gallery is reproducible without writing to the source package', t => {
  const path = join(root, 'reports/examples/editorial-demo.html'), before = readFileSync(path);
  const directory = mkdtempSync(join(tmpdir(), 'sesame-report-demo-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(join(root, 'reports'), directory, { recursive: true });
  const build = spawnSync(process.execPath, [join(directory, 'scripts/build-demo.mjs')], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  assert.deepEqual(readFileSync(join(directory, 'examples/editorial-demo.html')), before);
  assert.deepEqual(readFileSync(path), before);
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
