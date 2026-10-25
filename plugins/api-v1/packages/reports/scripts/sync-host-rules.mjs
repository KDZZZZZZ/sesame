import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Build-time only: an installed report package never imports another checkout.
export async function syncHostRules(hostRoot, { check = false, packageRoot = fileURLToPath(new URL('../', import.meta.url)) } = {}) {
  if (!hostRoot) throw new Error('Usage: node scripts/sync-host-rules.mjs --host <host-source-root> [--check]');
  const shared = join(resolve(hostRoot), 'modules/shared');
  const { reportEditorialCss } = await import(pathToFileURL(join(shared, 'report-theme.js')).href);
  const read = path => readFile(path, 'utf8');
  const files = new Map();
  for (const name of ['report-export-contract.js', 'report-html.js']) files.set(join(packageRoot, 'shared', name), await read(join(shared, name)));
  files.set(join(packageRoot, 'assets/editorial.css'), reportEditorialCss(
    await read(join(hostRoot, 'modules/frontend/report-runtime/theme.css')),
    await read(join(hostRoot, 'modules/frontend/report-runtime/report.css')),
    await read(join(packageRoot, 'assets/editorial-extra.css')),
  ));
  const changed = [];
  for (const [path, expected] of files) {
    let actual; try { actual = await read(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (actual === expected) continue;
    changed.push(path);
    if (!check) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, expected); }
  }
  if (check && changed.length) throw new Error(`Report shared rules drifted:\n${changed.join('\n')}`);
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--host'), host = at >= 0 ? process.argv[at + 1] : undefined;
  const changed = await syncHostRules(host, { check: process.argv.includes('--check') });
  console.log(process.argv.includes('--check') ? 'Report shared rules match the host source.' : `Updated ${changed.length} report shared files.`);
}
