import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveReport } from '../archive.js';
import { MiningRuntime } from '../runtime.js';

const inputRef = { id: 'artifact_sealed_panel', revision: 'revision_frozen', digest: `sha256:${'a'.repeat(64)}`, kind: 'data', schemaVersion: '1.0.0' };
const source = () => ({
  id: 'factor_lineage', title: 'Fixed panel', goal: 'Verify input ownership', status: 'completed',
  config: { evaluator: { plugin_id: 'sesame/factor-evaluator', tool: 'factor_evaluate', arguments: { inputRef, minCoverage: .6 } } },
  data: { sourceId: inputRef.id, digest: 'sha256:input', inputRefs: [inputRef], synthetic: false, holdoutMode: 'workflow-isolated',
    provenance: { kind: 'derived', references: [inputRef], evidence: { path: 'private/full-panel.json' } }, dependencies: [inputRef], rowCount: 52 },
  evaluation: { contract: { instructions: 'Use the supplied development rows', candidateExample: { op: 'field', name: 'close' } } },
  tasks: [], trials: [], memory: [], reflections: [], events: [],
});

test('published factor report declares the exact frozen input as data and provenance dependency', async () => {
  const run = source(), original = structuredClone(run), published = [];
  let serial = 0;
  const host = { resources: {
    create: async spec => ({ id: `resource_${++serial}`, kind: spec.kind, version: 1 }),
    publish: async (_resource, manifest) => { published.push(manifest); return { ref: { kind: 'report', id: 'report_1' }, receipt: {} }; },
  } };
  await archiveReport(host, run, { rows: [] });
  assert.equal(published.length, 1);
  assert.deepEqual(published[0].dependencies, [inputRef]);
  assert.deepEqual(published[0].content.provenance.references, [inputRef]);
  assert.deepEqual(published[0].content.data, [{ id: 'input-1', ref: inputRef, usage: 'Frozen factor evaluation input' }]);
  assert.deepEqual(run, original);
});

test('registered datasets without an artifact input retain an empty dependency list', async () => {
  const run = source(); delete run.data.inputRefs;
  let manifest;
  const host = { resources: {
    create: async spec => ({ id: 'resource', kind: spec.kind, version: 1 }),
    publish: async (_resource, value) => { manifest = value; return { ref: { kind: 'report', id: 'report_1' }, receipt: {} }; },
  } };
  await archiveReport(host, run, { rows: [] });
  assert.deepEqual(manifest.dependencies, []);
  assert.deepEqual(manifest.content.data, []);
});

function context(run, task, section) {
  const development = { rows: [{ time: '2024-01-01T00:00:00Z', fields: { close: 100 } }] };
  const subject = { authorize: () => ({ run, task }), checkpoints: { dataset: () => ({ development }) }, dataset: () => development };
  return MiningRuntime.prototype.context.call(subject, {}, run.id, section);
}

test('restricted role contexts expose development evidence without resolvable full-input references', () => {
  const run = source(), original = structuredClone(run);
  for (const section of ['data', 'team', 'memory']) {
    const value = context(run, { id: 'role_1', role: 'coder', mode: 'code' }, section);
    assert.doesNotMatch(JSON.stringify(value), /artifact_sealed_panel|revision_frozen|private\/full-panel/);
    assert.equal(value.data.digest, run.data.digest);
    assert.equal(value.data.rowCount, 52);
    assert.equal(value.config.evaluator.plugin_id, 'sesame/factor-evaluator');
    assert.equal(value.evaluator.instructions, run.evaluation.contract.instructions);
    if (section === 'data') assert.equal(value.rows.items.length, 1);
  }
  assert.deepEqual(run, original, 'Projection must not mutate the frozen controller record');
});

test('owner and development-only contexts keep provenance for legitimate reproduction', () => {
  const run = source();
  const owner = context(run, null, 'data');
  assert.deepEqual(owner.data.inputRefs, [inputRef]);
  assert.deepEqual(owner.config.evaluator.arguments.inputRef, inputRef);
  run.data.holdoutMode = 'none';
  const role = context(run, { id: 'role_1', role: 'coder', mode: 'code' }, 'data');
  assert.deepEqual(role.data.provenance, run.data.provenance);
  assert.deepEqual(role.config.evaluator.arguments.inputRef, inputRef);
});
