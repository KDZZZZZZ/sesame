import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reuse the exact runtime already installed by the market workbench, offline.
const at = process.argv.indexOf('--host');
if (at < 0 || !process.argv[at + 1]) throw Error('Usage: node scripts/sync-market-chart.mjs --host <host-root> [--check]');
const upstream = join(resolve(process.argv[at + 1]), 'node_modules/lightweight-charts');
const target = fileURLToPath(new URL('../assets/vendor/', import.meta.url));
const { version } = JSON.parse(await readFile(join(upstream, 'package.json'), 'utf8'));
const files = new Map([
  ['lightweight-charts.js', await readFile(join(upstream, 'dist/lightweight-charts.standalone.production.js'))],
  ['lightweight-charts-LICENSE', await readFile(join(upstream, 'LICENSE'))],
  ['lightweight-charts.json', Buffer.from(JSON.stringify({ name: 'lightweight-charts', version, license: 'Apache-2.0', source: 'https://github.com/tradingview/lightweight-charts', distribution: 'dist/lightweight-charts.standalone.production.js' }, null, 2) + '\n')],
]);
for (const [name, expected] of files) {
  const path = join(target, name);
  let actual; try { actual = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (actual?.equals(expected)) continue;
  if (process.argv.includes('--check')) throw Error(`Market chart runtime drifted: ${name}`);
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, expected);
}
console.log(`Report candles reuse Lightweight Charts ${version} from the market workbench.`);
