import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as strategy from '../packages/strategy-research/scripts/experiment.mjs';
import * as factor from '../packages/factor-research/scripts/factor.mjs';
import { buildLock } from '../../api-v1/scripts/plugin-lock.mjs';

const packageRoot = name => fileURLToPath(new URL(`../packages/${name}/`, import.meta.url));
const read = (name, file) => JSON.parse(readFileSync(join(packageRoot(name), file)));
const sPlan = () => read('strategy-research', 'examples/plan.demo.json');
const timings = () => read('strategy-research', 'examples/timing.demo.json');
const fPlan = () => read('factor-research', 'examples/plan.demo.json');
const development = () => read('factor-research', 'examples/development.demo.json');
const held = () => read('factor-research', 'examples/holdout.demo.json');

test('separate resource packages pass the same package validator with no implicit methods or host grant', () => {
  const root = mkdtempSync(join(tmpdir(), 'research-lock-'));
  try {
    mkdirSync(join(root, 'packages'));
    for (const name of ['strategy-research', 'factor-research']) {
      cpSync(packageRoot(name), join(root, 'packages', name), { recursive: true });
      const manifest = read(name, 'plugin.json');
      assert.equal(manifest.default_state, 'discoverable'); assert.equal(manifest.engines.sesame, '>=0.2.0-0');
      assert.deepEqual(manifest.tool_names, []); assert.deepEqual(read(name, 'tools.json'), []);
      assert.equal(manifest.migration, undefined); assert.deepEqual(manifest.provides, {});
      for (const path of manifest.resources) assert.ok(readFileSync(join(packageRoot(name), path)).length, path);
    }
    const lock = buildLock(root); assert.equal(lock.packages.length, 2);
    assert.deepEqual(lock.packages.map(pkg => pkg.id), ['sesame/factor-research', 'sesame/strategy-research']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('strategy demo purges exactly boundary leakage and keeps holdout apart without pretending execution', () => {
  const result = strategy.auditTiming(sPlan(), timings());
  assert.equal(result.provenance, 'demo'); assert.equal(result.nativeEngineExecuted, false);
  assert.deepEqual(result.partition.train, ['demo-01', 'demo-02', 'demo-03', 'demo-04']);
  assert.deepEqual(result.partition.validation, ['demo-06', 'demo-07', 'demo-08', 'demo-09']);
  assert.equal(result.partition.holdout.length, 5);
  assert.deepEqual(result.purged.map(row => row.id), ['demo-05', 'demo-10']);
  assert.equal(result.blockers.length, 1);
});
test('future features and labels known before realization are refused', () => {
  const a = timings(); a[0].featureAvailableAt = '2024-01-01T09:30:00.001Z';
  assert.throws(() => strategy.auditTiming(sPlan(), a), /Look-ahead/);
  const b = timings(); b[0].labelAvailableAt = '2024-01-01T15:59:00.000Z';
  assert.throws(() => strategy.auditTiming(sPlan(), b), /Invalid label/);
});
test('purge uses availability as well as holding end; exact cutoff is not silently shifted', () => {
  const rows = timings(); rows[0].labelAvailableAt = '2024-01-05T00:00:00.001Z';
  assert.ok(strategy.auditTiming(sPlan(), rows).purged.some(row => row.id === 'demo-01'));
  rows[0].labelAvailableAt = '2024-01-05T00:00:00.000Z';
  assert.ok(strategy.auditTiming(sPlan(), rows).partition.train.includes('demo-01'));
});
test('plan rejects overlaps, malformed calendars and unknown schema fields; missing external evidence remains blocked', () => {
  const overlap = sPlan(); overlap.splits[1].start = overlap.splits[0].start;
  assert.throws(() => strategy.validatePlan(overlap), /overlapping/);
  assert.throws(() => strategy.instant('2024-02-30T00:00:00.000Z'), /Invalid/);
  assert.throws(() => strategy.validatePlan({ ...sPlan(), hiddenSearch: true }), /exact fields/);
  const unknown = sPlan(); unknown.data.universe = 'unknown';
  assert.ok(strategy.validatePlan(unknown).blockers.some(message => message.includes('universe')));
});
test('ledger counts failure/unknown attempts and rejects budget, re-used identity or any trial after holdout', () => {
  const plan = sPlan(), trials = read('strategy-research', 'examples/trials.demo.json');
  trials[0].status = 'failed'; trials[1].status = 'unknown';
  assert.equal(strategy.auditLedger(plan, trials).attempted, 4);
  assert.equal(strategy.auditLedger(plan, trials).multiplicity.pValue, null);
  assert.throws(() => strategy.auditLedger(plan, [...trials, trials[0]]), /budget/);
  const duplicate = structuredClone(trials); duplicate[1].id = duplicate[0].id;
  assert.throws(() => strategy.auditLedger(plan, duplicate), /Repeated/);
  assert.throws(() => strategy.auditLedger(plan, [trials.at(-1), trials[0]]), /Holdout is terminal/);
});
test('ledger binds actual plan/data/source/engine and requires evidence for completion', () => {
  const trials = read('strategy-research', 'examples/trials.demo.json');
  trials[0].status = 'completed'; assert.throws(() => strategy.auditLedger(sPlan(), trials), /result evidence/);
  trials[0].result = { id: 'artifact_result', revision: '1', digest: 'sha256:' + 'f'.repeat(64), kind: 'strategy.result', schemaVersion: '1.0.0' }; trials[0].planDigest = 'sha256:' + 'e'.repeat(64);
  assert.throws(() => strategy.auditLedger(sPlan(), trials), /bind the fixed/);
});
test('fixed result and digest contracts reject empty evidence and array-to-string coercion', () => {
  for (const result of ['', ' ', ['sha256:' + 'f'.repeat(64)]]) {
    const trials = read('strategy-research', 'examples/trials.demo.json'); trials[0].status = 'completed'; trials[0].result = result;
    assert.throws(() => strategy.auditLedger(sPlan(), trials), /object required/);
  }
  const trials = read('strategy-research', 'examples/trials.demo.json'); trials[0].sourceDigest = [trials[0].sourceDigest];
  assert.throws(() => strategy.auditLedger(sPlan(), trials), /bind the fixed/);
  const s = sPlan(); s.data.sha256 = [s.data.sha256]; assert.throws(() => strategy.validatePlan(s), /require sha256/);
  const f = fPlan(); f.data.holdoutSha256 = [f.data.holdoutSha256]; assert.throws(() => factor.validatePlan(f), /digests required/);
  const engine = sPlan(); engine.engine.pluginId = [engine.engine.pluginId]; assert.throws(() => strategy.validatePlan(engine), /plugin ID required/);
  const id = fPlan(); id.factors[0].id = [id.factors[0].id]; assert.throws(() => factor.validatePlan(id), /factor IDs required/);
});

test('rank math has exact known answers, ties and undefined constant correlation', () => {
  assert.deepEqual(factor.ranks([4, 1, 1, 3]), [4, 1.5, 1.5, 3]);
  assert.equal(factor.spearman([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  assert.equal(factor.spearman([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  assert.equal(factor.spearman([1, 1, 1], [1, 2, 3]), null);
});
test('factor demo retains all declared attempts including constant failure and no OOS ranking', () => {
  const plan = fPlan(), rows = development(), before = JSON.stringify(rows);
  const screening = factor.screen(plan, rows);
  assert.equal(screening.provenance, 'demo'); assert.equal(screening.holdoutRead, false);
  assert.equal(screening.trialsInThisScreen, 3); assert.equal(screening.statisticalInference, 'not_performed');
  assert.equal(screening.train.find(row => row.factor === 'constant').rankICMean, null);
  assert.equal(screening.train.find(row => row.factor === 'constant').computedPortfolioPeriods, 0);
  const selection = factor.select(plan, screening, 'rank_signal'), result = factor.holdout(plan, held(), screening, selection);
  assert.equal(result.selected.factor, 'rank_signal'); assert.equal(result.otherCandidatesEvaluated, false);
  assert.equal(result.selected.periods, 4); assert.equal(JSON.stringify(rows), before);
});
test('flat-to-flat cost, equal gross exposure and direction have hand-calculated answers', () => {
  const plan = fPlan(), rows = development();
  for (const row of rows) { const i = Number(row.instrument.slice(-2)); row.eligible = true; row.label.return = String(i / 100); row.label.status = 'observed'; }
  const result = factor.screen(plan, rows).train.find(row => row.factor === 'rank_signal');
  assert.equal(result.rankICMean, 1); assert.ok(Math.abs(result.curve[0].gross - 0.03) < 1e-14);
  assert.equal(result.curve[0].cost, 0.00205); assert.ok(Math.abs(result.meanNetDiagnostic - 0.02795) < 1e-14);
  assert.ok(Math.abs(result.cumulativeNetDiagnostic - ((1.02795 ** 4) - 1)) < 1e-14);
  plan.factors[0].direction = -1;
  const inverse = factor.screen(plan, rows).train[0]; assert.equal(inverse.rankICMean, -1);
  assert.ok(Math.abs(inverse.meanNetDiagnostic - (-0.03205)) < 1e-14);
});
test('ties cannot choose a lucky symbol subset at a tail boundary', () => {
  const rows = development();
  for (const row of rows) { row.eligible = true; row.label.return ??= '0'; row.label.status = 'observed'; if (Number(row.instrument.slice(-2)) <= 3) row.features.rank_signal.value = '1'; }
  const metric = factor.screen(fPlan(), rows).train[0];
  assert.equal(metric.computedPortfolioPeriods, 0); assert.ok(metric.curve.every(row => row.status === 'indeterminate_tails'));
});
test('point-in-time feature and universe leakage are independent hard failures', () => {
  const rows = development(); rows[0].features.rank_signal.availableAt = '2024-02-01T09:30:00.001Z';
  assert.throws(() => factor.screen(fPlan(), rows), /Future feature/);
  rows[0].features.rank_signal.availableAt = '2024-02-01T09:00:00.000Z'; rows[0].universeKnownAt = '2024-02-01T09:30:00.001Z';
  assert.throws(() => factor.screen(fPlan(), rows), /Universe membership/);
});
test('eligible unavailable labels cannot silently remove delistings; missing features remain counted', () => {
  const rows = development(); rows[0].label.return = null; rows[0].label.status = 'unavailable';
  assert.throws(() => factor.screen(fPlan(), rows), /never silently drop/);
  const missing = development(); missing[0].features.rank_signal = { value: null, availableAt: null };
  const result = factor.screen(fPlan(), missing); assert.equal(result.train[0].missingFeatures, 1);
  assert.equal(result.train[0].curve[0].covered, 7);
  const delisting = development().find(row => row.label.status === 'delisting_included'); assert.equal(delisting.label.return, '-1.000');
});
test('physical split boundary, overlap and forged numeric fields are refused', () => {
  assert.throws(() => factor.screen(fPlan(), [...development(), ...held()]), /physically separate/);
  const overlap = development();
  for (const row of overlap.filter(row => row.decisionAt.startsWith('2024-02-01'))) { row.label.end = '2024-02-02T16:00:00.000Z'; row.label.availableAt = '2024-02-02T16:01:00.000Z'; }
  assert.throws(() => factor.screen(fPlan(), overlap), /Overlapping holding/);
  const number = development(); number[0].features.rank_signal.value = 1;
  assert.throws(() => factor.screen(fPlan(), number), /decimal text/);
  const invalid = development(); invalid[0].label.return = '-1.01'; assert.throws(() => factor.screen(fPlan(), invalid), /numeric range/);
});
test('factor purge excludes late-available labels without removing their audit evidence', () => {
  const rows = development(); rows[0].label.availableAt = '2024-02-06T00:00:00.001Z';
  const result = factor.screen(fPlan(), rows); assert.equal(result.purged.length, 1);
  assert.equal(result.purged[0].instrument, rows[0].instrument);
});
test('constant factors cannot be selected; changed plan/direction or forged selection invalidates holdout', () => {
  const plan = fPlan(), screening = factor.screen(plan, development());
  assert.throws(() => factor.select(plan, screening, 'constant'), /insufficient/);
  assert.throws(() => factor.select(plan, screening, 'unknown'), /declared/);
  const selection = factor.select(plan, screening, 'rank_signal'); selection.holdoutUsesAllowed = 2;
  assert.throws(() => factor.holdout(plan, held(), screening, selection), /Selection differs/);
  const changed = structuredClone(plan); changed.factors[0].direction = -1;
  assert.throws(() => factor.select(changed, screening, 'rank_signal'), /matching development/);
});
test('unsupported schema, empty periods and malformed timestamps fail with no inference', () => {
  assert.throws(() => factor.instant('2024-02-01T09:30:00'), /UTC/);
  assert.throws(() => factor.instant('2024-02-30T09:30:00.000Z'), /Invalid/);
  assert.throws(() => factor.validatePlan({ ...fPlan(), method: 'unrequested-model' }), /exact fields/);
  assert.throws(() => factor.screen(fPlan(), development().slice(0, 8)), /two retained/);
  const unknown = fPlan(); unknown.data.universe = 'unknown';
  assert.equal(factor.screen(unknown, development()).inputQuality, 'limited');
});

test('real CLI validates exact bytes, executes screen/select/holdout, preserves retries and refuses changed output', () => {
  const root = mkdtempSync(join(tmpdir(), 'factor-cli-')), pkg = packageRoot('factor-research'), cli = join(pkg, 'scripts/factor.mjs');
  const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  try {
    const plan = join(pkg, 'examples/plan.demo.json'), screen = join(root, 'screen.json'), selected = join(root, 'selection.json'), out = join(root, 'out.json');
    const screenArgs = ['screen', plan, join(pkg, 'examples/development.demo.json'), '--out', screen];
    assert.equal(invoke(screenArgs).status, 0); const before = readFileSync(screen);
    assert.equal(invoke(screenArgs).status, 0); assert.ok(readFileSync(screen).equals(before));
    assert.equal(invoke(['select', plan, screen, 'rank_signal', '--out', selected]).status, 0);
    const run = invoke(['holdout', plan, join(pkg, 'examples/holdout.demo.json'), screen, selected, '--out', out]);
    assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(readFileSync(out)).selected.factor, 'rank_signal');
    const changed = join(root, 'changed.json'); writeFileSync(changed, readFileSync(join(pkg, 'examples/development.demo.json')).toString() + ' ');
    assert.match(invoke(['screen', plan, changed]).stderr, /Data bytes differ/);
    writeFileSync(screen, 'different'); assert.notEqual(invoke(screenArgs).status, 0); assert.equal(readFileSync(screen, 'utf8'), 'different');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('strategy CLI runs all demo checks and rejects byte drift and non-UTF8 input', () => {
  const root = mkdtempSync(join(tmpdir(), 'strategy-cli-')), pkg = packageRoot('strategy-research'), cli = join(pkg, 'scripts/experiment.mjs'), plan = join(pkg, 'examples/plan.demo.json');
  const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  try {
    for (const args of [['plan', plan], ['timing', plan, join(pkg, 'examples/timing.demo.json')], ['ledger', plan, join(pkg, 'examples/trials.demo.json')]]) { const run = invoke(args); assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).nativeEngineExecuted, false); }
    const bad = join(root, 'bad.json'); writeFileSync(bad, '[]'); assert.match(invoke(['timing', plan, bad]).stderr, /bytes differ/);
    writeFileSync(bad, Buffer.from([0xff])); assert.notEqual(invoke(['plan', bad]).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('invalid or absent selection fails before the CLI opens the physical holdout file', () => {
  const root = mkdtempSync(join(tmpdir(), 'factor-no-peek-')), pkg = packageRoot('factor-research'), plan = fPlan();
  try {
    const screening = factor.screen(plan, development()), selected = factor.select(plan, screening, 'rank_signal');
    selected.holdoutUsesAllowed = 2;
    const screen = join(root, 'screen.json'), selection = join(root, 'selection.json'), trace = join(root, 'opened'), preload = join(root, 'probe.cjs');
    const input = join(pkg, 'examples/holdout.demo.json');
    writeFileSync(screen, JSON.stringify(screening)); writeFileSync(selection, JSON.stringify(selected));
    writeFileSync(preload, `const fs=require('node:fs');const original=fs.openSync;fs.openSync=function(path,...rest){if(String(path)===${JSON.stringify(input)})fs.writeFileSync(${JSON.stringify(trace)},'opened');return original.call(this,path,...rest)};require('node:module').syncBuiltinESMExports();`);
    for (const selectedPath of [selection, join(root, 'absent.json')]) {
      const run = spawnSync(process.execPath, ['--require', preload, join(pkg, 'scripts/factor.mjs'), 'holdout', join(pkg, 'examples/plan.demo.json'), input, screen, selectedPath], { encoding: 'utf8' });
      assert.notEqual(run.status, 0); assert.equal(existsSync(trace), false, run.stderr);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('both CLI entry points execute through a symlink directory alias and report malformed commands', () => {
  const root = mkdtempSync(join(tmpdir(), 'research-entry-alias-'));
  try {
    for (const [name, script, command, input] of [['strategy-research', 'experiment.mjs', 'plan', []], ['factor-research', 'factor.mjs', 'screen', ['examples/development.demo.json']]]) {
      const target = join(root, name); symlinkSync(packageRoot(name), target, process.platform === 'win32' ? 'junction' : 'dir');
      const path = join(target, 'scripts', script), args = [command, join(target, 'examples/plan.demo.json'), ...input.map(file => join(target, file))];
      const run = spawnSync(process.execPath, [path, ...args], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).provenance, 'demo');
      const bad = spawnSync(process.execPath, [path, 'incorrect-command'], { encoding: 'utf8' });
      assert.equal(bad.status, 1); assert.match(bad.stderr, /Usage:/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
