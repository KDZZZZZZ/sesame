import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, PROTOCOL } from '../evaluator.js';
const iso = n => new Date(Date.UTC(2024, 0, n)).toISOString();
const rows = Array.from({ length: 13 }, (_, day) => Array.from({ length: 4 }, (_, i) => ({ time: iso(day + 1), availableAt: iso(day + 1), symbol: `S${i}`, fields: { close: 100 * (1 + i / 100) ** day, signal: i } }))).flat();
const options = { dataset: { trainEnd: iso(5), validationEnd: iso(9), holdoutEnd: iso(13) } };
const candidate = { op: 'field', name: 'signal' };
function fixture() {
  const db = new Map(); let chain = [{ pluginId: 'custom/workflow', toolName: 'launch' }, { pluginId: 'sesame/factor-evaluator', toolName: 'factor_evaluate' }];
  const host = { plugin: { id: 'sesame/factor-evaluator' }, scope: { kind: 'main', conversationId: 'owner' }, tools: { invocation: () => ({ chain }) },
    datasets: { read: () => ({ rows, provenance: { kind: 'synthetic' } }) },
    storage: { get(c, id, optional) { const v = db.get(`${c}:${id}`); if (!v && !optional) throw new Error('missing'); return v ? structuredClone(v) : null; }, put(c, v) { db.set(`${c}:${v.id}`, structuredClone(v)); return v; } } };
  const call = (action, more = {}) => evaluate(host, { protocol: PROTOCOL, action, run_id: 'run', ...more });
  return { host, call, db, chain: value => { chain = value; } };
}
test('separate evaluator produces real immutable candidate, selection and final receipts', () => {
  const f = fixture(), prepared = f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  assert.ok(prepared.development.rows.every(row => row.time <= iso(9)));
  const session_id = prepared.sessionId;
  assert.throws(() => f.call('finalize', { session_id }), /frozen selection/);
  const measured = f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] });
  assert.equal(measured.metrics.validation.rankIC, 1); assert.equal(measured.eligible, true);
  assert.deepEqual(f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] }), measured);
  assert.throws(() => f.call('candidate', { session_id, trial_id: 'one', candidate: { op: 'constant', value: 1 }, accepted_ids: [] }), /frozen/);
  const selection = f.call('select', { session_id, trial_ids: ['one'] });
  const final = f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.equal(final.holdout.one.rankIC, 1); assert.equal(final.holdoutStatus, 'evaluated');
  assert.throws(() => f.call('candidate', { session_id, trial_id: 'two', candidate, accepted_ids: [] }), /frozen/);
});
test('direct calls and other caller plugins cannot read a workflow session', () => {
  const f = fixture(), prepared = f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  f.chain([{ pluginId: 'sesame/factor-evaluator', toolName: 'factor_evaluate' }]);
  assert.throws(() => f.call('finalize', { session_id: prepared.sessionId }), /nested workflow/);
  f.chain([{ pluginId: 'other/workflow', toolName: 'anything' }, { pluginId: 'sesame/factor-evaluator', toolName: 'factor_evaluate' }]);
  assert.throws(() => f.call('candidate', { session_id: prepared.sessionId, trial_id: 'one', candidate, accepted_ids: [] }), /another workflow/);
});
test('general research tools use genuine development-only input with no holdout claim', () => {
  const f = fixture();
  assert.throws(() => f.call('prepare', { dataset_id: 'data', access: 'development-only', options }), /after validationEnd/);
  f.host.datasets.read = () => ({ rows: rows.filter(row => row.time <= iso(9)) });
  const prepared = f.call('prepare', { dataset_id: 'data', access: 'development-only', options });
  assert.equal(prepared.data.holdoutMode, 'none'); assert.equal(prepared.development.summary.holdoutSealed, false);
  const session_id = prepared.sessionId;
  assert.equal(f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] }).metrics.validation.rankIC, 1);
  const selection = f.call('select', { session_id, trial_ids: ['one'] });
  const final = f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.deepEqual(final.holdout, {}); assert.equal(final.holdoutStatus, 'not-requested');
});
