import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, treeDigest, safePath, validateCatalog } from './validate-catalog.mjs';

const root = resolve(process.env.CATALOG_ROOT || '.');
const original = JSON.parse(readFileSync(resolve(root,'plugins/catalog.json')));
const readPackage = p => new Map(p.package.files.map(f=>[f.path,readFileSync(resolve(root,p.source.path,f.path))]));
test('published packages match source files',()=>{ assert.equal(validateCatalog(original,readPackage).plugins,original.plugins.length); });
test('tree digest uses the app protocol including prefixed inner digests',()=>{
  const files=[{path:'b',sha256:hash('two')},{path:'a',sha256:hash('one')}];
  assert.equal(treeDigest(files),hash(JSON.stringify([['a',`sha256:${hash('one')}`],['b',`sha256:${hash('two')}`]])));
});
test('paths reject traversal, absolute paths, hidden files and separators',()=>{
  for(const path of ['../secret','/tmp/x','x/../secret','x\\y','.env','a//b','a/%2e%2e/b']) assert.equal(safePath(path),false,path);
  assert.equal(safePath('skills/example/SKILL.md'),true);
});
for (const [name,mutate] of [
  ['tampered bytes', p=>p.package.files[0].sha256='0'.repeat(64)],
  ['floating source', p=>p.source.commit='main'],
  ['duplicate files',p=>p.package.files.push(p.package.files[0])],
  ['path traversal',p=>p.package.files[0].path='../secret'],
  ['forged human approval',p=>p.review.human='approved'],
  ['missing author',p=>p.author=null],
  ['host factory as installable',p=>p.kind='installable']
]) test(`rejects ${name}`,()=>{ const c=structuredClone(original); mutate(c.plugins.find(p=>p.kind==='bundled')); assert.throws(()=>validateCatalog(c,readPackage)); });
test('package bytes cannot be substituted even with the declared size',()=>{
  const changed = p=>{const data=readPackage(p); const path=p.package.files[0].path; data.set(path,Buffer.alloc(data.get(path).length)); return data;};
  assert.throws(()=>validateCatalog(original,changed),/source hash mismatch/);
});

function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, '-c', 'core.autocrlf=false', '-c', 'user.name=Catalog test', '-c', 'user.email=catalog-test@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const writeCatalog = (directory, catalog) => writeFileSync(resolve(directory, 'plugins/catalog.json'), JSON.stringify(catalog));
function recordFiles(directory, plugin) {
  plugin.package.files = ['plugin.json', 'LICENSE', 'PROVENANCE.md'].map(path => {
    const bytes = readFileSync(resolve(directory, plugin.source.path, path));
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  });
  plugin.package.treeDigest = treeDigest(plugin.package.files);
}
function repositoryFixture(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'sesame-catalog-history-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const upstream = resolve(directory, 'upstream');
  mkdirSync(upstream);
  git(upstream, 'init', '--quiet');
  const catalog = structuredClone(original);
  catalog.plugins = catalog.plugins.filter(p => p.kind === 'bundled').slice(0, 2);
  assert.equal(catalog.plugins.length, 2);
  for (const plugin of catalog.plugins) {
    const packageRoot = resolve(upstream, plugin.source.path);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(resolve(packageRoot, 'plugin.json'), JSON.stringify({ name: plugin.name, version: plugin.version }));
    writeFileSync(resolve(packageRoot, 'LICENSE'), 'Test fixture license\n');
    writeFileSync(resolve(packageRoot, 'PROVENANCE.md'), 'Test fixture provenance\n');
    plugin.review = { automated: 'catalog-ci', human: 'not-recorded' };
    recordFiles(upstream, plugin);
  }
  git(upstream, 'add', '.');
  git(upstream, 'commit', '--quiet', '-m', 'Fixture package bytes');
  const sourceSha = git(upstream, 'rev-parse', 'HEAD');
  for (const plugin of catalog.plugins) plugin.source.commit = sourceSha;
  writeCatalog(upstream, catalog);
  git(upstream, 'add', '.');
  git(upstream, 'commit', '--quiet', '-m', 'Fixture catalog');
  return { directory, upstream, catalog, sourceSha, baseSha: git(upstream, 'rev-parse', 'HEAD') };
}
function checkRepository(directory, baseSha) {
  const env = { ...process.env };
  if (baseSha === undefined) delete env.CATALOG_BASE_SHA;
  else env.CATALOG_BASE_SHA = baseSha;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./validate-catalog.mjs', import.meta.url)), directory], { encoding: 'utf8', env });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

test('history supports explicit initial branches, normal pushes and manual checks', t => {
  const { upstream, baseSha } = repositoryFixture(t);
  git(upstream, 'commit', '--quiet', '--allow-empty', '-m', 'Ordinary push');
  for (const baseline of [undefined, '', '0'.repeat(40), baseSha, git(upstream, 'rev-parse', 'HEAD')]) {
    const result = checkRepository(upstream, baseline);
    assert.equal(result.status, 0, result.output);
  }
});
test('an invalid or unavailable explicit baseline cannot skip history', t => {
  const { upstream } = repositoryFixture(t);
  for (const baseline of ['main', 'f'.repeat(40)]) {
    const result = checkRepository(upstream, baseline);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /catalog baseline/i);
  }
});
test('an existing baseline without a catalog is rejected', t => {
  const { upstream, sourceSha } = repositoryFixture(t);
  const result = checkRepository(upstream, sourceSha);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /catalog baseline/i);
});
test('invalid historical catalog JSON is rejected', t => {
  const { upstream, catalog } = repositoryFixture(t);
  writeFileSync(resolve(upstream, 'plugins/catalog.json'), '{');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '--quiet', '-m', 'Broken historical catalog');
  const baseline = git(upstream, 'rev-parse', 'HEAD');
  writeCatalog(upstream, catalog);
  const result = checkRepository(upstream, baseline);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /catalog baseline/i);
});
test('removing a published entry requires a withdrawn tombstone', t => {
  const { upstream, catalog, baseSha } = repositoryFixture(t);
  catalog.plugins.pop();
  writeCatalog(upstream, catalog);
  const result = checkRepository(upstream, baseSha);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /keep a withdrawn tombstone/);
});
test('valid new source hashes still require a new package version', t => {
  const { upstream, catalog, baseSha } = repositoryFixture(t);
  const plugin = catalog.plugins[0];
  writeFileSync(resolve(upstream, plugin.source.path, 'LICENSE'), 'Updated test fixture license\n');
  recordFiles(upstream, plugin);
  git(upstream, 'add', '.');
  git(upstream, 'commit', '--quiet', '-m', 'Changed package bytes');
  plugin.source.commit = git(upstream, 'rev-parse', 'HEAD');
  writeCatalog(upstream, catalog);
  const result = checkRepository(upstream, baseSha);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /changed source requires a new version/);
});
test('a fork missing the latest upstream base fails until fetched and still rejects removal', t => {
  const { directory, upstream, catalog } = repositoryFixture(t);
  const candidate = resolve(directory, 'candidate');
  git(directory, 'clone', '--quiet', '--no-local', upstream, candidate);
  git(upstream, 'commit', '--quiet', '--allow-empty', '-m', 'New upstream baseline');
  const baseline = git(upstream, 'rev-parse', 'HEAD');
  let result = checkRepository(candidate, baseline);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /catalog baseline/i);
  git(candidate, 'fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', upstream, baseline);
  result = checkRepository(candidate, baseline);
  assert.equal(result.status, 0, result.output);
  catalog.plugins.pop();
  writeCatalog(candidate, catalog);
  result = checkRepository(candidate, baseline);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /keep a withdrawn tombstone/);
});
test('workflow fetches the event baseline from fixed upstream without running candidate code', () => {
  const workflow = readFileSync(new URL('../workflows/plugin-catalog.yml', import.meta.url), 'utf8');
  assert.match(workflow, /CATALOG_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \|\| github\.sha \}\}/);
  assert.match(workflow, /git -C candidate -c core\.hooksPath=\/dev\/null fetch --no-tags --no-recurse-submodules --no-write-fetch-head https:\/\/github\.com\/KDZZZZZZ\/sesame\.git "\$CATALOG_BASE_SHA"/);
  assert.match(workflow, /cat-file -e "\$\{CATALOG_BASE_SHA\}\^\{commit\}"/);
  assert.doesNotMatch(workflow, /\b(?:node|npm|bash|sh|python3?)\s+(?:\.\/)?candidate\//);
  assert.doesNotMatch(workflow, /contents: write|persist-credentials: true/);
});
