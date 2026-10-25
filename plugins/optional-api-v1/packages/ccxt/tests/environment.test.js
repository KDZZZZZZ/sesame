import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { environment } from '../environment.js';

const python = process.env.SESAME_TEST_PYTHON ?? (process.platform === 'win32' ? 'python.exe' : 'python3');
const available = spawnSync(python, ['--version']).status === 0;
test('missing optional CCXT returns readiness instead of interrupting its calling run', { skip: !available }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ccxt-readiness-'));
  const controller = new AbortController();
  const exits = [];
  const host = {
    context: { storageRoot: directory, pythonPath: python },
    capabilities: { async invoke(id, input) {
      assert.equal(id, 'host.process.exec');
      // A clean Python environment with no site packages, without installing
      // or removing anything in the developer's environment.
      const result = spawnSync(input.argv[0], ['-S', ...input.argv.slice(1)], { cwd: input.cwd, encoding: 'utf8' });
      exits.push(result.status);
      if (result.error || result.status !== 0) {
        const error = Object.assign(new Error('Child process interrupted'), { code: 'PROCESS_EXIT' });
        controller.abort(error); throw error;
      }
      return { type: 'result', value: { exitCode: result.status, output: result.stdout } };
    } },
  };
  try {
    const result = await environment(host, { action: 'inspect', python_path: python }, controller.signal);
    assert.equal(result.ready, false);
    assert.equal(controller.signal.aborted, false);
    assert.ok(result.failures.length > 0);
    assert.ok(exits.length > 0);
    assert.ok(exits.every(code => code === 0));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
