import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { validateInput, bars, envelope } from '../scripts/abu-runtime.mjs';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('abu-plugins.json', root)));
const read = (url, path) => JSON.parse(readFileSync(new URL(path, url)));
const fixture = () => ({ schema_version: 1, as_of: '2026-01-02T00:00:00.000Z', source: { id: 'invented', kind: 'synthetic' }, bars: [{ time: '2026-01-01T00:00:00.000Z', available_at: '2026-01-01T00:00:00.000Z', open: 10, high: 12, low: 9, close: 11, volume: 50 }] });

test('shared input boundary rejects invalid calendar, unknown provenance, finite and complexity violations', () => {
  assert.throws(() => validateInput({ ...fixture(), as_of: '2026-02-30T00:00:00.000Z' }), /calendar/);
  assert.throws(() => validateInput({ ...fixture(), source: { id: 'fake', kind: 'guaranteed' } }), /source.kind/);
  assert.throws(() => validateInput({ ...fixture(), missing: undefined }), /finite JSON/);
  assert.throws(() => validateInput({ ...fixture(), metric: Infinity }), /finite JSON/);
  assert.throws(() => validateInput({ ...fixture(), text: 'x'.repeat(2 * 1024 * 1024) }), /2 MiB/);
  const cycle = fixture(); cycle.cycle = cycle;
  assert.throws(() => validateInput(cycle), /complexity/);
});

test('bar boundary rejects future availability, duplicates, unsorted time, negative volume and malformed ranges', () => {
  for (const change of [{ available_at: '2026-01-03T00:00:00.000Z' }, { high: 10 }, { volume: -1 }, { close: 0 }]) {
    const data = fixture(); Object.assign(data.bars[0], change); assert.throws(() => bars(data));
  }
  const data = fixture(); data.bars.push({ ...data.bars[0] }); assert.throws(() => bars(data), /unique/);
  assert.throws(() => bars({ ...fixture(), bars: [] }), /array/);
});

test('customized analysis cannot overwrite evidence identity or baseline metadata', () => {
  for (const field of ['schema_version', 'baseline', 'status', 'guidance', 'as_of', 'source', 'input_sha256', 'implementation_sha256', 'dataset_id', 'input_dataset_id']) {
    assert.throws(() => envelope(fixture(), () => ({ parameters: {}, observations: [], limitations: [], [field]: 'forged' }), import.meta.url), /reserved evidence/);
  }
});

test('a customized calculation cannot mutate the recorded caller input', () => {
  const input = fixture(), saved = structuredClone(input);
  const output = envelope(input, value => {
    value.source.id = 'altered-inside-calculation'; value.bars[0].close = 999;
    return { parameters: {}, observations: [], limitations: [] };
  }, new URL('../packages/abu-indicators/scripts/baseline.mjs', import.meta.url));
  assert.deepEqual(input, saved); assert.deepEqual(output.source, saved.source);
});

for (const entry of catalog) {
  const url = new URL(`packages/${entry.directory}/`, root);
  test(`${entry.id}: metadata, native tool, CLI, evidence and modification trace agree`, async () => {
    const manifest = read(url, 'plugin.json'), definitions = read(url, 'tools.json');
    const { createTools } = await import(new URL('index.js', url));
    const data = read(url, 'examples/input.json'), registry = new Map();
    const host = { tools: { Type, define: (name, description, properties, execute) => ({ name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) },
      datasets: { register(record) { registry.set(record.id, structuredClone(record)); return record; } } };
    const tools = createTools(host);
    assert.deepEqual(tools.map(({ name, description, parameters }) => JSON.parse(JSON.stringify({ name, description, parameters }))), definitions);
    assert.deepEqual(manifest.tool_names, [entry.tool]); assert.equal(manifest.default_state, 'discoverable');
    assert.equal(manifest.license, 'GPL-3.0-only'); assert.equal(manifest.agent_scope, 'all');
    assert.equal(Value.Check(tools[0].parameters, { input: data }), true);
    assert.equal(Value.Check(tools[0].parameters, { input: data, code: 'evil()' }), false);
    for (const resource of manifest.resources) assert.ok(readFileSync(new URL(resource, url)).length, resource);
    for (const resource of ['README.md', 'prompt.md', `skills/${entry.directory}/SKILL.md`]) {
      const text = readFileSync(new URL(resource, url), 'utf8');
      assert.match(text, /基线/); assert.match(text, /标准答案/); assert.match(text, /改进|修改/);
      if (resource.endsWith('/SKILL.md')) {
        assert.match(text, /^---\r?\n/); assert.ok(text.includes(`name: ${entry.directory}`)); assert.match(text, /\ndescription: .+/);
      }
    }
    assert.equal(readFileSync(new URL('scripts/runtime.mjs', url), 'utf8'), readFileSync(new URL('scripts/abu-runtime.mjs', root), 'utf8'));
    const output = tools[0].execute({ input: data });
    assert.equal(output.baseline, true); assert.equal(output.status, 'research_baseline');
    assert.match(output.input_sha256, /^sha256:[a-f0-9]{64}$/); assert.match(output.implementation_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(registry.get(output.dataset_id).rows, [output]);
    assert.deepEqual(registry.get(output.input_dataset_id).rows, [{ input: data }]);
    assert.equal(registry.get(output.dataset_id).provenance.kind, 'demo');
    const controller = new AbortController(); controller.abort();
    assert.throws(() => tools[0].execute({ input: data }, controller.signal), /cancelled/); assert.equal(registry.size, 2);
    const dir = mkdtempSync(join(tmpdir(), 'sesame-abu-cli-'));
    try {
      const input = join(dir, 'input.json'), out = join(dir, 'result.json'), cli = fileURLToPath(new URL('scripts/baseline.mjs', url));
      writeFileSync(input, JSON.stringify(data));
      const command = spawnSync(process.execPath, [cli, input, '--out', out], { encoding: 'utf8', timeout: 20000 });
      assert.equal(command.status, 0, command.stderr); const fromCli = JSON.parse(readFileSync(out));
      const { dataset_id: _dataset, input_dataset_id: _input, ...fromTool } = output;
      assert.deepEqual(fromCli, fromTool);
      const again = spawnSync(process.execPath, [cli, input, '--out', out], { encoding: 'utf8', timeout: 20000 });
      assert.notEqual(again.status, 0); assert.match(again.stderr, /EEXIST/); assert.deepEqual(JSON.parse(readFileSync(out)), fromCli);
      const changed = structuredClone(data); changed.source.id += '-new-source';
      const { analyze } = await import(new URL('scripts/baseline.mjs', url));
      assert.notEqual(envelope(changed, analyze, new URL('scripts/baseline.mjs', url)).input_sha256, output.input_sha256);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
