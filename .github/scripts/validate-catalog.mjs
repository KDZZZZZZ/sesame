import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const treeDigest = files => hash(JSON.stringify([...files].sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(f => [f.path, `sha256:${f.sha256}`])));
export const safePath = p => typeof p === 'string' && p.length <= 240 && /^[A-Za-z0-9_./-]+$/.test(p) && !p.startsWith('/') && p.split('/').every(x => x && x !== '.' && x !== '..' && !x.startsWith('.'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const string = (x, max = 1000) => typeof x === 'string' && x.length > 0 && x.length <= max;
const sha = x => /^[a-f0-9]{64}$/.test(x || '');
const version = x => /^\d+\.\d+\.\d+$/.test(x || '');
const localized = x => object(x) && string(x.en,500) && string(x.zh,500);
const categories = ['research','data','workspace','strategy','mt5'];
const secret = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{25,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}|\/Users\/[A-Za-z0-9._-]+\//;

export function validateCatalog(catalog, readPackage) {
  assert(catalog.schemaVersion === 1, 'schemaVersion must be 1');
  assert(string(catalog.updatedAt) && !Number.isNaN(Date.parse(catalog.updatedAt)), 'updatedAt must be an ISO date');
  assert(Array.isArray(catalog.plugins) && catalog.plugins.length > 0 && catalog.plugins.length <= 2000, 'invalid plugins list');
  const ids = new Set(), paths = new Set();
  for (const p of catalog.plugins) {
    assert(/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(p.id || ''), 'invalid plugin id');
    const label = p.id;
    assert(!ids.has(p.id), `${label}: duplicate id`); ids.add(p.id);
    assert(p.name === p.id.split('/')[1] && version(p.version), `${label}: invalid name/version`);
    assert(['bundled','installable'].includes(p.kind) && ['active','withdrawn'].includes(p.status), `${label}: invalid kind/status`);
    assert(localized(p.title) && localized(p.summary) && categories.includes(p.category), `${label}: invalid display metadata`);
    assert(object(p.author) && string(p.author.name,100) && /^https:\/\//.test(p.author.url || ''), `${label}: author required`);
    assert(string(p.license,100) && version(p.minAppVersion), `${label}: license and minAppVersion required`);
    assert(p.source?.repository === 'https://github.com/KDZZZZZZ/sesame' && /^[a-f0-9]{40}$/.test(p.source.commit || ''), `${label}: source must pin a public commit`);
    assert(safePath(p.source.path) && p.source.path.startsWith('plugins/packages/'), `${label}: unsafe source path`);
    assert(!paths.has(p.source.path), `${label}: duplicate package path`); paths.add(p.source.path);
    assert(p.bundledPluginId === undefined || /^[a-z0-9-]+$/.test(p.bundledPluginId), `${label}: invalid bundledPluginId`);
    if (p.kind === 'bundled') assert(p.id.startsWith('sesame/') && p.bundledPluginId === p.name, `${label}: bundled plugins must be official app plugins`);
    assert(p.review?.automated === 'catalog-ci', `${label}: automated review must point to CI, not a claimed safety grade`);
    assert(['not-recorded','approved'].includes(p.review.human), `${label}: invalid human review status`);
    if (p.review.human === 'approved') {
      assert(/^https:\/\/github\.com\/KDZZZZZZ\/sesame\/pull\/\d+#pullrequestreview-\d+$/.test(p.review.reference || ''), `${label}: human review requires an actual GitHub review reference`);
      assert(/^[a-f0-9]{40}$/.test(p.review.reviewedCommit || '') && string(p.review.reviewer,100), `${label}: reviewer and exact reviewed commit required`);
    }
    assert(Array.isArray(p.tools) && p.tools.every(x => string(x,100)), `${label}: tools required`);
    assert(localized(p.requirements) && /^https:\/\/github.com\/KDZZZZZZ\/sesame\/issues/.test(p.feedbackUrl || ''), `${label}: requirements/feedback required`);
    const files = p.package?.files;
    assert(Array.isArray(files) && files.length > 0 && files.length <= 256, `${label}: invalid file manifest`);
    let total = 0; const names = new Set();
    for (const f of files) {
      assert(safePath(f.path) && !names.has(f.path), `${label}: unsafe or duplicate file path`); names.add(f.path);
      assert(sha(f.sha256) && Number.isInteger(f.bytes) && f.bytes >= 0 && f.bytes <= 2*1024*1024, `${label}: invalid hash/size`); total += f.bytes;
    }
    assert(total <= 16*1024*1024, `${label}: package too large`);
    assert(sha(p.package.treeDigest) && treeDigest(files) === p.package.treeDigest, `${label}: invalid tree digest`);
    assert(names.has('plugin.json') && names.has('LICENSE') && [...names].some(x=>x.endsWith('PROVENANCE.md')), `${label}: manifest, license and provenance required`);
    const data = readPackage(p);
    assert(data.size === files.length, `${label}: undeclared or missing source files`);
    for (const f of files) {
      const bytes = data.get(f.path);
      assert(bytes && bytes.length === f.bytes && hash(bytes) === f.sha256, `${label}: source hash mismatch for ${f.path}`);
      assert(Buffer.from(bytes.toString('utf8'),'utf8').equals(bytes) && !bytes.includes(0), `${label}: only UTF-8 text files are supported`);
      assert(!secret.test(bytes.toString('utf8')), `${label}: possible secret or personal path in ${f.path}`);
    }
    const manifest = JSON.parse(data.get('plugin.json'));
    assert((manifest.name || manifest.id) === p.name && manifest.version === p.version, `${label}: manifest identity mismatch`);
    if (p.kind === 'installable') {
      assert(manifest.name && !manifest.entry && !data.has('tools.js'), `${label}: installable packages cannot contain host factories`);
      assert(manifest.license === p.license && object(manifest.author), `${label}: preserve author and license`);
      assert(data.has('mcp.json'), `${label}: MCP definition required`);
      const servers = JSON.parse(data.get('mcp.json')).mcpServers;
      assert(object(servers) && Object.keys(servers).length > 0, `${label}: MCP servers required`);
      for (const s of Object.values(servers)) {
        assert(s.type === 'stdio' && ['python3','node'].includes(s.command), `${label}: reviewed stdio runtime required`);
        assert(Array.isArray(s.args) && s.args.length === 1 && /^\$\{PLUGIN_ROOT\}\/[A-Za-z0-9_/-]+\.(?:py|mjs|js)$/.test(s.args[0]), `${label}: explicit package entrypoint required; shell commands are not accepted`);
        assert(names.has(s.args[0].replace('${PLUGIN_ROOT}/','')), `${label}: missing entrypoint`);
        assert(s.cwd === '${PLUGIN_ROOT}' && object(s.env) && Object.keys(s.env).length === 0, `${label}: no embedded environment values`);
      }
    }
  }
  return { plugins: ids.size, installable: catalog.plugins.filter(p=>p.kind==='installable').length, bundled: catalog.plugins.filter(p=>p.kind==='bundled').length };
}

function git(root, args, encoding) { return execFileSync('git',['-C',root,...args],{encoding,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}); }
export function validateRepository(root) {
  const catalog = JSON.parse(readFileSync(resolve(root,'plugins/catalog.json')));
  const summary = validateCatalog(catalog, p => {
    const records = git(root,['ls-tree','-rz',p.source.commit,'--',p.source.path],'utf8').split('\0').filter(Boolean);
    assert(records.length > 0, `${p.id}: source commit/path not found`);
    const result = new Map();
    for (const record of records) {
      const [info, path] = record.split('\t');
      assert(/^100644 blob [a-f0-9]{40}$/.test(info), `${p.id}: only regular non-executable files are accepted`);
      const rel = path.slice(p.source.path.length+1);
      assert(safePath(rel), `${p.id}: unsafe Git path`);
      const bytes = git(root,['show',`${p.source.commit}:${path}`]);
      // The candidate checkout is data. Read Git blobs, never its scripts or imports.
      const current = git(root,['show',`HEAD:${path}`]);
      assert(bytes.equals(current), `${p.id}: candidate differs from pinned source; publish a new source commit and version`);
      result.set(rel,bytes);
    }
    const currentPaths = git(root,['ls-tree','-rz','HEAD','--',p.source.path],'utf8').split('\0').filter(Boolean);
    assert(currentPaths.length === records.length, `${p.id}: candidate contains unlisted files`);
    return result;
  });
  return {catalog,summary};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = resolve(process.argv[2] || '.');
    const {catalog,summary} = validateRepository(root);
    if (process.env.CATALOG_BASE_SHA && /^[a-f0-9]{40}$/.test(process.env.CATALOG_BASE_SHA)) {
      let before;
      try { before = JSON.parse(git(root,['show',`${process.env.CATALOG_BASE_SHA}:plugins/catalog.json`],'utf8')); } catch { /* Initial catalog bootstrap. */ }
      for (const old of before?.plugins || []) {
        const next = catalog.plugins.find(p=>p.id===old.id);
        assert(next, `${old.id}: keep a withdrawn tombstone instead of deleting the entry`);
        assert(next.version !== old.version || next.package.treeDigest === old.package.treeDigest, `${old.id}: changed source requires a new version`);
      }
    }
    // Public review records are independently checked; contributors cannot self-attest.
    for (const p of catalog.plugins.filter(p=>p.review.human==='approved')) {
      const id = p.review.reference.match(/pullrequestreview-(\d+)$/)[1];
      const number = p.review.reference.match(/\/pull\/(\d+)/)[1];
      const response = await fetch(`https://api.github.com/repos/KDZZZZZZ/sesame/pulls/${number}/reviews/${id}`, {headers:{Accept:'application/vnd.github+json',...(process.env.GITHUB_TOKEN ? {Authorization:`Bearer ${process.env.GITHUB_TOKEN}`} : {})}});
      assert(response.ok, `${p.id}: cannot verify human review`);
      const review = await response.json();
      assert(review.state === 'APPROVED' && review.user?.login === p.review.reviewer && review.user?.login === 'KDZZZZZZ' && review.commit_id === p.review.reviewedCommit, `${p.id}: unverified human review`);
      git(root,['merge-base','--is-ancestor',p.source.commit,p.review.reviewedCommit]);
    }
    console.log(JSON.stringify({result:'static validation passed',...summary,note:'No plugin code was executed. This is not a safety certification.'},null,2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
