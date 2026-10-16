import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
