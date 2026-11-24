import {readPackageDirectory} from '../../protocol/directory.mjs';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../packages/', import.meta.url);
// Exercise every source capability, including multiple independent methods in
// a merged package. Bundle/catalog consistency has its own repository checks.
export const abuPackages = await Promise.all((await readdir(root)).filter(name => name.startsWith('abu-')).sort().map(async directory => {
  const base = new URL(directory + '/', root);
  const manifest = readPackageDirectory(new URL('.', base)).manifest;
  const declaration = readPackageDirectory(new URL('.', base)).capabilities;
  return { id: manifest.id, directory, title: manifest.title,
    cases: declaration.capabilities.map(capability => ({ id: manifest.id, directory, tool: capability.binding.name,
      example: capability.id === 'abu_trade_results_audit' ? 'examples/audit-input.json' : 'examples/input.json',
      module: capability.id === 'abu_trade_results_audit' ? 'scripts/audit.mjs' : 'scripts/baseline.mjs' })) };
}));
export const abuCases = abuPackages.flatMap(item => item.cases);
