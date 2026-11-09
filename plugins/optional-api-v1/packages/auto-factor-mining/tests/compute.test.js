import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCompute } from '../compute.js';

test('compute adapter forwards only the fixed numerical commands', async () => {
  const calls = [], python = { execute: async (...args) => { calls.push(args); return args[1]; } };
  const compute = createCompute({ python }), ctx = { signal: new AbortController().signal }, diagnostics = { covariateFields: [], sensitivity: [] };
  await compute.prepare({ datasetId: 'data' }, { frequency: 'day' }, { seed: 1 }, ctx);
  await compute.compute({ id: 'snapshot' }, [], 'development', ctx, diagnostics);
  assert.deepEqual(calls[0], ['prepare', { source: { datasetId: 'data' }, layout: { frequency: 'day' }, budget: { seed: 1 } }, ctx]);
  assert.deepEqual(calls[1], ['compute', { snapshot: { id: 'snapshot' }, candidates: [], partition: 'development', diagnostics }, ctx]);
  assert.throws(() => createCompute({ python: {} }), /python.execute/);
});

test('real Qlib numerical goldens, safety and durable rehydration', { skip: !process.env.PYTHON, timeout: 180000 }, () => {
  const result = spawnSync(process.env.PYTHON ?? 'python', ['-I', '-B', fileURLToPath(new URL('./compute_python.py', import.meta.url))], { encoding: 'utf8', timeout: 170000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /OK/);
});
