import {readPackageDirectory} from '../../protocol/directory.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLock, readProfile } from './plugin-lock.mjs';
import { FUNCTIONAL_CATEGORIES, IMPLEMENTATION_KINDS, validateInventoryPolicy, deriveImplementationKinds, packageCatalog } from './plugin-taxonomy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function buildInventory(directory = root) {
  const policy = JSON.parse(readFileSync(join(directory, 'inventory-policy.json'))), entries = [];
  const distributions = [directory, resolve(directory, '../optional-api-v1')].map(source => ({ source, profile: readProfile(source), lock: buildLock(source) }));
  const ids = new Set(), allowedFallbackNames = new Set(distributions.flatMap(({ profile, lock }) => [
    ...(profile.exclude ?? []), ...lock.packages.filter(pkg => pkg.id === `sesame/${pkg.directory}`).map(pkg => pkg.directory),
  ]));
  validateInventoryPolicy(policy, [...allowedFallbackNames], []);
  for (const { source, profile, lock } of distributions) {
    for (const pkg of lock.packages) {
      if (ids.has(pkg.id)) throw new Error(`Duplicate package identity across distributions: ${pkg.id}`);
      ids.add(pkg.id);
      const {manifest,capabilities:declared} = readPackageDirectory(join(source, 'packages', pkg.directory));
      const paths = pkg.files.map(file => file.path);
      const own = packageCatalog(manifest, declared, paths);
      const official = pkg.id === `sesame/${pkg.directory}`;
      const display = own ?? (official && Object.hasOwn(policy, pkg.directory) ? policy[pkg.directory] : undefined);
      if (!display) throw new Error(`Missing reviewed package explanation: ${pkg.id}. Declare x-sesame.catalog in plugin.yaml`);
      entries.push({ id: pkg.id, version: pkg.version, distribution: profile.kind, state: manifest.default_state, engines: manifest.engines,
        format: manifest.execution === 'mcp' ? 'sesame-mcp' : 'sesame-native', license: manifest.license, author: manifest.author ?? { name: 'Sesame contributors' },
        ...display,
        ...(display.functionalCategory ? { implementationKinds: own?.implementationKinds ?? deriveImplementationKinds(manifest, declared, paths, display), permissions: manifest.permissions ?? { scopes: [], calls: [] } } : {}),
        tools: declared.capabilities.filter(capability => capability.consumers.includes('agent')).map(capability => capability.id),
        capabilities: declared.capabilities.map(({id,kind,consumers,execution}) => ({id,kind,consumers,execution})),
        hostContributions: Object.fromEntries(['sources','views','services','hooks'].map(kind => [kind, declared[kind].map(({id,contract,operations}) => ({id,contract,operations}))])),
        sourcePath: `plugins/${profile.kind === 'core' ? 'api-v1' : 'optional-api-v1'}/packages/${pkg.directory}` });
    }
  }
  const taxonomy = entries.some(entry => Object.hasOwn(entry, 'functionalCategory'));
  return { schemaVersion: 1, apiVersion: '2', status: 'descriptive-inventory', application: { minimum: '0.2.0', engines: { sesame: '>=0.2.0-0' } },
    notice: taxonomy
      ? 'This descriptive inventory is not an installation catalog. application.minimum is the distribution profile floor, not a promise that every package supports that host; honor each package engines range. It has no source commits or package digests. Installable entries are generated separately only from fixed, actually published releases.'
      : 'This descriptive inventory is not an installation catalog. It has no source commits or package digests. Installable entries are generated separately only from fixed, actually published releases.',
    ...(taxonomy ? { taxonomy: { functionalCategories: FUNCTIONAL_CATEGORIES.filter(category => entries.some(entry => entry.functionalCategory === category.id)), implementationKinds: IMPLEMENTATION_KINDS } } : {}),
    packages: entries.sort((a, b) => a.id < b.id ? -1 : 1) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = JSON.stringify(buildInventory(), null, 2) + '\n', path = join(root, 'inventory.json');
  if (process.argv.includes('--write')) writeFileSync(path, text);
  else if (readFileSync(path, 'utf8') !== text) throw new Error('Descriptive inventory differs from current reviewed sources');
  const inventory = JSON.parse(text);
  console.log(`Validated descriptive inventory: ${inventory.packages.filter(p => p.distribution === 'core').length} core + ${inventory.packages.filter(p => p.distribution === 'optional').length} optional; no install authority`);
}
