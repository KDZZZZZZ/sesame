import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLock, readProfile } from './plugin-lock.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function buildInventory(directory = root) {
  const policy = JSON.parse(readFileSync(join(directory, 'inventory-policy.json'))), entries = [];
  for (const source of [directory, resolve(directory, '../optional-api-v1')]) {
    const profile = readProfile(source), lock = buildLock(source);
    for (const pkg of lock.packages) {
      const manifest = JSON.parse(readFileSync(join(source, 'packages', pkg.directory, 'plugin.json'))), extension = manifest.extensions?.['bot.sesame'];
      if (!policy[pkg.directory]) throw new Error(`Missing reviewed package explanation: ${pkg.id}`);
      const standard = Boolean(manifest.$schema), names = standard ? Object.values(JSON.parse(readFileSync(join(source, 'packages', pkg.directory, extension.builtin.tool_definitions)))).flat().map(tool => tool.name) : manifest.tool_names;
      entries.push({ id: pkg.id, version: pkg.version, distribution: profile.kind, state: standard ? extension.builtin.default_state : manifest.default_state, engines: extension?.engines ?? manifest.engines,
        format: standard ? 'agent-plugins' : 'sesame-native', license: manifest.license, author: manifest.author ?? { name: 'Sesame contributors' },
        ...policy[pkg.directory], tools: names, sourcePath: `plugins/${profile.kind === 'core' ? 'api-v1' : 'optional-api-v1'}/packages/${pkg.directory}` });
    }
  }
  if (entries.length !== Object.keys(policy).length) throw new Error('Inventory policy contains absent packages');
  return { schemaVersion: 1, apiVersion: '1', status: 'unreleased-candidate', application: { minimum: '0.2.0', engines: { sesame: '>=0.2.0-0' }, released: false },
    notice: 'This source preview is not an installation catalog. It has no source commits or package digests. Installable entries are generated separately only from fixed, actually published releases.',
    packages: entries.sort((a, b) => a.id < b.id ? -1 : 1) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = JSON.stringify(buildInventory(), null, 2) + '\n', path = join(root, 'inventory.json');
  if (process.argv.includes('--write')) writeFileSync(path, text);
  else if (readFileSync(path, 'utf8') !== text) throw new Error('Preview inventory differs from current reviewed sources');
  console.log('Validated candidate inventory: 9 core + 10 optional; no install authority');
}
