import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildLock } from '../scripts/plugin-lock.mjs';

function fixture(t, binding, servers = { [String(binding?.server)]: { command: 'not-executed' } }) {
  const source = mkdtempSync(join(tmpdir(), 'sesame-capability-binding-'));
  t.after(() => {
    assert.equal(dirname(resolve(source)), resolve(tmpdir()));
    rmSync(source, { recursive: true, force: true });
  });
  const directory = join(source, 'packages/example'); mkdirSync(directory, { recursive: true });
  const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n');
  save('plugin.json', { id: 'sesame/example', apiVersion: '2', version: '1.0.0', license: 'MIT', default_state: 'discoverable',
    execution: binding?.type === 'mcp' ? 'mcp' : 'native', entry: 'index.js', capability_manifest: 'capabilities.json', prompts: [], resources: [] });
  save('package.json', { name: '@sesame/plugin-example', version: '1.0.0', type: 'module', license: 'MIT' });
  const capability = { id: 'fixture.read', kind: 'function', execution: 'immediate', description: 'Read the fixture.',
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, consumers: ['agent', 'host'], effects: [], binding,
    usage: { purpose: 'Read the fixture.', inputs: 'An empty object.', outputs: 'The fixture value.', prerequisites: [], limitations: [] } };
  if (binding?.type === 'agent') Object.assign(capability, { kind: 'agent', execution: 'run', instructions: 'Use the declared capabilities to answer the objective.',
    objective: 'Return the fixture value.', allowedCalls: [] });
  if (binding?.type === 'graph') Object.assign(capability, { kind: 'workflow', execution: 'run' });
  save('capabilities.json', { schemaVersion: 1, apiVersion: '2', configSchema: {}, capabilities: [capability],
    sources: [], views: [], services: [], knowledge: [], hooks: [], stateCollections: [], artifactSchemas: [] });
  // Even malformed server keys exist in this fixture, so the ID gate is tested
  // independently from the existing declared-server lookup.
  save('mcp.json', { mcpServers: servers });
  writeFileSync(join(directory, 'LICENSE'), 'Fixture license\n');
  writeFileSync(join(directory, 'index.js'), 'throw new Error("Static validation must not execute candidate code");\n');
  return source;
}

for (const [name, binding] of [
  ['absent', undefined], ['null', null], ['array', []], ['string', 'native'],
]) test(`API 2 rejects ${name} capability binding`, t => {
  assert.throws(() => buildLock(fixture(t, binding)), /binding must be an object/);
});

for (const [name, binding] of [['missing', {}], ['unknown', { type: 'other' }]]) test(`API 2 rejects ${name} binding type`, t => {
  assert.throws(() => buildLock(fixture(t, binding)), /unsupported binding type/);
});

for (const type of ['native', 'mcp']) {
  for (const [label, name] of [['missing', undefined], ['empty', ''], ['non-string', 7], ['invalid character', 'bad/name'], ['invalid first character', '_read'], ['overlong', 'a'.repeat(129)]]) {
    test(`API 2 rejects ${type} binding with ${label} name`, t => {
      assert.throws(() => buildLock(fixture(t, { type, name, server: 'fixture' })), /binding name must be a valid local ID/);
    });
  }
}

test('API 2 native binding requires name, not an export field', t => {
  assert.throws(() => buildLock(fixture(t, { type: 'native', export: 'read' })), /binding name must be a valid local ID/);
});

for (const [label, server] of [['missing', undefined], ['empty', ''], ['non-string', 7], ['invalid character', 'bad/server'], ['invalid first character', '_fixture'], ['overlong', 'a'.repeat(129)]]) {
  test(`API 2 rejects MCP binding with ${label} server`, t => {
    assert.throws(() => buildLock(fixture(t, { type: 'mcp', name: 'read', server })), /binding server must be a valid local ID/);
  });
}

test('API 2 accepts the host local-ID boundaries for native and MCP bindings', t => {
  for (const type of ['native', 'mcp']) for (const name of ['0', 'Read_01.v2-end', 'a'.repeat(128)]) {
    assert.equal(buildLock(fixture(t, { type, name, server: name })).apiVersion, '2');
  }
});

test('API 2 MCP server must be declared as an own property, not inherited from Object.prototype', t => {
  assert.throws(() => buildLock(fixture(t, { type: 'mcp', name: 'read', server: 'constructor' }, {})), /undeclared MCP server binding/);
});

test('API 2 static binding types retain agent and graph for host validation', t => {
  const graph = { mode: 'dag', nodes: [{ id: 'read', capability: 'host.read', input: {} }], edges: [{ from: 'START', to: 'read' }, { from: 'read', to: 'END' }] };
  for (const binding of [{ type: 'agent' }, { type: 'graph', graph }]) assert.equal(buildLock(fixture(t, binding)).apiVersion, '2');
});
