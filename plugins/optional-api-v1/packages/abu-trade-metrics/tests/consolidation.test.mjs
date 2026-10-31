// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { analyze as audit } from '../scripts/audit.mjs';
import { createCapabilities } from '../index.js';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const golden = await read('./fixtures/audit-golden.json');

test('merged audit retains the original numerical implementation and seven distinct evidence cases', async () => {
  const source = await readFile(new URL('../scripts/audit.mjs', import.meta.url));
  assert.equal('sha256:' + createHash('sha256').update(source).digest('hex'), golden.origin.sourceSha256);
  assert.equal(golden.origin.synthetic, true); assert.equal(golden.cases.length, 7);
  for (const item of golden.cases) assert.deepEqual(audit(structuredClone(item.input)), item.expected, item.name);
});

test('performance and audit use independent inputs and publish only their own evidence through the actual factory', async () => {
  let sequence = 0; const created = new Map(), published = new Map();
  const host = { resources: {
    async read() { throw new Error('Input-only calculation must not dereference supplied refs'); },
    async create(spec) { const ref = { id: `temporary-${++sequence}`, version: 1 }; created.set(ref.id, JSON.parse(spec.source.content)); return ref; },
    async publish(source, manifest) { const ref = { id: `artifact-${++sequence}`, revision: 'fixed', digest: `sha256:${'a'.repeat(64)}`, kind: 'data', schemaVersion: '1.0.0' }; published.set(ref.id, { rows: created.get(source.id), manifest }); return { ref }; },
    async remove(ref) { assert.ok(created.has(ref.id), 'Only newly created temporary resources may be cleaned'); created.delete(ref.id); },
  } };
  const tools = createCapabilities(host), declaration = await read('../capabilities.json');
  assert.deepEqual(tools.map(tool => tool.name), ['abu_trade_metrics_analyze', 'abu_trade_results_audit']);
  assert.ok(!tools.some(tool => tool.name === 'abu_backtest_lab_analyze'));
  for (const capability of declaration.capabilities) assert.deepEqual(capability.researchDataAccess, { schemaVersion: 1, reads: 'input-only', writes: 'derived-artifacts-only' });
  for (const [index, file] of ['input.json', 'audit-input.json'].entries()) {
    const input = await read(`../examples/${file}`); input.source.unresolved_ref = { id: 'do-not-read', path: '/unavailable/user-file' };
    if (index === 1) { delete input.bars; assert.equal(input.equity_curve, undefined); }
    const result = await tools[index].execute({ input });
    assert.deepEqual(published.get(result.input_artifact.id).rows, [{ input }]);
    assert.deepEqual(published.get(result.result_artifact.id).manifest.dependencies, [result.input_artifact]);
    assert.equal(published.get(result.result_artifact.id).manifest.content.provenance.plugin_id, 'sesame/abu-trade-metrics');
    assert.equal(published.get(result.result_artifact.id).manifest.content.provenance.kind, 'demo');
    if (index === 0) { assert.ok(Math.abs(result.observations.equity.total_return - .04) < 1e-12); assert.equal(result.observations.audit, undefined); }
    else { assert.equal(result.observations.audit.issue_count, 0); assert.equal(result.observations.equity, undefined); }
  }
  assert.equal(created.size, 0); assert.equal(published.size, 4);
});
