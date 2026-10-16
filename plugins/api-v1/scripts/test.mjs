import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url)), sdk = process.argv.includes('--sdk');
if (process.argv.includes('--python')) {
  const files = readdirSync(join(root, 'tests')).filter(name => /\.test\.py$/.test(name)).sort();
  let failed = false;
  for (const file of files) {
    const result = spawnSync(process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), ['-B', '-I', join(root, 'tests', file)], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    failed ||= result.status !== 0;
  }
  process.exit(failed ? 1 : 0);
}
const loader = process.env.SESAME_PLUGIN_SDK_LOADER;
if (sdk && !loader) throw new Error('test:sdk needs SESAME_PLUGIN_SDK_LOADER from the matching application SDK. No private implementation is copied into this repository.');
const files = readdirSync(join(root, 'tests')).filter(name => sdk ? /\.test\.(?:mjs|js)$/.test(name) : /\.test\.mjs$/.test(name)).sort().map(name => join(root, 'tests', name));
const result = spawnSync(process.execPath, [...sdk ? ['--import', loader] : [], '--test', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
