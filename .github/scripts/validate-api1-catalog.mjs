import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLock, sha256 } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { validateCatalog, checkPublished } from '../../plugins/api-v1/scripts/catalog.mjs';
import { materializeSource } from './release-plugins.mjs';

export function validateOptionalCatalog(repository) {
  const root = join(repository, 'plugins/optional-api-v1');
  const catalog = JSON.parse(readFileSync(join(root, 'catalog.json')));
  const require = (test, message) => { if (!test) throw new Error(message); };
  require(catalog.schemaVersion === 1 && catalog.apiVersion === '1' && catalog.channel === 'development', 'Invalid optional catalog format');
  require(/^[a-f0-9]{40}$/.test(catalog.sourceCommit), 'Catalog requires an immutable commit');
  // This historical catalog pins released bytes, independently of the next
  // candidate source layout, package membership and version changes.
  const source = mkdtempSync(join(tmpdir(), 'sesame-optional-catalog-'));
  try {
    materializeSource(repository, { sourceRoot: 'plugins/optional-api-v1', sourceCommit: catalog.sourceCommit }, source);
    const lock = buildLock(source);
    require(Array.isArray(catalog.plugins) && catalog.plugins.length === lock.packages.length, 'Catalog package count differs');
    const ids = new Set();
    for (const entry of catalog.plugins) {
      const pkg = lock.packages.find(item => item.id === entry.id);
      require(pkg && !ids.has(entry.id), `Unknown or repeated catalog identity: ${entry.id}`); ids.add(entry.id);
      require(entry.version === pkg.version && entry.apiVersion === '1' && entry.format === 'sesame-native', `${entry.id}: manifest identity differs`);
      require(['active', 'withdrawn'].includes(entry.status), `${entry.id}: invalid publication status`);
      require(entry.source.repository === 'https://github.com/KDZZZZZZ/sesame' && entry.source.commit === catalog.sourceCommit && entry.source.path === `plugins/optional-api-v1/packages/${pkg.directory}`, `${entry.id}: unexpected source`);
      require(entry.package.treeDigest === pkg.treeDigest && JSON.stringify(entry.package.files) === JSON.stringify(pkg.files), `${entry.id}: locked files differ`);
      // Approval claims need a separate verifiable approval mechanism. These development
      // entries intentionally retain the honest, non-approval state.
      require(entry.review?.automated === 'package-static-review' && entry.review.human === 'not-recorded', `${entry.id}: unsupported review claim`);
      const manifest = JSON.parse(readFileSync(join(source, 'packages', pkg.directory, 'plugin.json')));
      require(entry.license === manifest.license && JSON.stringify(entry.tools) === JSON.stringify(manifest.tool_names), `${entry.id}: license or tools differ`);
      for (const file of pkg.files) {
        const bytes = execFileSync('git', ['show', `${catalog.sourceCommit}:${entry.source.path}/${file.path}`], { cwd: repository, maxBuffer: 3 * 1024 * 1024 });
        require(bytes.length === file.bytes && sha256(bytes) === file.sha256, `${entry.id}/${file.path}: immutable Git source differs`);
      }
    }
    return { packages: ids.size, sourceCommit: catalog.sourceCommit };
  } finally { rmSync(source, { recursive: true, force: true }); }
}

export function validateCatalogs(root) {
  for (const path of ['plugins/api-v1/catalog.json', 'plugins/optional-api-v1/official-plugins.lock.json']) {
    if (!existsSync(join(root, path))) throw new Error(`Required catalog input is missing: ${path}`);
  }
  return { optional: validateOptionalCatalog(root), unified: validateCatalog(root) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { optional, unified } = validateCatalogs(resolve(process.argv[2] ?? '.'));
  if (process.argv.includes('--published')) await checkPublished(unified);
  console.log(JSON.stringify({ optional, unified: { packages: unified.plugins.length, releases: unified.releases.map(item => item.tag), publishedChecked: process.argv.includes('--published') } }));
}
