import test from 'node:test';
import assert from 'node:assert/strict';
import { hasResearchDataAccess, resolveResearch, verifyResearch } from '../composition.js';

const contract = () => ({ schemaVersion: 1, reads: 'input-only', writes: 'none' });
const calculation = () => ({ id: 'calculate', kind: 'function', consumers: ['agent', 'host'], execution: 'immediate',
  binding: { type: 'native', name: 'calculate' }, effects: [], researchDataAccess: contract() });
const fixture = (capability = calculation(), extra = {}) => {
  const manifest = { id: 'test/method', version: '1', revision: 'sha256:fixed', capabilities: [capability],
    sources: [], services: [], hooks: [], stateCollections: [], ...extra };
  const host = { plugins: { read: (_id, { part }) => part === 'manifest' ? structuredClone(manifest) :
    { state: 'mounted', runtime_status: 'ready', agent_scope: 'all' } } };
  return { manifest, host, resolve: () => resolveResearch(host, { plugins: [manifest.id] }) };
};

test('an explicit native input-only calculation composes without cancelling holdout isolation', () => {
  for (const effects of [[], ['resources.create', 'resources.publish']]) {
    const tool = calculation(); tool.effects = effects;
    if (effects.length) tool.researchDataAccess.writes = 'derived-artifacts-only';
    const f = fixture(tool), selected = f.resolve();
    assert.equal(hasResearchDataAccess(selected), false);
    assert.deepEqual(selected.inputOnlyTools, ['test/method#calculate']);
    assert.equal(verifyResearch(f.host, selected), undefined);
  }
});

test('missing, unknown or contradictory declarations remain general research tools', () => {
  const mutations = [
    tool => { delete tool.researchDataAccess; },
    tool => { tool.researchDataAccess.schemaVersion = 2; },
    tool => { tool.researchDataAccess.reads = 'artifact-refs'; },
    tool => { tool.researchDataAccess.writes = 'workspace'; },
    tool => { tool.researchDataAccess.unknown = true; },
    tool => { tool.effects = ['resources.create']; },
    ...['read', 'resources.read', 'data.read', 'artifact.read', 'state.read', 'filesystem', 'network', 'process',
      'declared-calls', 'execution', 'model', 'unknown-effect', 'resources.remove', 'resources.write'].map(effect => tool => {
      tool.researchDataAccess.writes = 'derived-artifacts-only'; tool.effects = [effect];
    }),
    ...['mcp', 'agent', 'graph'].map(type => tool => { tool.binding.type = type; }),
    tool => { tool.kind = 'workflow'; },
    tool => { tool.execution = 'run'; },
    tool => { tool.transport = 'subscription'; },
    tool => { tool.requires = [{ id: 'source', capability: 'test/data#read', input: { ref: { $ref: 'input#/ref' } }, reason: 'read data' }]; },
    tool => { tool.allowedCalls = [{ pluginId: 'test/data', capabilityId: 'read' }]; },
    tool => { tool.collaboration = { agents: [{ id: 'reader' }] }; },
  ];
  for (const mutate of mutations) {
    const tool = calculation(); mutate(tool);
    assert.equal(hasResearchDataAccess(fixture(tool).resolve()), true, JSON.stringify(tool));
  }
});

test('activation hooks and data providers or state invalidate the input-only declaration', () => {
  for (const key of ['hooks', 'sources', 'services', 'stateCollections']) {
    assert.equal(hasResearchDataAccess(fixture(calculation(), { [key]: [{ id: 'data-reader' }] }).resolve()), true, key);
    assert.equal(hasResearchDataAccess(fixture(calculation(), { [key]: 'unknown' }).resolve()), true, key);
    const f = fixture(calculation(), { [key]: [{ id: 'data-reader' }] });
    assert.equal(hasResearchDataAccess(resolveResearch(f.host, { plugins: ['test/method'], tools: [] })), key === 'hooks', `${key} without selected tools`);
    f.manifest.capabilities = [];
    assert.equal(hasResearchDataAccess(f.resolve()), key === 'hooks', `${key} without capabilities`);
  }
});

test('selected capabilities determine access, with no plugin-name or empty-effects exemption', () => {
  const reader = { ...calculation(), id: 'read', binding: { type: 'native', name: 'read' }, effects: ['data.read'] };
  const f = fixture(calculation()); f.manifest.capabilities.push(reader);
  assert.equal(hasResearchDataAccess(f.resolve()), true);
  assert.equal(hasResearchDataAccess(resolveResearch(f.host, { plugins: ['test/method'], tools: ['test/method#calculate'] })), false);
  assert.equal(hasResearchDataAccess(resolveResearch(f.host, { plugins: ['test/method'], tools: [] })), false);
  assert.throws(() => resolveResearch(f.host, { plugins: ['test/method'], inputOnlyTools: ['test/method#read'] }), { code: 'INVALID_ARGUMENT' });
});

test('frozen access declarations and implementation digests cannot change on resume', () => {
  for (const change of [
    manifest => { manifest.revision = 'sha256:new-implementation'; },
    manifest => { manifest.capabilities[0].researchDataAccess.reads = 'artifact-refs'; manifest.revision = 'sha256:new-declaration'; },
    manifest => { manifest.capabilities[0].effects = ['data.read']; },
  ]) {
    const f = fixture(), frozen = f.resolve(); change(f.manifest);
    assert.throws(() => verifyResearch(f.host, frozen), { code: 'RESEARCH_PLUGIN_CHANGED' });
  }
  const f = fixture(), old = f.resolve(); delete old.inputOnlyTools;
  assert.equal(hasResearchDataAccess(old), true, 'A previously general research run is never upgraded in place');
  assert.throws(() => verifyResearch(f.host, old), { code: 'RESEARCH_PLUGIN_CHANGED' });
});
