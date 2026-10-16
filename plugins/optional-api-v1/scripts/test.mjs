import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.argv.includes('--python');
const pattern = python ? /(?:\.test|_test)\.py$/ : /\.test\.(?:js|mjs)$/;
const files = [];
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error('Tests must be ordinary repository files');
    if (entry.isDirectory()) scan(join(directory, entry.name));
    else if (pattern.test(entry.name)) files.push(join(directory, entry.name));
  }
}
scan(join(root, 'tests'));
scan(join(root, 'packages'));
if (!files.length) throw new Error('No test files found');
if (python) {
  for (const file of files) {
    const result = spawnSync(process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), ['-B', '-I', file], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
} else {
  const loader = process.env.SESAME_PLUGIN_SDK_LOADER;
  if (!loader) throw new Error('Set SESAME_PLUGIN_SDK_LOADER to the matching public SDK. No private host implementation is copied.');
  const result = spawnSync(process.execPath, ['--import', loader, '--test', ...files], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
