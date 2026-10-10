import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Type } from '@sesame/plugin-sdk/schema';
import * as svl from '@sesame/plugin-sdk/svl';
import { createTools } from '../packages/strategy-authoring/index.js';

const root = new URL('../packages/strategy-authoring/', import.meta.url);
const bytes = path => readFileSync(new URL(path, root));
const json = path => JSON.parse(bytes(path));
const languagePath = 'skills/strategy-authoring/references/language.md';
const string = description => Type.String({ description, minLength: 1, maxLength: 20000 });
const helpers = { Type, string, optional: description => Type.Optional(string(description)), define: (name, description, properties, execute) => ({ name, label: name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) };

function validateTool(path, source = bytes(path)) {
  // The plugin receives the actual public SDK, not a replacement validator.
  // Only its file-read port is supplied by this fixture; no native engine runs.
  const host = { tools: helpers, svl, workspace: { file: async (operation, requested) => { assert.equal(operation, 'read'); assert.equal(requested, path); return source; } } };
  return createTools(host).find(tool => tool.name === 'strategy_validate').execute({ source_path: path });
}

test('the skill exposes a declared self-contained language reference and every supported operator', () => {
  const manifest = json('plugin.json'), reference = bytes(languagePath).toString(), skill = bytes('skills/strategy-authoring/SKILL.md').toString();
  assert.ok(manifest.resources.includes(languagePath));
  assert.match(skill, /先读再写/);
  assert.ok(skill.includes(`plugin_id:"${manifest.id}"`));
  assert.ok(skill.includes(`path:"${languagePath}"`));
  for (const path of manifest.resources) assert.ok(bytes(path).length > 0, path);
  for (const name of ['close-threshold', 'crossover']) for (const suffix of ['svl', 'replay']) {
    const path = `examples/${name}.${suffix}.json`;
    assert.ok(manifest.resources.includes(path), path); assert.ok(reference.includes(path), path);
  }
  const table = reference.split('## 当前全部原语')[1].split('参考求值器检查 cross')[0];
  for (const id of Object.keys(svl.OPERATORS)) assert.ok(table.includes('`' + id + '`'), `Documented operator: ${id}`);
  assert.deepEqual(json('tools.json'), JSON.parse(JSON.stringify(createTools({ tools: helpers }).map(({ execute, ...definition }) => definition))));
});

test('the stateful reference validates through the public tool and executes its stated four outcomes', async () => {
  const path = 'examples/close-threshold.svl.json', source = bytes(path).toString(), fixture = json('examples/close-threshold.replay.json');
  const checked = await validateTool(path), result = svl.evaluateReplay(source, fixture);
  assert.equal(checked.validationScope, 'svl-source-only'); assert.deepEqual(checked.diagnostics, []);
  assert.equal(checked.sourceDigest, result.sourceDigest); assert.equal(checked.graph.sourceDigest, result.sourceDigest);
  assert.equal(result.status, 'completed'); assert.deepEqual(result.events.map(event => event.state), [
    { lastClose: '0', lastAbove: false }, { lastClose: '99', lastAbove: false }, { lastClose: '101', lastAbove: true }, { lastClose: '100', lastAbove: false },
  ]);
  assert.ok(result.events.every(event => event.status === 'committed' && event.intents.length === 0));
  assert.deepEqual(result.events[0].trace.find(row => row.nodeId === 'above').value, { status: 'not_ready' });
  assert.equal(result.events[2].trace.find(row => row.nodeId === 'above').value, true);
  assert.equal(result.events[3].trace.find(row => row.nodeId === 'above').value, false, 'Equality is not strict greater-than');
  assert.deepEqual(svl.evaluateReplay(source, fixture), result);
});

test('the declared crossover example yields a typed intent and blocks missing or pending account evidence', async () => {
  const path = 'examples/crossover.svl.json', source = bytes(path).toString(), fixture = json('examples/crossover.replay.json');
  const checked = await validateTool(path), result = svl.evaluateReplay(source, fixture);
  assert.equal(checked.sourceDigest, result.sourceDigest); assert.equal(result.status, 'completed');
  assert.equal(result.events[0].intents.length, 1);
  const intent = result.events[0].intents[0];
  assert.equal(intent.kind, 'submit'); assert.equal(intent.side, 'buy'); assert.equal(intent.orderType, 'market');
  assert.deepEqual(intent.quantity, { value: '100', unit: 'share' }); assert.match(intent.intentId, /^sha256:[a-f0-9]{64}$/);
  const repeated = structuredClone(fixture); repeated.events.push(structuredClone(repeated.events[0]));
  assert.deepEqual(svl.evaluateReplay(source, repeated), result);
  const missing = structuredClone(fixture); delete missing.events[0].inputs.account.pendingIntents;
  assert.equal(svl.evaluateReplay(source, missing).events[0].intents.length, 0);
  const pending = structuredClone(fixture); pending.events[0].inputs.account.pendingIntents.push({ instrument: pending.parameters.instrument, runId: pending.runId, status: 'unknown' });
  assert.equal(svl.evaluateReplay(source, pending).events[0].intents.length, 0);
});

test('the state type repair addresses the actual object error without implying complete static type proof', async () => {
  const path = 'examples/close-threshold.svl.json', malformed = json(path);
  malformed.state.lastClose.type = 'decimal';
  await assert.rejects(validateTool(path, Buffer.from(JSON.stringify(malformed))), /must be an object/);
  malformed.state.lastClose.type = { kind: 'decimal' };
  assert.deepEqual((await validateTool(path, Buffer.from(JSON.stringify(malformed)))).diagnostics, []);
  const dynamicMismatch = json(path); dynamicMismatch.state.lastClose = { type: { kind: 'integer' }, initial: 0 };
  assert.throws(() => svl.validateSource(dynamicMismatch), /expects integer/);
  const dynamic = json(path);
  dynamic.nodes.find(node => node.id === 'remember-close').inputs.value = { input: 'bars', field: 'custom' };
  const fixture = json('examples/close-threshold.replay.json');
  assert.deepEqual(svl.validateSource(dynamic).diagnostics, []);
  fixture.events[1].inputs.bars[0].custom = false;
  const result = svl.evaluateReplay(dynamic, fixture);
  assert.equal(result.status, 'paused'); assert.deepEqual(result.events.at(-1).intents, []);
  assert.match(result.events.at(-1).error.message, /Decimal|decimal/);
});
