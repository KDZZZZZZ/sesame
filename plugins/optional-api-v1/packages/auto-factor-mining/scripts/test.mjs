import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const loader = process.env.SESAME_PLUGIN_SDK_LOADER;
if (!loader) throw new Error('Set SESAME_PLUGIN_SDK_LOADER to the matching public SDK loader URL. No private host implementation is copied.');

const tests = readdirSync(join(root, 'tests'), { withFileTypes: true });
const files = pattern => tests.filter(entry => entry.isFile() && pattern.test(entry.name)).map(entry => join(root, 'tests', entry.name)).sort();
const nodeTests = files(/\.test\.js$/);
if (!nodeTests.length) throw new Error('No package JavaScript tests found');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!process.env.PYTHON) console.warn('PYTHON is not set: Python-backed numerical tests and standalone Python suites will be skipped. Set PYTHON to the verified private interpreter for numerical validation.');
run(process.execPath, [`--import=${loader}`, '--test', ...nodeTests]);

if (process.env.PYTHON) {
  // compute_python.py is already exercised by compute.test.js.
  for (const file of files(/_test\.py$/)) run(process.env.PYTHON, ['-I', '-B', file]);
}
