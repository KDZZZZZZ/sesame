import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, PROTOCOL } from '../evaluator.js';
const iso = n => new Date(Date.UTC(2024, 0, n)).toISOString();
const rows = Array.from({ length: 13 }, (_, day) => Array.from({ length: 4 }, (_, i) => ({ time: iso(day + 1), availableAt: iso(day + 1), symbol: `S${i}`, fields: { close: 100 * (1 + i / 100) ** day, signal: i } }))).flat();
const options = { dataset: { trainEnd: iso(5), validationEnd: iso(9), holdoutEnd: iso(13) } };
const candidate = { op: 'field', name: 'signal' };
function fixture() {
  const db = new Map(), resources = new Map(); let chain = [{ pluginId: 'custom/workflow', capabilityId: 'launch' }, { pluginId: 'sesame/factor-evaluator', capabilityId: 'factor_evaluate' }];
  const host = { context: { pluginId: 'sesame/factor-evaluator', kind: 'main', sessionId: 'owner' },
    data: { sources: () => ({ items: [{ ref: { providerId: 'host#datasets', revision: 'host:2' }, contract: 'sesame.datasets/1', operations: { query: 'query' }, available: true }] }), query: async () => ({ items: rows, metadata: { id: 'data', provenance: { kind: 'synthetic' } } }) },
    state: { read({ collection, key }) { const record = db.get(`${collection}:${key}`); if (!record) throw Object.assign(Error('missing'), { code: 'NOT_FOUND' }); return structuredClone(record); },
      async commit(changes) { const entries = changes.map(change => { const key = `${change.key.collection}:${change.key.key}`, previous = db.get(key); assert.equal(change.expectedVersion, previous?.version ?? 0); const next = { key: change.key, value: structuredClone(change.value), version: (previous?.version ?? 0) + 1 }; db.set(key, next); return next; }); return { entries }; } },
    resources: { async create({ kind, source }) { const ref = { id: `resource-${resources.size}`, kind, version: 1 }; resources.set(ref.id, source.content); return ref; },
      async read(ref, { offset = 0, length = 256 * 1024 }) { const content = Buffer.from(resources.get(ref.id)); return { content: content.subarray(offset, offset + length).toString('base64'), total: content.length, ...(offset + length < content.length ? { nextOffset: offset + length } : {}) }; } } };
  const call = (action, more = {}) => evaluate(host, { protocol: PROTOCOL, action, run_id: 'run', ...more }, undefined, { provenance: { chain, caller: { pluginId: chain.at(-2)?.pluginId }, parentRunId: null } });
  return { host, call, db, chain: value => { chain = value; } };
}
test('separate evaluator produces real immutable candidate, selection and final receipts', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  assert.ok(prepared.development.rows.every(row => row.time <= iso(9)));
  const session_id = prepared.sessionId;
  await assert.rejects(f.call('finalize', { session_id }), /frozen selection/);
  const measured = await f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] });
  assert.equal(measured.metrics.validation.rankIC, 1); assert.equal(measured.eligible, true);
  assert.deepEqual(await f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] }), measured);
  await assert.rejects(f.call('candidate', { session_id, trial_id: 'one', candidate: { op: 'constant', value: 1 }, accepted_ids: [] }), /frozen/);
  const selection = await f.call('select', { session_id, trial_ids: ['one'] });
  const final = await f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.equal(final.holdout.one.rankIC, 1); assert.equal(final.holdoutStatus, 'evaluated');
  await assert.rejects(f.call('candidate', { session_id, trial_id: 'two', candidate, accepted_ids: [] }), /frozen/);
});
test('direct calls and other caller plugins cannot read a workflow session', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  f.chain([{ pluginId: 'sesame/factor-evaluator', toolName: 'factor_evaluate' }]);
  await assert.rejects(f.call('finalize', { session_id: prepared.sessionId }), /nested workflow/);
  f.chain([{ pluginId: 'other/workflow', toolName: 'anything' }, { pluginId: 'sesame/factor-evaluator', toolName: 'factor_evaluate' }]);
  await assert.rejects(f.call('candidate', { session_id: prepared.sessionId, trial_id: 'one', candidate, accepted_ids: [] }), /another workflow/);
});

test('workflow sessions follow the trusted original owner across resumed execution sessions', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  const request = { protocol: PROTOCOL, action: 'candidate', run_id: 'run', session_id: prepared.sessionId, trial_id: 'one', candidate, accepted_ids: [] };
  f.host.context = { ...f.host.context, kind: 'subagent', sessionId: 'workflow-session-1', runId: 'workflow-run-1' };
  const execution = { provenance: { caller: { pluginId: 'custom/workflow', runId: 'workflow-run-1' },
    chain: [{ pluginId: 'custom/workflow' }, { pluginId: 'sesame/factor-evaluator' }],
    workflow: { runId: 'workflow-run-1', sessionId: 'workflow-session-1', ownerSessionId: 'owner' } } };
  const first = await evaluate(f.host, request, undefined, execution);
  assert.equal(first.metrics.validation.rankIC, 1);
  const forged = structuredClone(execution); forged.provenance.workflow.ownerSessionId = 'unrelated-owner';
  await assert.rejects(evaluate(f.host, { ...request, ownerSessionId: 'owner' }, undefined, forged), /another workflow owner/);
  f.host.context = { ...f.host.context, sessionId: 'workflow-session-2', runId: 'workflow-run-2' };
  execution.provenance.caller.runId = 'workflow-run-2';
  execution.provenance.workflow = { runId: 'workflow-run-2', sessionId: 'workflow-session-2', ownerSessionId: 'owner' };
  assert.deepEqual(await evaluate(f.host, request, undefined, execution), first);
});
test('general research tools use genuine development-only input with no holdout claim', async () => {
  const f = fixture();
  await assert.rejects(f.call('prepare', { dataset_id: 'data', access: 'development-only', options }), /after validationEnd/);
  f.host.data.query = async () => ({ items: rows.filter(row => row.time <= iso(9)), metadata: { id: 'data' } });
  const prepared = await f.call('prepare', { dataset_id: 'data', access: 'development-only', options });
  assert.equal(prepared.data.holdoutMode, 'none'); assert.equal(prepared.development.summary.holdoutSealed, false);
  const session_id = prepared.sessionId;
  assert.equal((await f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] })).metrics.validation.rankIC, 1);
  const selection = await f.call('select', { session_id, trial_ids: ['one'] });
  const final = await f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.deepEqual(final.holdout, {}); assert.equal(final.holdoutStatus, 'not-requested');
});

test('parallel candidates keep both receipts without losing state or bypassing CAS', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  const session_id = prepared.sessionId;
  const [positive, negative] = await Promise.all([
    f.call('candidate', { session_id, trial_id: 'positive', candidate, accepted_ids: [] }),
    f.call('candidate', { session_id, trial_id: 'negative', candidate: { op: 'neg', args: [candidate] }, accepted_ids: [] }),
  ]);
  assert.equal(positive.metrics.validation.rankIC, 1); assert.equal(negative.metrics.validation.rankIC, -1);
  assert.deepEqual(Object.keys(f.db.get(`sessions:${session_id}`).value.refs.candidates).sort(), ['negative', 'positive']);
  assert.deepEqual(await f.call('candidate', { session_id, trial_id: 'positive', candidate, accepted_ids: [] }), positive);
});
