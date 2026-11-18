import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMandate, mandateInputSchema } from '../mandate.js';

const user = (fields, evidence, amend = false) => ({ source: 'user', fields, evidence, amend });

test('an attributed research mandate starts from the brief and project data without a questionnaire', () => {
  const input = { brief: '标的为 SPY，日线、只做多；最大回撤不超过 12%；佣金 5 bps，滑点 0.3 bps。',
    context: [{ source: 'project', evidence: 'research profile v3', fields: { capital: { amount: '100000', currency: 'USD' } } }] };
  const result = buildMandate(input);
  assert.equal(result.status, 'draft');
  assert.deepEqual(result.questions, []);
  assert.deepEqual(result.fields.instruments, ['SPY']);
  assert.deepEqual(result.fields.directions, ['long']);
  assert.equal(result.fields.frequency, '日线');
  assert.equal(result.fields.capital.currency, 'USD');
  assert.deepEqual(result.experiment.config, { capital: '100000', commission: '0.0005', slippage: '0.00003' });
  assert.deepEqual(result.experiment.constraints, [{ metric: 'maxDrawdown', op: '<=', value: 0.12 }]);
  assert.equal(result.provenance.maxDrawdown.source, 'user');
  assert.equal(result.provenance['capital.amount'].evidence, 'research profile v3');
  assert.match(result.fields.benchmark, /SPY/);
  assert.equal(result.provenance.benchmark.source, 'assumption');
  assert.equal(result.provenance.hypothesis.source, 'assumption');
  assert.deepEqual(result.experiment.unverifiedConstraints.toSorted(), ['directions', 'instruments']);
  assert.deepEqual(buildMandate(input), result);
});

test('an incomplete brief leaves unknown capital, costs and risk as gaps without implying live permission', () => {
  const result = buildMandate({ brief: '探索均线规则，看看它是否有用。' });
  assert.deepEqual(result.experiment.objective, { metric: 'netReturn', direction: 'maximize' });
  assert.equal(result.provenance.objective.source, 'assumption');
  assert.deepEqual(result.experiment.config, {});
  assert.equal(result.fields.maxDrawdown, null);
  assert.equal(result.fields.costs.commission, null);
  assert.equal(result.gaps.find(gap => gap.field === 'costs.commission').action, 'resolve_in_research');
  assert.deepEqual(result.questions, []);
  assert.equal(result.researchOnly, true);
  assert.equal(result.deploymentAuthorized, false);
  assert.equal(mandateInputSchema.additionalProperties, false);
});

test('user terms survive project updates and lower-confidence Agent suggestions field by field', () => {
  const first = buildMandate({ context: [user({ maxDrawdown: .1, costs: { commission: '0.001' }, leverage: 1 }, 'user-approved risk and commissions')] });
  const revised = buildMandate({ context: [
    { source: 'project', evidence: 'previous project defaults', fields: { maxDrawdown: .25, leverage: 2 } },
    { source: 'assumption', evidence: 'research execution estimate', fields: { costs: { commission: 0, slippage: .0002 } } },
  ] }, first);
  assert.equal(revised.fields.maxDrawdown, .1);
  assert.equal(revised.fields.leverage, 1);
  assert.deepEqual(revised.experiment.config, { commission: '0.001', slippage: '0.0002' });
  assert.equal(revised.provenance['costs.slippage'].source, 'assumption');
  assert.equal(revised.fields.costs.model, null);
  assert.equal(first.fields.costs.slippage, null);
  assert.deepEqual(revised.questions, []);
});

test('unresolved explicit limits survive reload and an explicit user amendment resolves the dispute', () => {
  const initial = buildMandate({ context: [user({ maxDrawdown: .1 }, 'first mandate')] });
  const conflict = buildMandate({ context: [user({ maxDrawdown: .2 }, 'second instruction')] }, initial);
  assert.equal(conflict.status, 'needs_clarification');
  assert.equal(conflict.questions.length, 1);
  assert.deepEqual(conflict.conflicts[0].alternatives.map(item => item.evidence), ['first mandate', 'second instruction']);
  assert.equal(buildMandate({}, JSON.parse(JSON.stringify(conflict))).questions.length, 1);
  const revised = buildMandate({ brief: '最大回撤改为 15%。' }, conflict);
  assert.equal(revised.fields.maxDrawdown, .15);
  assert.equal(revised.status, 'draft');
  assert.deepEqual(revised.questions, []);
  assert.equal(initial.fields.maxDrawdown, .1);
  assert.throws(() => buildMandate({ context: [{ ...user({ maxDrawdown: .4 }, 'guess', true), source: 'assumption' }] }, revised), /user amendment/i);
});

test('draft fields can be unknown without erasing a previous explicit limit or guessing zero costs', () => {
  const first = buildMandate({ context: [user({ maxDrawdown: .1 }, 'explicit cap')] });
  const result = buildMandate({ context: [{ source: 'research', evidence: 'unavailable terms', fields: { costs: null, maxDrawdown: null } }] }, first);
  assert.equal(result.fields.maxDrawdown, .1);
  assert.equal(result.fields.costs.slippage, null);
  assert.deepEqual(result.experiment.config, {});
  const cleared = buildMandate({ context: [user({ maxDrawdown: null }, '撤销旧阈值，新值待定', true)] }, result);
  assert.equal(cleared.fields.maxDrawdown, null);
  assert.deepEqual(cleared.experiment.constraints, []);
});

test('unverified research examples, absent units and historical drawdown do not become user limits', () => {
  for (const brief of ['假设最大回撤不超过 20%。', '历史最大回撤 12%。', '最大回撤不超过 10。', '最大回撤 < 10%。']) {
    const result = buildMandate({ brief });
    assert.equal(result.fields.maxDrawdown, null, brief);
  }
  assert.throws(() => buildMandate({ context: [user({ maxDrawdown: 12 }, 'wrong units')] }), /fraction/i);
  assert.throws(() => buildMandate({ context: [user({ costs: { slippage: 5 } }, 'basis points missing')] }), /fractions/i);
});

test('changing the universe recomputes an assumed benchmark and preserves an explicitly chosen benchmark', () => {
  const first = buildMandate({ brief: '标的为 SPY。' });
  const changed = buildMandate({ context: [user({ instruments: ['QQQ'] }, 'change universe to QQQ', true)] }, first);
  assert.match(changed.fields.benchmark, /QQQ/);
  assert.match(changed.fields.hypothesis, /QQQ/);
  const many = buildMandate({ context: [user({ instruments: ['SPY', 'QQQ'] }, 'expand universe', true)] }, changed);
  assert.equal(many.fields.benchmark, null);
  assert.equal(many.fields.hypothesis, null);
  assert.ok(many.gaps.some(item => item.field === 'benchmark'));
  const fixed = buildMandate({ context: [user({ benchmark: 'S&P 500 total return' }, 'user selected benchmark')] }, first);
  const next = buildMandate({ context: [user({ instruments: ['QQQ'] }, 'change universe', true)] }, fixed);
  assert.equal(next.fields.benchmark, 'S&P 500 total return');
});
