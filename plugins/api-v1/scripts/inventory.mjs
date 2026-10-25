import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLock, readProfile } from './plugin-lock.mjs';
import { FUNCTIONAL_CATEGORIES, IMPLEMENTATION_KINDS, validateInventoryPolicy, deriveImplementationKinds } from './plugin-taxonomy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function buildInventory(directory = root) {
  const policy = JSON.parse(readFileSync(join(directory, 'inventory-policy.json'))), entries = [];
  const distributions = [directory, resolve(directory, '../optional-api-v1')].map(source => ({ source, profile: readProfile(source), lock: buildLock(source) }));
  validateInventoryPolicy(policy, distributions.flatMap(({ lock }) => lock.packages.map(pkg => pkg.directory)));
  for (const { source, profile, lock } of distributions) {
    for (const pkg of lock.packages) {
      const manifest = JSON.parse(readFileSync(join(source, 'packages', pkg.directory, 'plugin.json')));
      const declared = JSON.parse(readFileSync(join(source, 'packages', pkg.directory, manifest.capability_manifest)));
      entries.push({ id: pkg.id, version: pkg.version, distribution: profile.kind, state: manifest.default_state, engines: manifest.engines,
        format: manifest.execution === 'mcp' ? 'sesame-mcp' : 'sesame-native', license: manifest.license, author: manifest.author ?? { name: 'Sesame contributors' },
        ...policy[pkg.directory], implementationKinds: deriveImplementationKinds(manifest, declared, pkg.files.map(file => file.path), policy[pkg.directory]),
        permissions: manifest.permissions ?? { scopes: [], calls: [] },
        tools: declared.capabilities.filter(capability => capability.consumers.includes('agent')).map(capability => capability.id),
        capabilities: declared.capabilities.map(({id,kind,consumers,execution}) => ({id,kind,consumers,execution})),
        hostContributions: Object.fromEntries(['sources','views','services','hooks'].map(kind => [kind, declared[kind].map(({id,contract,operations}) => ({id,contract,operations}))])),
        sourcePath: `plugins/${profile.kind === 'core' ? 'api-v1' : 'optional-api-v1'}/packages/${pkg.directory}` });
    }
  }
  return { schemaVersion: 1, apiVersion: '2', status: 'descriptive-inventory', application: { minimum: '0.2.0', engines: { sesame: '>=0.2.0-0' } },
    notice: 'This descriptive inventory is not an installation catalog. application.minimum is the distribution profile floor, not a promise that every package supports that host; honor each package engines range. It has no source commits or package digests. Installable entries are generated separately only from fixed, actually published releases.',
    taxonomy: { functionalCategories: FUNCTIONAL_CATEGORIES, implementationKinds: IMPLEMENTATION_KINDS },
    packages: entries.sort((a, b) => a.id < b.id ? -1 : 1) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = JSON.stringify(buildInventory(), null, 2) + '\n', path = join(root, 'inventory.json');
  if (process.argv.includes('--write')) writeFileSync(path, text);
  else if (readFileSync(path, 'utf8') !== text) throw new Error('Descriptive inventory differs from current reviewed sources');
  const inventory = JSON.parse(text);
  console.log(`Validated descriptive inventory: ${inventory.packages.filter(p => p.distribution === 'core').length} core + ${inventory.packages.filter(p => p.distribution === 'optional').length} optional; no install authority`);
}
