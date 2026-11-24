#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRepository } from '../.github/scripts/validate-catalog.mjs';
import { scaffold, writeDraft } from '../plugins/api-v1/packages/plugin-manager/scaffold.js';
import { buildInventory } from '../plugins/api-v1/scripts/inventory.mjs';
import { buildLock, packageDirectories } from '../plugins/api-v1/scripts/plugin-lock.mjs';
import { buildSurfaceLock, parseYaml, readSurfaceFiles, writeYaml } from '../plugins/protocol/directory.mjs';
import { verifyCases } from '../plugins/protocol/evaluation/verify-cases.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const profiles = ['api-v1', 'optional-api-v1'];
const help = `Usage: node scripts/plugin.mjs <command>
  new <slug|publisher/slug> [--type knowledge|function|adapter|workflow] [--publisher <name>]
  sync
  check [--fix]
  release --pr <dev-to-main-PR-number> [--include <publisher/slug>]...
New contributors default to the local publisher and a knowledge plugin in plugins/optional-api-v1/packages/.`;

const starters = {
  knowledge: ['analysis', 'Knowledge method', '知识方法', 'Read the method, its evidence and limitations.', '阅读本方法、所需证据和适用边界。'],
  function: ['analysis', 'Calculation', '计算工具', 'Calculate the finite sum of supplied numbers.', '计算输入数值的有限和。'],
  adapter: ['integration', 'Source adapter', '来源适配器', 'Starter for implementing a source adapter.', '用于实现外部来源适配器的起点。'],
  workflow: ['business', 'Workflow', '工作流', 'Starter for implementing a host-managed workflow.', '用于实现宿主管理的工作流的起点。'],
};
const json = value => JSON.stringify(value, null, 2) + '\n';

function profilePaths(root) {
  const paths = profiles.map(name => join(root, 'plugins', name));
  for (const dir of [join(root, 'plugins'), ...paths, ...paths.map(path => join(path, 'packages'))]) {
    if (!lstatSync(dir).isDirectory()) throw new Error('Expected a regular directory: ' + dir);
  }
  return paths;
}

async function newPlugin(root, id, publisherOption, type = 'knowledge') {
  if (!Object.hasOwn(starters, type)) throw new Error('Unknown plugin type: ' + type);
  const parts = id.split('/');
  if (parts.length > 2 || (parts.length === 2 && publisherOption !== undefined)) {
    throw new Error('Give the publisher in the package ID or with --publisher, once.');
  }
  const name = parts.at(-1), publisher = parts.length === 2 ? parts[0] : publisherOption ?? 'local';
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Package directory must be a lowercase slug starting with a letter.');
  const [category, en, zh, summary, summaryZh] = starters[type];
  const recipe = scaffold({ name, publisher, template: type, description: summary });
  const paths = profilePaths(root);
  if (publisher === 'sesame' && lstatSync(join(paths[0], 'packages', name), { throwIfNoEntry: false })) {
    throw new Error('Core already contains this package: ' + recipe.id);
  }

  const files = recipe.files, manifest = parseYaml(files['plugin.yaml']);
  manifest.license = 'UNLICENSED';
  manifest['x-sesame'].catalog = {
    functionalCategory: category,
    title: { en: name + ' ' + en, zh: name + ' ' + zh },
    summary: { en: summary, zh: summaryZh },
  };
  files['plugin.yaml'] = writeYaml(manifest);
  files['package.json'] = json({ ...JSON.parse(files['package.json']), license: manifest.license });
  files.LICENSE = 'All rights reserved. Select a redistribution license before publication.\n';
  files['evals/cases/discovery.yaml'] = writeYaml({
    id: name + '-discovery', environment: { mode: 'replay' },
    steps: [{ operation: 'server/discover' }],
    expect: [{ step: 0, pointer: '/serverInfo/name', equals: recipe.id }],
  });
  files['surface.lock.json'] = json(buildSurfaceLock(files));
  return writeDraft(join(paths[1], 'packages', name), recipe);
}

// Replace derived files only when their canonical bytes changed. A failed
// write or interrupted sync never leaves a truncated lock behind.
function writeGenerated(path, value) {
  const bytes = Buffer.from(json(value)), stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error('Expected an ordinary generated file: ' + path);
  if (stat && readFileSync(path).equals(bytes)) return 0;
  const temp = join(dirname(path), '.plugin-sync-' + randomUUID());
  try {
    writeFileSync(temp, bytes, { flag: 'wx' });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  return 1;
}

export function syncPlugins(root) {
  const sources = profilePaths(root);
  let changed = 0;
  for (const source of sources) {
    for (const name of packageDirectories(source)) {
      const dir = join(source, 'packages', name);
      changed += writeGenerated(join(dir, 'surface.lock.json'), buildSurfaceLock(readSurfaceFiles(dir)));
    }
  }
  const locks = sources.map(source => buildLock(source));
  const inventory = buildInventory(sources[0]);
  for (const [i, source] of sources.entries()) changed += writeGenerated(join(source, 'official-plugins.lock.json'), locks[i]);
  changed += writeGenerated(join(sources[0], 'inventory.json'), inventory);
  return { packages: inventory.packages.length, changed };
}

export async function main(argv, root = repository) {
  const [command, ...args] = argv;
  if (!command || ['-h', '--help', 'help'].includes(command) || args.length === 1 && args[0] === '--help') return help;
  if (command === 'new') {
    const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { type: { type: 'string' }, publisher: { type: 'string' } } });
    if (positionals.length !== 1) throw new Error('new requires exactly one package slug.');
    const result = await newPlugin(root, positionals[0], values.publisher, values.type);
    return 'Created ' + result.id + ' in ' + result.path + '\nEdit the plugin, then run node scripts/plugin.mjs check --fix.';
  }
  if (command === 'sync' && args.length === 0) return syncPlugins(root);
  if (command === 'check') {
    const { values } = parseArgs({ args, options: { fix: { type: 'boolean' } } });
    if (values.fix) syncPlugins(root);
    return { ...validateRepository(root), evaluation: verifyCases(root) };
  }
  if (command === 'release') {
    const { values } = parseArgs({ args, options: { pr: { type: 'string' }, include: { type: 'string', multiple: true } } });
    if (!/^[1-9][0-9]*$/.test(values.pr ?? '') || !Number.isSafeInteger(Number(values.pr))) {
      throw new Error('release requires --pr <positive dev-to-main PR number>.');
    }
    const { generateR2Plan } = await import('../.github/scripts/plugin-r2.mjs');
    const { path, plan } = generateR2Plan(root, Number(values.pr), { include: values.include });
    return {
      path, id: plan.id, sourceCommit: plan.sourceCommit, pullRequest: plan.pullRequest,
      include: values.include ?? [],
      profiles: plan.profiles.map(({ profile, packages, archiveSha256, lockSha256 }) => ({
        profile, packages: packages.length, archiveSha256, lockSha256,
      })),
    };
  }
  throw new Error(help);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await main(process.argv.slice(2));
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
