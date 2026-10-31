import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBoundaries, compareBoundary, applyConfigurationExtensions, boundaryReport, captureBoundaryCandidate, createBoundaryReview, applyApprovedBoundaryReview } from '../scripts/verify-plugin-boundaries.mjs';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('current scoped contracts keep every declared interface and pre-refactor path', () => {
  assert.deepEqual(checkBoundaries(), { packages: 24, declarations: 48, capabilities: 256 });
});

test('configuration rollout keeps the frozen baseline and rejects replacement or agent-facing extensions', () => {
  const original = { packages: [{ manifest: { id: 'test/source' }, declaration: {
    capabilities: [{ id: 'fetch', inputSchema: { type: 'object' }, consumers: ['agent', 'host'] }],
  }, paths: ['index.js'] }] };
  const extension = { plugins: [{ pluginId: 'test/source', configurationTitle: 'Source', fields: [{ id: 'token', binding: { type: 'capability', read: 'configuration.read', update: 'configuration.update' } }],
    requirements: { fetch: [{ field: 'token', reason: 'Source token' }] },
    capabilities: [{ id: 'configuration.read', kind: 'function', consumers: ['host'], execution: 'immediate' }],
  }] };
  const result = applyConfigurationExtensions(original, extension);
  assert.equal(original.packages[0].declaration.configuration, undefined);
  assert.equal(original.packages[0].declaration.capabilities.length, 1);
  assert.deepEqual(result.packages[0].declaration.capabilities[0].inputSchema, { type: 'object' });
  assert.throws(() => applyConfigurationExtensions(result, extension), /replace/);
  for (const mutate of [
    item => { item.pluginId = 'test/unknown'; },
    item => { item.capabilities[0].consumers = ['agent']; },
    item => { item.capabilities[0].id = 'fetch'; },
    item => { item.capabilities[0].id = 'submit-order'; },
    item => { item.requirements.fetch[0].field = 'undeclared'; },
    item => { item.manifest = { id: 'changed' }; },
  ]) {
    const changed = structuredClone(extension); mutate(changed.plugins[0]);
    assert.throws(() => applyConfigurationExtensions(original, changed));
  }
  assert.throws(() => applyConfigurationExtensions(original, { plugins: [{ pluginId: 'test/source', capabilities: extension.plugins[0].capabilities }] }), /Only new host configuration adapters/);
});

test('SemVer label drift is separate and never hides a changed contract', () => {
  const before = { manifest: { id: 'test/source', version: '1.0.0' }, declaration: { capabilities: [{ id: 'read', inputSchema: { type: 'object' } }] }, paths: ['index.js'] };
  const after = structuredClone(before); after.manifest.version = '9.0.0';
  assert.deepEqual(compareBoundary(before, after), [], 'a major label alone does not prove a breaking change');
  after.declaration.capabilities[0].inputSchema.type = 'string';
  assert.deepEqual(compareBoundary(before, after), ['capability:read'], 'even a major bump cannot approve a schema change');
  after.manifest.permissions = { scopes: ['plugins.manage'], calls: [] };
  assert.ok(compareBoundary(before, after).includes('plugin.json'), 'new permission requests remain an explicit contract review');
});

test('fixture scope reproduces without local plans and capture cannot overwrite evidence', t => {
  const root = mkdtempSync(join(tmpdir(), 'sesame-boundary-baseline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourcePath = 'plugins/api-v1/packages/example', directory = join(root, sourcePath);
  mkdirSync(directory, { recursive: true });
  const manifest = { id: 'fixture/example', version: '1.1.0' }, declaration = { capabilities: [] };
  writeFileSync(join(directory, 'plugin.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'capabilities.json'), JSON.stringify(declaration));
  const baseline = { schemaVersion: 1, packages: [{ sourcePath, manifest: { ...manifest, version: '1.0.0' }, declaration, paths: ['plugin.json', 'capabilities.json'] }] };
  const report = boundaryReport(root, baseline, { plugins: [] });
  assert.deepEqual(report.versions, [{ pluginId: 'fixture/example', before: '1.0.0', after: '1.1.0' }]);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(checkBoundaries(root, baseline, { plugins: [] }), { packages: 1, declarations: 2, capabilities: 0 });
  assert.equal(existsSync(join(root, '.omx')), false);
  const first = join(root, 'candidate-a.json'), second = join(root, 'candidate-b.json');
  captureBoundaryCandidate(first, root, baseline); captureBoundaryCandidate(second, root, baseline);
  assert.equal(readFileSync(first, 'utf8'), readFileSync(second, 'utf8'), 'candidate output is deterministic, without current timestamps');
  assert.throws(() => captureBoundaryCandidate(first, root, baseline), { code: 'EEXIST' });
  assert.throws(() => captureBoundaryCandidate(), /immutable/);
  assert.throws(() => captureBoundaryCandidate(join(root, 'bad.json'), root, { packages: [{ ...baseline.packages[0], sourcePath: '../outside' }] }), /Invalid baseline source path/);
  assert.equal(baseline.packages[0].manifest.version, '1.0.0');
  writeFileSync(join(directory, 'plugin.json'), JSON.stringify({ ...manifest, permissions: { scopes: ['plugins.manage'], calls: [] } }));
  writeFileSync(join(directory, 'capabilities.json'), JSON.stringify({ capabilities: [{ id: 'added', inputSchema: { type: 'object' } }] }));
  const review = createBoundaryReview(root, baseline, { plugins: [] }), failures = boundaryReport(root, baseline, { plugins: [] }).failures;
  assert.equal(review.status, 'pending-review');
  assert.ok(review.entries.every(entry => entry.decision === 'pending'));
  assert.deepEqual(review.entries.flatMap(entry => entry.deltas.map(delta => delta.impact)), ['authorization-restriction', 'additive-capability']);
  assert.throws(() => applyApprovedBoundaryReview(failures, review, review), /explicitly approved/);
  const approved = { ...structuredClone(review), status: 'approved' };
  for (const entry of approved.entries) { entry.decision = 'approved'; entry.reason = 'Fixture-only explicit review of the exact request and additive declaration.'; }
  assert.deepEqual(applyApprovedBoundaryReview(failures, review, approved), []);
  assert.deepEqual(checkBoundaries(root, baseline, { plugins: [] }, approved), { packages: 1, declarations: 2, capabilities: 0 });
  assert.equal(applyApprovedBoundaryReview(failures, review, { ...approved, entries: approved.entries.slice(1) }).length, 1, 'unreviewed deltas remain failures');
  for (const mutate of [
    value => { value.baselineDigest = 'sha256:other'; },
    value => { value.entries[0].afterDigest = 'sha256:other'; },
    value => { value.entries[0].beforeDigest = 'sha256:other'; },
    value => { value.entries[0].reason = ''; },
    value => { value.entries[0].decision = 'pending'; },
    value => { value.entries.push(value.entries[0]); },
  ]) { const changed = structuredClone(approved); mutate(changed); assert.throws(() => applyApprovedBoundaryReview(failures, review, changed), /approved|review/); }
  writeFileSync(join(directory, 'plugin.json'), JSON.stringify({ ...manifest, permissions: { scopes: ['process.execute'], calls: [] } }));
  assert.throws(() => checkBoundaries(root, baseline, { plugins: [] }, approved), /Stale/);
});

test('schema property names cannot disguise validation changes as documentation', t => {
  const root = mkdtempSync(join(tmpdir(), 'sesame-boundary-schema-impact-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourcePath = 'plugins/api-v1/packages/example', directory = join(root, sourcePath);
  mkdirSync(directory, { recursive: true });
  const manifest = { id: 'fixture/example', version: '1.0.0' };
  const capability = { id: 'read', description: 'Before', usage: { inputs: 'Before' }, inputSchema: {
    type: 'object', title: 'Before', properties: {
      title: { type: 'string', pattern: '.*', description: 'Before', examples: ['before'] },
      description: { type: 'string', minLength: 1 },
      examples: { type: 'string', maxLength: 20 },
      properties: { type: 'object', title: 'Before' },
    },
    $defs: { title: { type: 'string', pattern: '.*', description: 'Before' } },
  }, outputSchema: { type: 'object', properties: { title: { type: 'string', pattern: '.*', description: 'Before' } } } };
  const declaration = { capabilities: [capability], configSchema: { type: 'object', properties: { title: { type: 'string', pattern: '.*', description: 'Before' } } } };
  const changed = structuredClone(declaration), after = changed.capabilities[0];
  after.description = after.usage.inputs = after.inputSchema.title = 'After';
  after.inputSchema.properties.title.pattern = '^[A-Z]+$';
  after.inputSchema.properties.title.description = 'After';
  after.inputSchema.properties.title.examples = ['after'];
  after.inputSchema.properties.description.minLength = 2;
  after.inputSchema.properties.examples.maxLength = 10;
  after.inputSchema.properties.properties.title = 'After';
  after.inputSchema.$defs.title.pattern = '^[A-Z]+$';
  after.inputSchema.$defs.title.description = 'After';
  after.outputSchema.properties.title.pattern = '^[A-Z]+$';
  after.outputSchema.properties.title.description = 'After';
  changed.configSchema.properties.title.pattern = '^[A-Z]+$';
  changed.configSchema.properties.title.description = 'After';
  writeFileSync(join(directory, 'plugin.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'capabilities.json'), JSON.stringify(changed));
  const baseline = { schemaVersion: 1, packages: [{ sourcePath, manifest, declaration, paths: ['plugin.json', 'capabilities.json'] }] };
  const review = createBoundaryReview(root, baseline, { plugins: [] });
  const deltas = new Map(review.entries.find(entry => entry.component === 'capability:read').deltas.map(delta => [delta.path, delta.impact]));
  assert.equal(deltas.get('/inputSchema/properties/title/pattern'), 'input-contract-review');
  assert.equal(deltas.get('/inputSchema/properties/description/minLength'), 'breaking-input-restriction');
  assert.equal(deltas.get('/inputSchema/properties/examples/maxLength'), 'breaking-input-restriction');
  assert.equal(deltas.get('/inputSchema/$defs/title/pattern'), 'input-contract-review');
  assert.equal(deltas.get('/outputSchema/properties/title/pattern'), 'output-contract-review');
  for (const path of ['/description', '/usage/inputs', '/inputSchema/title', '/inputSchema/properties/title/description', '/inputSchema/properties/title/examples', '/inputSchema/properties/properties/title', '/inputSchema/$defs/title/description', '/outputSchema/properties/title/description']) assert.equal(deltas.get(path), 'documentation', path);
  const configuration = new Map(review.entries.find(entry => entry.component === 'capabilities.json/configSchema').deltas.map(delta => [delta.path, delta.impact]));
  assert.equal(configuration.get('/properties/title/pattern'), 'declaration-contract-review');
  assert.equal(configuration.get('/properties/title/description'), 'documentation');
});

test('review identifies actual conditional and numeric drawing input restrictions separately from additions', () => {
  const review = createBoundaryReview();
  const drawing = review.entries.find(entry => entry.pluginId === 'sesame/canvas-control' && entry.component === 'capability:chart_drawing');
  assert.deepEqual(drawing.findings.map(finding => [finding.discriminator.action, finding.addedRequired]), [['remove', ['expected_attachment']], ['put', ['expected_attachment']]]);
  assert.ok(drawing.findings.every(finding => finding.impact === 'breaking-conditional-input'));
  const indicator = review.entries.find(entry => entry.pluginId === 'sesame/canvas-control' && entry.component === 'capability:indicator_publish');
  assert.ok(indicator.deltas.some(delta => delta.path.endsWith('/lookback/maximum') && delta.before === 50000 && delta.after === 20000 && delta.impact === 'breaking-input-restriction'));
  const recovery = review.entries.find(entry => entry.pluginId === 'sesame/canvas-control' && entry.component === 'capability:canvas_recover_source');
  assert.equal(recovery.deltas[0].impact, 'additive-capability');
});

test('boundary comparison catches schema, authorization, contribution and source-path drift', () => {
  const before = { manifest: { id: 'test/source', entry: 'index.js' }, declaration: {
    capabilities: [{ id: 'read', inputSchema: { type: 'object' }, effects: ['source.read'], consumers: ['main'], configurationRequirements: [{ field: 'token' }] }],
    sources: [{ id: 'market', operations: { query: 'read' } }],
  }, paths: ['index.js', 'worker.py', 'skills/use/SKILL.md'] };
  for (const mutate of [
    value => { value.manifest.id = 'test/other'; },
    value => { value.declaration.capabilities[0].inputSchema.type = 'string'; },
    value => { value.declaration.capabilities[0].effects = []; },
    value => { value.declaration.capabilities[0].consumers.push('subagent'); },
    value => { value.declaration.capabilities[0].configurationRequirements = []; },
    value => { value.declaration.sources[0].operations.query = 'other'; },
    value => { value.paths.pop(); },
  ]) {
    const after = structuredClone(before); mutate(after);
    assert.ok(compareBoundary(before, after).length > 0);
  }
  const addition = structuredClone(before); addition.paths.push('market.js');
  assert.deepEqual(compareBoundary(before, addition), [], 'internal module additions preserve old entry paths');
});
