import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContent, createReports } from '../report.js';
import { createCapabilities } from '../index.js';
import { storageFixture } from './storage-fixture.js';
import { writeFile } from 'node:fs/promises';
const ref = { id: 'report', revision: '1', digest: 'sha256:' + 'a'.repeat(64), kind: 'report', schemaVersion: '1.0.0' };
const metric = value => ({ value, status: 'computed' });
const evaluated = { status: 'evaluated', evaluation: { rankIC: metric(.5), score: metric(.4), coverage: metric(.9), stability: metric(.1), diagnostics: [] }, factorIds: ['factor-1'] };
const candidate = { id: 'one', formula: { dsl: 'qlib-expr/1', tree: { field: 'close' } } };

test('factory preflight needs no runtime paths or side effects', () => {
  const capabilities = createCapabilities({ context: { storageRoot: null, pluginRoot: null } });
  assert.equal(capabilities.length, 9); assert.ok(capabilities.every(c => typeof c.execute === 'function'));
});

test('conflicting concurrent configuration commands cannot change the saved selection', async t => {
  const f = await storageFixture(t); f.host.context.pluginRoot = f.root;
  const processes = new Map(); let probes = 0;
  f.host.capabilities = { async invoke(name, input) {
    assert.equal(name, 'host.process.exec'); probes++;
    await writeFile(input.argv.at(-1), JSON.stringify({ ready: true, pythonPath: input.argv[0], environmentDigest: 'sha256:' + 'a'.repeat(64), versions: {} }));
    const run = { id: `probe-${probes}`, status: 'completed', output: { exitCode: 0 } }; processes.set(run.id, run); return { type: 'run', run };
  } };
  f.host.runs = { wait: run => ({ reason: 'settled', run: processes.get(run.id) }) };
  const first = Object.fromEntries(createCapabilities(f.host).map(c => [c.name, c.execute]));
  const second = Object.fromEntries(createCapabilities(f.host).map(c => [c.name, c.execute]));
  const results = await Promise.allSettled([first.factor_configuration_update({ pythonPath: 'A-python', command_id: 'same-command' }), second.factor_configuration_update({ pythonPath: 'B-python', command_id: 'same-command' })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(probes, 1); assert.deepEqual(await first.factor_configuration_read(), { pythonPath: 'A-python', ready: true });
});

test('reports read actual evaluated records, use state scores, and support holdout-only evaluation', () => {
  const content = buildContent({ proposed: 1 }, { mode: 'evaluate', profile: { kind: 'state' } }, [{ candidate, holdout: evaluated }]);
  assert.equal(content.overview.conclusion, '已评价 1 个因子，1 个完成留出检验');
  const table = content.sections.find(s => s.title === '状态识别因子').blocks[0];
  assert.equal(table.columns[2], '留出 η²'); assert.equal(table.rows[0][2], .4); assert.equal(table.rows[0][5], 'factor-1');
  assert.ok(!JSON.stringify(content).includes('RankIC'));
});

test('compute-only reports never claim evaluation and failed computations need no formula record', () => {
  const content = buildContent({ proposed: 2 }, { mode: 'compute' }, [{ candidate, development: { status: 'computed' } }, { candidate: null, candidateId: 'invalid', development: { status: 'failed', error: { message: 'Unknown field' } } }]);
  assert.equal(content.overview.conclusion, '已计算 1 个因子，固定因子值已保存');
  assert.deepEqual(content.sections.find(s => s.title === '需要补充的计算').blocks[0].rows, [['invalid', 'Unknown field']]);
});

test('bounded report tables retain full evaluation and search-attempt counts', () => {
  const content = buildContent({ proposed: 101, attemptsUsed: 130 }, { mode: 'both' }, Array.from({ length: 101 }, () => ({ candidate, development: evaluated })));
  assert.equal(content.overview.conclusion, '已评价 101 个因子，0 个完成留出检验');
  assert.equal(content.overview.facts[0].value, '130');
  assert.equal(content.sections.find(s => s.title === '因子证据').blocks[0].rows.length, 100);
});

test('report retry checks the pinned existing report, and the newest equal-time receipt wins', async () => {
  const calls = [], host = { capabilities: { invoke: async (id, input) => { calls.push([id, input]); return { type: 'result', value: {} }; } }, resources: { read: async () => ({ items: [{ renderer: { name: 'sesame-report-inspector' }, artifact: ref, observedAt: 100, status: 'rendered' }, { renderer: { name: 'sesame-report-inspector' }, artifact: ref, observedAt: 100, status: 'failed' }] }) } };
  const reports = createReports({ host });
  await assert.rejects(reports.publish({ report: ref }, () => assert.fail('Do not republish')), { code: 'REPORT_NOT_RENDERED' });
  assert.deepEqual(calls, [['sesame/reports#report_check', { ref }]]);
});
