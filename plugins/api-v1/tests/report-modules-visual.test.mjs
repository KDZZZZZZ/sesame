import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveStructure, bindResults } from '../packages/reports/report-structure.js';
import { renderComposedReport } from '../packages/reports/report-compose.js';

const fixture = JSON.parse(readFileSync(new URL('../packages/reports/examples/module-visual-fixtures.json', import.meta.url)));
const row = (module, field) => structuredClone(fixture.rows.find(row => row.section_id === module && row.field === field));
const structure = (module, fields) => resolveStructure({ sections: [{ module_id: module, fields }] });
const htmlFor = (resolved, rows) => renderComposedReport({ title: 'Visual evidence demo', structure: resolved, bound: bindResults(resolved, rows), data: [], references: [], demo: true });

test('all modules and combinations have concrete built-in visual candidates and complete fictional inputs', () => {
  const catalog = resolveStructure();
  assert.equal(catalog.modules.reduce((n, module) => n + module.chart_candidates.length, 0), 55);
  for (const template of [...catalog.modules, ...catalog.compositions]) {
    const resolved = resolveStructure({ template_id: template.id });
    if (template.id.startsWith('R')) assert.ok(resolved.suggested_charts.length >= 2);
    const bound = bindResults(resolved, fixture.rows);
    const charts = bound.sections.flatMap(section => section.fields.filter(field => field.type === 'chart'));
    assert.ok(charts.length >= 2);
    assert.ok(charts.every(field => field.result.status === 'provided' && field.chart.data_requirements));
    assert.match(htmlFor(resolved, fixture.rows), /id="sesame-module-charts"/);
  }
});

test('candlesticks reuse the installed market renderer once, and deleted/hidden charts do not load it', () => {
  const resolved = resolveStructure({ sections: [{ module_id: 'M01', fields: ['price_chart'] }, { module_id: 'M02', fields: ['price_chart'] }] });
  const html = htmlFor(resolved, fixture.rows);
  assert.equal((html.match(/id="sesame-module-charts"/g) ?? []).length, 1);
  assert.equal((html.match(/function installReportKit/g) ?? []).length, 1);
  assert.match(html, /LightweightCharts/);
  const config = JSON.parse(html.match(/id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(config.length, 2); assert.equal(config[0].kind, 'candlestick');
  assert.equal(config[0].rows[0].open, fixture.rows.find(row => row.field === 'price_chart').value.rows[0].open);
  const noChart = htmlFor(structure('M02', [{ key: 'price_chart', display: 'hidden' }]), fixture.rows);
  assert.doesNotMatch(noChart, /id="sesame-module-charts"|window\.LightweightCharts/);
  assert.doesNotMatch(htmlFor(structure('M02', []), fixture.rows), /module-chart-1/);
});

test('chart selection preserves user order and chart/data contracts reject unsafe overrides and absent columns', () => {
  const selected = structure('M02', ['scenario_chart', 'price_chart']);
  const html = htmlFor(selected, fixture.rows);
  const config = JSON.parse(html.match(/id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(config.map(item => item.kind), ['decision-tree', 'candlestick']);
  for (const change of [
    value => { value.rows = []; },
    value => { value.source_note = ''; },
    value => { value.options = { data: [{ close: 99 }] }; },
    value => { value.options = { onSelect: 'run()' }; },
    value => { value.rows = [{ time: '2026-10-01', open: 1 }]; },
  ]) { const input = row('M02', 'price_chart'); change(input.value); assert.throws(() => bindResults(selected, [input])); }
  const custom = structure('M02', [{ key: 'price_chart', chart: { kind: 'line', options: { x: 'time', y: 'close', xType: 'time' }, columns: ['time', 'close'], data_requirements: 'User-selected close series' } }]);
  assert.match(htmlFor(custom, fixture.rows), /"kind":"line"/);
});

test('confidence cannot be self-assigned or supported only by a generic source reference', () => {
  const selected = structure('M14', ['confidence']);
  const valid = row('M14', 'confidence');
  for (const change of [
    value => { delete value.historical_basis; },
    value => { value.historical_basis = { refs: valid.historical_basis.refs }; },
    value => { value.historical_basis.sample.resolved = 0; },
    value => { value.historical_basis.sample.matched++; },
    value => { value.historical_basis.outcomes[0].count++; },
    value => { value.historical_basis.refs = []; },
    value => { delete value.historical_basis.baseline; },
    value => { value.historical_basis.window.end = '2030-01-01'; },
    value => { value.value.interval.lower = 1.1; },
  ]) { const input = structuredClone(valid); change(input); assert.throws(() => bindResults(selected, [input])); }
  const gap = { section_id: 'M14', field: 'confidence', status: 'unavailable', reason: 'No comparable historical outcomes are available.' };
  const html = htmlFor(selected, [gap]);
  assert.match(html, /No comparable historical/); assert.doesNotMatch(html, /65%/);
  assert.equal(bindResults(selected, [valid]).researchValidation, 'not_evaluated');
});

test('historical evidence must match the requested target, horizon and information cutoff', () => {
  const input = row('M14', 'confidence');
  input.context = { horizon: 'next hour', target: 'different target', as_of: '2010-01-01' };
  for (const key of ['target', 'horizon', 'as_of']) {
    const selected = resolveStructure({ sections: [{ module_id: 'M14', fields: ['confidence'], context: { [key]: input.context[key] } }] });
    assert.throws(() => bindResults(selected, [input]), /historical|target|horizon|cutoff/i);
  }
});

test('each inference needs its own historical support; final confidence uses the joint cohort', () => {
  const selected = structure('M14', ['inference_evidence', 'confidence']);
  const input = row('M14', 'inference_evidence');
  const bad = structuredClone(input); delete bad.value[1].historical_basis;
  assert.throws(() => bindResults(selected, [bad]), /historical_basis/);
  const invalidRef = structuredClone(input); invalidRef.value[0].validation.history_refs = ['not-fixed'];
  assert.throws(() => bindResults(selected, [invalidRef]), /history_refs/);
  const missing = structuredClone(input); missing.value[1] = { id: 'missing', claim: 'Unsettled feature', status: 'unavailable', reason: 'No settled historical cases' };
  assert.equal(bindResults(selected, [missing]).researchValidation, 'not_evaluated');
  missing.value[1].confidence = { estimate: .8, definition: 'subjective' };
  assert.throws(() => bindResults(selected, [missing]), /without a confidence/);
  const result = bindResults(selected, [input, row('M14', 'confidence')]);
  const steps = input.value;
  assert.equal(steps[2].confidence.estimate, .65);
  assert.notEqual(steps[2].confidence.estimate, (steps[0].confidence.estimate + steps[1].confidence.estimate) / 2);
  assert.equal(result.evidence_refs.length, 1, 'Shared historical source is deduplicated, not counted as independent evidence');
});

test('demo confidence and plots are reproducible from the same synthetic historical outcomes', () => {
  const input = row('M14', 'inference_evidence');
  const selectors = { breakout: row => row.breakout, event: row => row.event, joint: row => row.breakout && row.event };
  for (const step of input.value) {
    const cases = fixture.history_rows.filter(selectors[step.id]);
    assert.equal(step.historical_basis.sample.resolved, cases.length);
    assert.equal(step.confidence.estimate, cases.filter(row => row.outcome === '上涨').length / cases.length);
    for (const outcome of step.historical_basis.outcomes) assert.equal(outcome.count, cases.filter(row => row.outcome === outcome.label).length);
  }
  const histogram = row('M13', 'outcome_chart').value;
  assert.equal(histogram.rows.reduce((n, bin) => n + bin.count, 0), histogram.options.sampleCount);
  const chart = row('M14', 'outlook_chart'); delete chart.historical_basis;
  assert.throws(() => bindResults(structure('M14', ['outlook_chart']), [chart]), /historical_basis/);
});

test('chart labels, source rows and historical prose remain inert HTML/JSON', () => {
  const attack = '</script><img src=x onerror=alert(1)>';
  const input = row('M02', 'scenario_chart'); input.value.rows[0].label = attack; input.value.source_note = attack;
  const html = htmlFor(structure('M02', ['scenario_chart']), [input]);
  assert.doesNotMatch(html, /<img src=x/); assert.match(html, /\\u003c\/script>/); assert.match(html, /&lt;\/script&gt;/);
});

test('combined defaults separate conclusions from evidence and keep one final scenario tree, with explicit overrides preserved', () => {
  const selected = resolveStructure({ template_id: 'R02' });
  const conclusion = selected.sections.find(section => section.module_id === 'M14');
  assert.ok(!conclusion.fields.some(field => field.type === 'inferences'));
  assert.ok(conclusion.fields.filter(field => ['chart','confidence'].includes(field.type)).every(field => field.history_display === 'summary'));
  assert.ok(selected.sections.find(section => section.module_id === 'M13').fields.some(field => field.type === 'inferences'));
  const html = htmlFor(selected, fixture.rows);
  const charts = JSON.parse(html.match(/id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(charts.filter(chart => chart.kind === 'decision-tree').length, 1);
  assert.equal(charts.at(-1).kind, 'decision-tree');
  const conclusionHTML = html.slice(html.indexOf('id="section-M14"'), html.indexOf('id="section-M01"'));
  assert.match(conclusionHTML, /href="#section-M13"/);
  assert.doesNotMatch(conclusionHTML, /class="module-history"|class="module-inference"/);
  assert.ok(resolveStructure({ template_id: 'M02' }).sections[0].fields.some(field => field.chart?.kind === 'decision-tree'));
  const custom = resolveStructure({ template_id: 'R02', sections: [{ module_id: 'M02', fields: ['scenario_chart'] }, { module_id: 'M15', fields: ['action_chart'] }] });
  assert.equal(custom.sections.flatMap(section => section.fields).filter(field => field.chart?.kind === 'decision-tree').length, 2);
});

test('recent same-instrument cases take precedence; cross-instrument fallback needs a completed zero-match search', () => {
  const selected = structure('M14', ['confidence']);
  const same = row('M14', 'confidence');
  assert.equal(bindResults(selected, [same]).completeness.status, 'complete');
  const cross = structuredClone(same);
  Object.assign(cross.historical_basis.sampling, { selected_scope: 'cross_instrument', instruments: ['OTHER'], comparability: 'Same outcome horizon, volatility regime and normalized outcome definition.' });
  assert.throws(() => bindResults(selected, [cross]), /fallback requires/);
  cross.historical_basis.sampling.primary_search.status = 'no_match';
  cross.historical_basis.sampling.primary_search.eligible_count = 0;
  assert.equal(bindResults(selected, [cross]).completeness.status, 'complete');
  const noExplanation = structuredClone(cross); delete noExplanation.historical_basis.sampling.comparability;
  assert.throws(() => bindResults(selected, [noExplanation]), /comparability/);
  const unavailable = structuredClone(cross);
  Object.assign(unavailable.historical_basis.sampling.primary_search, { status: 'unavailable', eligible_count: null });
  assert.throws(() => bindResults(selected, [unavailable]), /fallback requires/);
  Object.assign(unavailable.historical_basis.sampling, { policy: 'user_override', override_reason: 'The user explicitly requested comparison against OTHER.' });
  assert.equal(bindResults(selected, [unavailable]).completeness.status, 'complete');
  const oldCases = structuredClone(same); oldCases.historical_basis.sampling.recent_window.start = '2026-08-01';
  assert.throws(() => bindResults(selected, [oldCases]), /outside the recent/);
});
