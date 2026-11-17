import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnvironment } from '../environment.js';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
function processHost(root) {
  const runs = new Map(), calls = [];
  return {
    context: { storageRoot: root, pluginRoot: packageDir }, calls,
    capabilities: { invoke: async (name, input) => {
      assert.equal(name, 'host.process.exec');
      calls.push(input);
      const id = `process-${runs.size}`;
      const promise = new Promise(resolve => {
        let stdout = '', stderr = '';
        const child = spawn(input.argv[0], input.argv.slice(1), { cwd: input.cwd, env: { ...process.env, ...input.env }, windowsHide: true });
        child.stdout.on('data', bytes => { stdout += bytes; });
        child.stderr.on('data', bytes => { stderr += bytes; });
        child.once('error', cause => resolve({ status: 'failed', error: { code: 'PROCESS_EXIT', details: { exitCode: -1, stdout, stderr: cause.message } } }));
        child.once('close', exitCode => resolve(exitCode === 0 ? { id, status: 'completed', output: { exitCode, stdout, stderr } } : { id, status: 'failed', error: { code: 'PROCESS_EXIT', details: { exitCode, stdout, stderr } } }));
      });
      runs.set(id, promise);
      return { type: 'run', run: { id } };
    } },
    runs: { wait: async ({ id }) => ({ reason: 'settled', run: await runs.get(id) }), cancel: async () => { throw new Error('Unexpected cancellation'); } },
  };
}

test('environment inspect probes real imports and prepare reuses that actual interpreter', { skip: !process.env.PYTHON, timeout: 120000 }, async () => {
  const root = await mkdtemp(join(packageDir, 'tests/.environment-test-'));
  try {
    const host = processHost(root), environment = createEnvironment({ host });
    const result = await environment.inspect({ pythonPath: process.env.PYTHON ?? 'python' });
    assert.equal(result.ready, true, JSON.stringify(result));
    assert.equal(result.versions.pyqlib, '0.9.7');
    assert.equal(result.versions.deap, '1.4.4');
    assert.equal(result.versions.optuna, '5.0.0');
    assert.match(result.environmentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'environment.json'), 'utf8')), result);
    const prepared = await environment.prepare({ pythonPath: result.pythonPath });
    assert.deepEqual(prepared, result);
    assert.equal(host.calls.length, 2);
    for (const call of host.calls) {
      assert.equal(call.argv[1], '-I');
      assert.equal(call.env.UV_PYTHON_DOWNLOADS, 'never');
      assert.equal(call.env.TEMP, join(root, 'tmp'));
      assert.equal(call.env.MPLCONFIGDIR, join(root, 'matplotlib'));
      assert.ok(call.argv.includes('-c'));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a failed environment probe never publishes a ready selection', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(packageDir, 'tests/.environment-test-'));
  try {
    const result = await createEnvironment({ host: processHost(root) }).inspect({ pythonPath: join(root, 'missing-python') });
    assert.equal(result.ready, false);
    await assert.rejects(readFile(join(root, 'environment.json')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
