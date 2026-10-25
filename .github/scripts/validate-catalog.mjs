// Trusted API 2 validation. The candidate tree supplies data, never executable validators.
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLock, readProfile } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { buildInventory } from '../../plugins/api-v1/scripts/inventory.mjs';
import { validateInventoryPolicy } from '../../plugins/api-v1/scripts/plugin-taxonomy.mjs';
import { checkR2Plans } from './plugin-r2.mjs';
import { validateApplicationPlan } from './release-application.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function dataFile(root, path) {
  const parts = path.split('/');
  for (let length = 1; length <= parts.length; length++) {
    const stat = lstatSync(join(root, ...parts.slice(0, length)));
    check(!stat.isSymbolicLink() && (length === parts.length ? stat.isFile() && stat.nlink === 1 : stat.isDirectory()), `Required current metadata must use ordinary files and directories: ${path}`);
  }
  return readFileSync(join(root, path));
}

export function validateRepository(repository) {
  const root = resolve(repository), counts = {}, packageNames = [];
  for (const [directory, kind] of [['api-v1', 'core'], ['optional-api-v1', 'optional']]) {
    const prefix = `plugins/${directory}`;
    dataFile(root, `${prefix}/bundle-profile.json`);
    const committed = dataFile(root, `${prefix}/official-plugins.lock.json`);
    check(readProfile(join(root, prefix))?.kind === kind, `Current ${kind} source requires its matching distribution profile`);
    const lock = buildLock(join(root, prefix));
    check(lock.apiVersion === '2' && committed.equals(jsonBytes(lock)), `Current ${kind} source lock differs from API 2 package bytes`);
    counts[kind] = lock.packages.length;
    packageNames.push(...lock.packages.map(pkg => pkg.directory));
  }
  const policy = JSON.parse(dataFile(root, 'plugins/api-v1/inventory-policy.json'));
  validateInventoryPolicy(policy, packageNames);
  for (const [name, entry] of Object.entries(policy)) {
    check(/^[a-z][a-z0-9-]*$/.test(name) && object(entry), 'Invalid inventory policy entry');
    for (const field of ['title', 'summary', 'dependencies']) {
      check(object(entry[field]) && Object.keys(entry[field]).sort().join(',') === 'en,zh' && ['en', 'zh'].every(language => typeof entry[field][language] === 'string' && entry[field][language].trim() && entry[field][language].length <= 2000), `${name}: ${field} requires explicit English and Chinese descriptions`);
    }
  }
  const inventory = buildInventory(join(root, 'plugins/api-v1'));
  check(dataFile(root, 'plugins/api-v1/inventory.json').equals(jsonBytes(inventory)), 'Descriptive inventory differs from current API 2 package facts');
  // A new root needs no old commits or GitHub plugin releases. New R2 plans,
  // when present, still reconstruct their exact Git source and verify every digest.
  const r2 = checkR2Plans(root);
  const application = validateApplicationPlan(JSON.parse(dataFile(root, '.github/application-release.json')));
  return { apiVersion: '2', packages: counts, inventory: inventory.packages.length, r2Plans: r2.plans,
    application: { tag: application.tag, assets: application.assets.length }, remoteChecked: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  check(process.argv.length <= 3, 'Use validate-catalog.mjs [repository]');
  console.log(JSON.stringify(validateRepository(process.argv[2] ?? '.')));
}
