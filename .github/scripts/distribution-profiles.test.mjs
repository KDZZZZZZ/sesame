import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildLock, readProfile, createArchive, sha256 } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { prepareRelease } from './release-plugins.mjs';
const lockBytes = lock => Buffer.from(JSON.stringify(lock, null, 2) + "\n");
function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'sesame-profile-infra-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const root = join(repo, 'plugins/api-v1'), pkg = join(root, 'packages/example'); mkdirSync(pkg, { recursive: true });
  const manifest = { id:'sesame/example',apiVersion:'1',version:'1.0.0',license:'MIT',default_state:'mounted',tool_names:[],tool_definitions:'tools.json',engines:{sesame:'>=0.2.0-0'} };
  const json=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
  json(join(pkg,'plugin.json'),manifest); json(join(pkg,'package.json'),{version:'1.0.0',type:'module',license:'MIT'}); json(join(pkg,'tools.json'),[]); writeFileSync(join(pkg,'LICENSE'),'MIT test fixture');
  const profile={schemaVersion:1,kind:'core',engines:manifest.engines,packages:[manifest.id]};json(join(root,'bundle-profile.json'),profile);
  const git = (...args) => execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
  git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  const lock=buildLock(root);writeFileSync(join(root,'official-plugins.lock.json'),lockBytes(lock));git('add','.');git('commit','-qm','fixed source');
  const plan={schemaVersion:1,sourceCommit:git('rev-parse','HEAD'),sourceRoot:'plugins/api-v1',profile:'core',tag:'plugins-api-v1-dev.99',title:'Fixture',archive:{name:'sesame-official-plugins-api-v1-dev.99.tar.gz',sha256:sha256(createArchive(root,lock))},lockSha256:sha256(lockBytes(lock)),pullRequest:999};
  return {repo,root,pkg,json,manifest,profile,plan};
}
test('fixed source profile is materialized and required by release reconstruction',t=>{
  const f=fixture(t);assert.equal(prepareRelease(f.repo,f.plan).pin.packages.length,1);
  assert.throws(()=>prepareRelease(f.repo,{...f.plan,profile:undefined}),/profile/);
  assert.throws(()=>prepareRelease(f.repo,{...f.plan,profile:'optional'}),/profile/);
});
test('data-only validation rejects altered engines, membership, activation and legacy grants',t=>{
  const f=fixture(t);assert.equal(buildLock(f.root).packages.length,1);
  for(const engines of [undefined,{sesame:'>=0.1.4'}]){f.json(join(f.pkg,'plugin.json'),{...f.manifest,engines});assert.throws(()=>buildLock(f.root),/engine/);}
  f.json(join(f.pkg,'plugin.json'),{...f.manifest,migration:{collections:['old']}});assert.throws(()=>buildLock(f.root),/legacy/);
  f.json(join(f.pkg,'plugin.json'),f.manifest);
  f.json(join(f.root,'bundle-profile.json'),{...f.profile,kind:'optional'});assert.throws(()=>buildLock(f.root),/default state/);
  f.json(join(f.root,'bundle-profile.json'),{...f.profile,packages:['sesame/other']});assert.throws(()=>buildLock(f.root),/Package set/);
  f.json(join(f.root,'bundle-profile.json'),f.profile);writeFileSync(join(f.pkg,'index.js'),'host.storage.legacy.list("old")');assert.throws(()=>buildLock(f.root),/private storage/);
});
test('historical sources without profiles retain legacy semantics',t=>{
  const f=fixture(t);rmSync(join(f.root,'bundle-profile.json'));f.json(join(f.pkg,'plugin.json'),{...f.manifest,engines:undefined,migration:{collections:['old']}});
  assert.equal(readProfile(f.root),null);assert.equal(buildLock(f.root).packages.length,1);
});
