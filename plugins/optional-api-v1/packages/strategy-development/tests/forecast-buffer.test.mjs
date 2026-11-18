import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const python = process.env.SESAME_QUANT_PYTHON;
test('shipped forecast buffer replays with the existing native Backtrader runner', { skip: !python }, () => {
  const script = fileURLToPath(new URL('./forecast_buffer_cases.py', import.meta.url));
  const run = spawnSync(python, ['-I', '-B', script, '-v'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
