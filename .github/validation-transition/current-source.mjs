// Only the two current-source checks dispatch here. Immutable JSON releases
// continue to use the original builders with their original byte formats.
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export { buildLock, readProfile } from './plugins/api-v1/scripts/plugin-lock.mjs';
export { buildInventory } from './plugins/api-v1/scripts/inventory.mjs';

export function usesYaml(source) {
  const packages = join(source, 'packages');
  if (!lstatSync(packages).isDirectory()) throw new Error('Package root must be an ordinary directory');
  return readdirSync(packages, { withFileTypes: true }).some(entry =>
    entry.isDirectory() && lstatSync(join(packages, entry.name, 'plugin.yaml'), { throwIfNoEntry: false }) !== undefined);
}
