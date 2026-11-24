import {readPackageDirectory} from '../../protocol/directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../packages/', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const read = (name, path) => readFile(new URL(`${name}/${path}`, root));
// Layout-pilot identities remain fixed. The research declaration was deliberately
// extended for optional workflows, custom-member QA and visible research reports.
// Exact new-host engine/call declarations are reviewed in plugin-boundaries-reviewed-changes.json;
// input/result shape and default execution are also checked below and in the host tests.
const contracts = {
  ict: { manifest: '4220d8f8e3ac4e671a9fce85dee861817c5100bb4073a28a2c08c1ec810831a0', declaration: 'e4bec4696f626f491726cd65382b9fa48f829fb30624c341c527515a4d14e83a' },
  'investment-research': { manifest: '3335edae35664d145b328cfe1d410fa90f3f447847b329e1d14c627ed431d406', declaration: 'b8e748e4a9169764691a0037a086754918a9c5ade0b7fd4cb8f105ced51554e4' },
};

test('ICT and Investment Research retain layout-pilot identities and reviewed API 2 declarations', async () => {
  for (const [name, expected] of Object.entries(contracts)) {
    const { version, title, description, ...manifest } = readPackageDirectory(new URL(name+'/',root)).manifest;
    const declaration = readPackageDirectory(new URL(name+'/',root)).capabilities;
    assert.equal(hash(JSON.stringify(manifest)), expected.manifest, `${name}: identity, engine, entry or resource paths changed`);
    assert.equal(hash(JSON.stringify(declaration)), expected.declaration, `${name}: capabilities, schemas, knowledge or host contributions changed`);
    for (const entry of declaration.knowledge) await read(name, entry.path);
  }
});

test('optional research workflows retain the existing entry points, default inputs and fixed result shape', async () => {
  const { capabilities } = readPackageDirectory(new URL('investment-research'+'/',root)).capabilities;
  assert.deepEqual(capabilities.map(item => item.id), ['investment_research_analyze', 'investment_research_report', 'investment_research_ask']);
  const [analyze, report, ask] = capabilities;
  assert.deepEqual(analyze.inputSchema.required, ['research', 'model']);
  assert.deepEqual(analyze.inputSchema.anyOf, [{ required: ['title', 'question', 'subjects'] }, { required: ['start_from'] }]);
  assert.ok(!analyze.inputSchema.required.includes('workflow'));
  assert.deepEqual(report.inputSchema.required, ['result_ref', 'model']);
  for (const capability of [analyze, report]) {
    assert.deepEqual(capability.outputSchema.required, ['result_ref', 'summary']);
    assert.deepEqual(capability.outputSchema.properties.result_ref.required, ['id', 'revision', 'digest', 'kind', 'schemaVersion']);
    assert.equal(capability.outputSchema.properties.result_ref.properties.kind.const, 'data');
  }
  const accepted = (schema, value) => schema.enum ? schema.enum.includes(value) : new RegExp(schema.pattern).test(value);
  for (const id of ['market', 'fundamentals', 'news', 'sentiment']) assert.ok(accepted(ask.inputSchema.properties.analyst, id), id);
  for (const id of ['market', 'fundamentals', 'news', 'sentiment', 'bull', 'bear', 'risk', 'manager']) {
    for (const field of ['from', 'to']) assert.ok(accepted(ask.outputSchema.properties[field], id), `${field}: ${id}`);
  }
  for (const id of ['bull', 'bear', 'risk', 'manager']) assert.ok(accepted(analyze.inputSchema.properties.start_from.properties.role, id), id);
});

test('ICT keeps its existing Python entry points and fixed demonstration inputs intact', async () => {
  const files = {
    'scripts/observe.py': '72eb93dcfaf4774614bf9cbde9714293a8a7afa84b0726d1795d8d8778f73e6d',
    'scripts/bar_input.py': '7628efc0b5f3f311187649e279aacaa415f09b3936c0dc82db5fa6aadb96658b',
    'examples/bars.json': '3b475c9d668a7afaac75778acecc70b621fb5e992f2a59560b194e064f2d541a',
    'examples/source.json': '2feb68724c120551298977493f834cb32449fce1ba83f7d6dbda86fe5384ac18',
  };
  for (const [path, expected] of Object.entries(files)) assert.equal(hash(await read('ict', path)), expected, path);
  const { createCapabilities } = await import('../packages/ict/index.js');
  assert.deepEqual(createCapabilities(), []);
});
