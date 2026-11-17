import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonical, digest, OPERATOR_DIGEST } from '../contracts.js';
const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.PYTHON;
const ref = { id: 'synthetic', revision: '1', digest: digest('synthetic'), kind: 'data', schemaVersion: '1.0.0' };
const time = n => new Date(Date.UTC(2026, 0, 1) + n * 3600000).toISOString();
const budget = { maxCandidates: 6, batchSize: 2, maxWorkers: 2, maxSeconds: 180, maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, seed: 17 };
const limits = { maxInputBytes: budget.maxInputBytes, maxOutputBytes: budget.maxOutputBytes, timeoutMs: 120000, maxDiagnosticWork: 1000000 };
const layout = { universe: ['A', 'B', 'C', 'D'], frequency: '1h', timezone: 'UTC', availableAt: 'bar_close', development: [time(3), time(44)], holdout: [time(45), time(58)], target: { kind: 'forward_return', field: 'close', horizonBars: 1 } };
const profile = { id: 'synthetic-alpha', version: 1, kind: 'alpha', axis: 'time_series', minPairs: 3, minCoverage: .8, stabilityWindows: 3, maxReferenceCorrelation: .95, score: 'abs_rank_ic', diagnostics: [{ kind: 'bootstrap', required: false, repetitions: 99, options: { blockBars: 4, seed: 7, confidence: .9 } }, { kind: 'quantiles', required: false, options: { count: 3 } }] };
const candidate = (id, tree) => ({ id, formula: { dsl: 'qlib-expr/1', tree }, hypothesis: 'Synthetic CLI integration fixture', origin: { method: 'seed', parents: [], parameters: {} } });

test('actual worker protocol prepares Qlib data, computes a batch, evaluates and searches', { skip: !python, timeout: 240000 }, async () => {
  const base = await mkdtemp(join(root, 'tests', '.worker-'));
  try {
    const local = async (name, value) => { const path = join(base, name), bytes = Buffer.from(canonical(value)); await writeFile(path, bytes); return { path, digest: digest(bytes), bytes: bytes.length }; };
    const command = async (name, input) => {
      const outputDir = join(base, `${name}-${Math.random().toString(16).slice(2)}`); await mkdir(outputDir);
      const request = join(base, `${name}-request.json`), result = join(base, `${name}-result.json`);
      await writeFile(request, canonical({ schema: 'factor-worker/1', command: name, limits, input: { ...input, outputDir } }));
      await exec(python, ['-I', '-B', join(root, 'python', 'worker.py'), request, result], { cwd: base, timeout: 150000, maxBuffer: 1048576, env: { ...process.env, TEMP: base, TMP: base, MPLCONFIGDIR: join(base, 'matplotlib'), OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' } });
      const receipt = JSON.parse(await readFile(result, 'utf8')); assert.equal(receipt.status, 'ok', JSON.stringify(receipt.error)); return receipt.output;
    };
    const rows = [];
    for (const [asset, symbol] of layout.universe.entries()) {
      let close = 100;
      for (let bar = 0; bar < 60; bar++) { const signal = Math.sin(bar * .7 + asset * .2) + bar * .005; rows.push({ time: time(bar), availableAt: time(bar), symbol, fields: { close, signal } }); close *= 1 + signal * .005; }
    }
    const prepared = await command('prepare', { sourceRef: ref, rows: [await local('rows.json', rows)], layout, budget });
    const descriptor = file => ({ manifest: file, digest: file.digest, rows: rows.length, bytes: file.bytes });
    const snapshot = { ...prepared.snapshot, source: ref, provider: prepared.provider, development: descriptor(prepared.development), holdout: descriptor(prepared.holdout), usageLedgerRef: ref };
    const snapshotFile = await local('snapshot.json', snapshot);
    const candidates = [candidate('signal', { field: 'signal' }), candidate('mean', { call: 'Mean', args: [{ field: 'close' }, { constant: 3 }] })];
    const computed = await command('compute', { snapshot: snapshotFile, candidates, partition: 'development' });
    assert.equal(computed.values.engine.name, 'qlib'); assert.equal(computed.values.engine.version, '0.9.7'); assert.equal(computed.values.engine.operatorDigest, OPERATOR_DIGEST);
    assert.equal(computed.values.candidates.filter(c => c.status === 'ok').length, 2);
    const values = { ...computed.values, matrix: descriptor(computed.matrix), labels: descriptor(computed.labels), diagnosticValues: computed.diagnosticValues };
    const context = { snapshotId: snapshot.id, sourceDigest: ref.digest, layoutDigest: digest({ layout, calendarDigest: snapshot.calendarDigest }), profileDigest: digest(profile), engineDigest: digest(computed.values.engine), referenceDigest: digest([]) };
    const measured = await command('evaluate', { values: await local('values.json', values), referenceValues: [], profile, context, valuesRef: { ...ref, kind: 'resource' } });
    assert.equal(measured.evaluations.length, 2); const result = measured.evaluations.find(item => item.id === 'signal').value;
    assert.ok(result.rankIC.value > .99); assert.equal(result.context.sourceDigest, ref.digest); assert.equal(result.diagnostics.length, 2);
    assert.ok(JSON.parse(await readFile(result.details.path, 'utf8')));
    const { holdout: _holdout, ...developmentLayout } = layout;
    const search = await command('propose', { request: { requestId: 'worker-smoke', need: 'Synthetic factor', development: { snapshotId: snapshot.id, source: ref, layout: developmentLayout, fields: ['close', 'signal'], calendarDigest: snapshot.calendarDigest }, space: { fields: ['close', 'signal'], operators: ['Add', 'Sub', 'Mul', 'Div', 'Ref', 'Mean'], windows: [2, 3, 5], lags: [1, 2], constants: [0, 1, 2], maxNodes: 16, maxDepth: 5, maxLookbackBars: 20, seeds: candidates.map(c => c.formula), templates: [] }, profile, references: [], budget }, checkpoint: null, feedback: [], limit: 2 });
    assert.equal(search.candidates.length, 2); assert.equal(JSON.parse(await readFile(search.checkpoint.path, 'utf8')).budget.used, 2);
  } finally { await rm(base, { recursive: true, force: true }); }
});
