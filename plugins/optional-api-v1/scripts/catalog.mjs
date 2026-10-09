import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLock } from '../../api-v1/scripts/plugin-lock.mjs';

const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), take = key => { const i = args.indexOf(key); return i === -1 ? undefined : args[i + 1]; };
const root = resolve(take('--source') ?? ownRoot), target = join(root, 'catalog.json');
const current = args.includes('--check') ? JSON.parse(readFileSync(target)) : null;
const commit = take('--source-commit') ?? current?.sourceCommit;
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A fixed 40-character public source commit is required');
const lock = buildLock(root);
const requirements = {
  akshare: 'Existing compatible native Python/AKShare is reused; explicit preparation can install a private dependency environment. Market endpoints may fail due to network or upstream restrictions. No streaming or trading.',
  qmt: 'Native Windows x64, compatible Python/XtQuant and an existing broker-authorized MiniQMT are required. No terminal download/start or trade action occurs on load. macOS/Linux are not QMT execution hosts.',
  vnpy: 'Native 64-bit Python 3.10–3.13 with vnpy 4.5.0 and vnpy_ctastrategy 1.4.1; inspect/reuse before explicit preparation. Fixed bars and authored Python run as the current user. Backtesting only; no gateway/account trading.',
};
const plugins = lock.packages.map(pkg => {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', pkg.directory, 'plugin.json')));
  return { id: pkg.id, name: pkg.directory, version: pkg.version, apiVersion: '1', format: 'sesame-native', title: manifest.title, description: manifest.description,
    license: manifest.license, author: { name: 'Sesame contributors', url: 'https://github.com/KDZZZZZZ/sesame' }, status: current?.plugins.find(entry => entry.id === pkg.id)?.status ?? 'active',
    source: { repository: 'https://github.com/KDZZZZZZ/sesame', commit, path: `plugins/optional-api-v1/packages/${pkg.directory}` },
    package: { treeDigest: pkg.treeDigest, files: pkg.files }, review: { automated: 'package-static-review', human: 'not-recorded', notes: 'Static identity, file and import-boundary checks are separate from behavior/environment tests. See package validation; this is not a safety certification.' },
    tools: manifest.tool_names, requirements: requirements[pkg.directory], documentationUrl: `https://github.com/KDZZZZZZ/sesame/blob/${commit}/plugins/optional-api-v1/packages/${pkg.directory}/README.md`, feedbackUrl: 'https://github.com/KDZZZZZZ/sesame/issues',
  };
});
const catalog = { schemaVersion: 1, apiVersion: '1', channel: 'development', sourceCommit: commit, plugins };
const text = JSON.stringify(catalog, null, 2) + '\n';
if (args.includes('--write')) writeFileSync(target, text);
else if (args.includes('--check')) { if (readFileSync(target, 'utf8') !== text) throw new Error('Optional catalog differs from fixed package metadata'); }
else throw new Error('Use --write --source-commit <sha> or --check');
console.log(`Validated ${plugins.length} optional API 1 catalog entries at ${commit}`);
