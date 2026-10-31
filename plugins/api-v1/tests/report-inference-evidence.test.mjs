import test from 'node:test';
import assert from 'node:assert/strict';
import { bindResults, resolveStructure } from '../packages/reports/report-structure.js';
import { reportCompositionCapabilities } from '../packages/reports/report-compose.js';

// Synthetic contract fixtures only; these references are not published artifacts.
const ref = id => ({ id, revision: 'fixture-r1', digest: `sha256:${'b'.repeat(64)}`, kind: 'data', schemaVersion: '1.0.0' });
const historyRefs = ['cohort', 'baseline', 'primary-search'].map(ref);
const history = () => ({
  scenario: 'COHORT_ONLY_SENTINEL', matching_method_ref: 'fixture/matching@1', target: 'Fixture outcome', horizon: 'One observation',
  window: { start: '2026-10-01', end: '2026-10-10', as_of: '2026-10-11' },
  sampling: { policy: 'same_instrument_recent_first', subject: 'FIXTURE', recent_window: { start: '2026-10-01', end: '2026-10-10' }, primary_search: { status: 'matched', eligible_count: 8, ref: historyRefs[2] }, selected_scope: 'same_instrument_recent', instruments: ['FIXTURE'] },
  sample: { matched: 8, resolved: 8, pending: 0, excluded: 0 }, outcomes: [{ label: 'A', count: 5 }, { label: 'B', count: 3 }], refs: [historyRefs[0]],
  baseline: { status: 'provided', description: 'Independent fixture baseline', ref: historyRefs[1] }, dependence: 'Fixture observations do not overlap.', uncertainty: 'No population inference is supplied.', limitations: ['Synthetic input-contract fixture.'],
});
function claim(status = 'provided') {
  const value = {
    id: 'claim-a', claim: 'Supplied fixture judgment', status, method_ref: 'fixture/judgment@1',
    historical_basis: history(), validation: { status: 'historical_exploration' },
    reasoning: { observations: ['The supplied comparison contains eight resolved observations.'], steps: ['Keep this comparison separate from the current judgment.'], conclusion: 'The method result determines the judgment.', history: { status: 'linked', note: 'A supplied comparison is available.' } },
  };
  if (status === 'provided') value.confidence = { estimate: 0.625, definition: 'Supplied fixture proportion' };
  else value.reason = 'The current judgment is not yet available.';
  return value;
}
const structure = historyDisplay => ({ sections: [{ id: 'review', title: 'Review', fields: [{ key: 'claims', label: 'Claims', type: 'inferences', meaning: 'Independent supplied claims', ...(historyDisplay ? { history_display: historyDisplay } : {}) }] }] });
const row = claims => ({ section_id: 'review', field: 'claims', value: claims });
function harness(rows, available = historyRefs, manifestOverrides = {}) {
  const reads = [], writes = [], source = Buffer.from(JSON.stringify(rows));
  const known = new Set(['results', ...available.map(item => item.id)]);
  const host = {
    resources: { read: async (item, options) => {
      if (options.part === 'manifest') {
        reads.push(item.id);
        if (!known.has(item.id)) throw new Error(`Missing artifact: ${item.id}`);
        return { content: { format: 'json-rows', path: 'rows.json', provenance: { kind: 'derived' }, ...manifestOverrides[item.id] } };
      }
      assert.equal(item.id, 'results');
      const chunk = source.subarray(options.offset, options.offset + options.length);
      return { content: chunk.toString('base64'), total: source.length, ...(options.offset + chunk.length < source.length ? { nextOffset: options.offset + chunk.length } : {}) };
    } },
    capabilities: { invoke: async (id, args) => {
      assert.equal(id, 'sesame/workspace#write', 'No analysis or model capability may execute');
      writes.push(args); return { type: 'result', value: { path: args.path } };
    } },
  };
  const execute = reportCompositionCapabilities(host).find(capability => capability.name === 'report_compose').execute;
  return { reads, writes, compose: (selected = structure()) => execute({ title: 'Synthetic contract report', output_path: 'test.html', structure: selected, results_ref: ref('results') }) };
}

test('incomplete linked history on pending or unavailable claims fails validation before rendering', async () => {
  for (const status of ['pending', 'unavailable']) {
    const step = claim(status);
    step.historical_basis = { sample: { resolved: 5 }, outcomes: [{ label: 'A', count: 5 }], refs: [ref('missing-history')] };
    const rows = [row([step])], before = structuredClone(rows), run = harness(rows);
    assert.throws(() => bindResults(resolveStructure(structure()), rows), /scenario is required/);
    await assert.rejects(run.compose(), error => !(error instanceof TypeError) && /scenario is required/.test(error.message));
    assert.equal(run.writes.length, 0);
    assert.deepEqual(rows, before);
  }
});

test('a pending comparison must resolve every historical artifact before writing', async () => {
  const step = claim('pending');
  step.historical_basis.refs = [ref('missing-history')];
  const run = harness([row([step])]);
  await assert.rejects(run.compose(), /Missing artifact: missing-history/);
  assert.ok(run.reads.includes('missing-history'));
  assert.equal(run.writes.length, 0);
});

test('per-claim evidence_refs reject malformed references for every claim state', async () => {
  for (const status of ['provided', 'pending', 'unavailable']) {
    for (const evidence_refs of [['NOT_A_FIXED_REFERENCE'], [{ id: 'bare-id' }], null, Array(33).fill(ref('too-many'))]) {
      const step = { ...claim(status), evidence_refs }, run = harness([row([step])]);
      await assert.rejects(run.compose(), /inference evidence_refs must be fixed references/);
      assert.equal(run.writes.length, 0);
    }
  }
});

test('per-claim analysis references must exist and remain available for analysis', async () => {
  const step = { ...claim(), evidence_refs: [ref('analysis-output')] };
  const missing = harness([row([step])]);
  await assert.rejects(missing.compose(), /Missing artifact: analysis-output/);
  assert.equal(missing.writes.length, 0);
  const unavailable = harness([row([step])], [...historyRefs, ref('analysis-output')], { 'analysis-output': { available_for_analysis: false } });
  await assert.rejects(unavailable.compose(), /Evidence is not available for analysis/);
  assert.equal(unavailable.writes.length, 0);
});

test('pending linked history and per-claim sources enter fixed publication bindings without manufacturing confidence', async () => {
  for (const status of ['pending', 'unavailable']) {
    for (const display of ['full', 'summary', 'hidden']) {
      const step = { ...claim(status), evidence_refs: [ref('analysis-output')], validation: { status: 'out_of_sample', history_refs: [ref('validation-output')] } };
      const expected = [...historyRefs, ref('analysis-output'), ref('validation-output')];
      const run = harness([row([step])], expected, { 'analysis-output': { provenance: { kind: 'demo' } } });
      const result = await run.compose(structure(display)), html = run.writes[0].content;
      assert.deepEqual(new Set(result.publish.references.map(item => item.id)), new Set(expected.map(item => item.id)));
      assert.deepEqual(new Set(run.reads), new Set(['results', ...expected.map(item => item.id)]));
      assert.equal(result.publish.provenance_kind, 'demo');
      assert.doesNotMatch(html, /class="report-reasoning-confidence"/);
      assert.equal(html.includes('COHORT_ONLY_SENTINEL'), display === 'full');
      assert.equal(html.includes('data-step="history"'), display !== 'hidden');
    }
  }
});

test('pending claims can omit history and validation while retaining the explicit gap', async () => {
  for (const status of ['pending', 'unavailable']) {
    const step = claim(status);
    delete step.historical_basis; delete step.validation;
    step.reasoning.history = { status, note: 'Comparable history is not supplied.' };
    const run = harness([row([step])], []), result = await run.compose();
    assert.deepEqual(result.publish.references, []);
    assert.deepEqual(run.reads, ['results']);
    assert.ok(run.writes[0].content.includes('Comparable history is not supplied.'));
    assert.doesNotMatch(run.writes[0].content, /class="report-reasoning-(?:sample|shares|confidence)"/);
  }
});

test('linked comparison history does not require a pending judgment to claim validation', async () => {
  for (const status of ['pending', 'unavailable']) {
    const step = claim(status);
    delete step.validation;
    const run = harness([row([step])]), result = await run.compose();
    assert.deepEqual(new Set(result.publish.references.map(item => item.id)), new Set(historyRefs.map(item => item.id)));
    assert.match(run.writes[0].content, /data-history-status="linked"/);
    assert.match(run.writes[0].content, /class="report-reasoning-sample"/);
    assert.doesNotMatch(run.writes[0].content, /class="report-reasoning-confidence"/);
  }
});

test('optional validation on pending claims is validated when supplied', () => {
  for (const validation of [null, { status: 'unknown' }, { status: 'historical_exploration', history_refs: ['bare'] }, { status: 'prospective', history_refs: [] }]) {
    const step = { ...claim('pending'), validation };
    assert.throws(() => bindResults(resolveStructure(structure()), [row([step])]), /validation|validated claims/);
  }
});

test('deleting the inference field keeps its stale malformed evidence outside the selected contract', async () => {
  const step = { ...claim('pending'), historical_basis: { malformed: true }, evidence_refs: ['NOT_A_FIXED_REFERENCE'] };
  const run = harness([row([step]), { section_id: 'review', field: 'note', value: 'A supplied observation.' }], []);
  const result = await run.compose({ sections: [{ id: 'review', title: 'Review', fields: [{ key: 'note', type: 'text', label: 'Note', meaning: 'Existing observation' }] }] });
  assert.equal(result.completeness.status, 'complete');
  assert.equal(result.completeness.ignored, 1);
  assert.deepEqual(result.publish.references, []);
  assert.doesNotMatch(run.writes[0].content, /NOT_A_FIXED_REFERENCE|COHORT_ONLY_SENTINEL/);
});
