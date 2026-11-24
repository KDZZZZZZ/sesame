import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readProtocolPackage, parseYaml } from '../package.mjs';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function assert(ok, message) { if (!ok) throw new Error(message); }
export function relativeFile(path) {
  assert(typeof path === 'string' && path.length <= 512 && !/[:\\\x00-\x1f]/.test(path) &&
    path.split('/').every(part => part && !['.', '..'].includes(part)), 'Invalid relative path');
  return path;
}
export function packageSnapshot(root) {
  const files = Object.create(null);
  let total = 0, count = 0;
  function read(dir) {
    for (const name of readdirSync(join(root,dir)).sort()) {
      const path = relativeFile(dir ? dir + '/' + name : name);
      const stat = lstatSync(join(root,path));
      assert(!stat.isSymbolicLink(), 'Package contains a link: ' + path);
      if (stat.isDirectory() && (name === '__pycache__' || !dir && /^\.core-sqlite-roundtrip-[A-Za-z0-9]+$/.test(name)) || stat.isFile() && /\.py[co]$/.test(name)) continue;
      assert(!['node_modules','.git','.DS_Store'].includes(name), 'Unexpected package file: ' + path);
      if (stat.isDirectory()) read(path);
      else {
        assert(stat.isFile() && stat.nlink === 1 && stat.size <= 2*1024*1024 && ++count <= 1024 && (total += stat.size) <= 16*1024*1024, 'Invalid package file or size: ' + path);
        files[path] = readFileSync(join(root,path));
      }
    }
  }
  root = realpathSync(root);
  read('');
  const tree = 'sha256:' + sha(JSON.stringify(Object.keys(files).sort().map(path => [path,'sha256:' + sha(files[path])])));
  return {root, files, tree, ...readProtocolPackage(files)};
}
export function readCase(path) {
  const bytes = readFileSync(path);
  const doc = parseYaml(bytes,path);
  assert(typeof doc?.id === 'string' && ['replay','sandbox'].includes(doc.environment?.mode) && Array.isArray(doc.steps) && doc.steps.length && Array.isArray(doc.expect) && doc.expect.length, 'Invalid case: ' + path);
  let fixtures = [];
  if (doc.environment.fixtures) {
    const file = relativeFile(doc.environment.fixtures);
    const base=realpathSync(resolve(path,'..'));
    const absolute=resolve(base,file);
    assert(realpathSync(absolute)===absolute && lstatSync(absolute).isFile() && lstatSync(absolute).nlink===1,'Unsafe fixture path');
    fixtures = JSON.parse(readFileSync(absolute,'utf8'));
    assert(Array.isArray(fixtures), 'Fixtures must be a list of recorded calls');
  }
  return {doc, fixtures, digest:sha(JSON.stringify([doc,fixtures]))};
}
function resourceIndex(pkg) {
  const paths = new Set([...(pkg.manifest.resources ?? []), ...(pkg.manifest.prompts ?? []), ...pkg.capabilities.knowledge.map(item=>item.path)]);
  for (const path of Object.keys(pkg.files)) if (path.endsWith('/SKILL.md')) paths.add(path);
  return [...paths].sort().map(path => ({name:path,uri:'sesame://plugins/' + pkg.manifest.id + '/' + path.split('/').map(encodeURIComponent).join('/'),path}));
}
export function replay(pkg, fixtures, step) {
  const {operation,params = {}} = step;
  switch (operation) {
    case 'server/discover': return {serverInfo:{name:pkg.manifest.id,version:pkg.manifest.version},instructions:pkg.files['instructions.md']?.toString() ?? '',capabilities:{tools:{},resources:{}}};
    case 'tools/list': return {tools:pkg.tools};
    case 'resources/list': return {resources:resourceIndex(pkg).map(({path,...resource})=>resource)};
    case 'resources/read': {
      const resource = resourceIndex(pkg).find(item=>item.uri === params.uri);
      assert(resource, 'Resource is outside the package surface');
      return {contents:[{uri:resource.uri,text:pkg.files[resource.path].toString()}]};
    }
    case 'tools/call': {
      assert(pkg.tools.some(tool => tool.name === params.name), 'Tool is outside the package surface');
      const results = fixtures.filter(item => item.name === params.name && isDeepStrictEqual(item.arguments,params.arguments ?? {}));
      assert(results.length === 1 && Object.hasOwn(results[0],'result'), 'No unique recorded call for ' + params.name);
      return results[0].result;
    }
    default: throw new Error('Unsupported case operation: ' + operation);
  }
}
function pointer(value, path) {
  assert(typeof path === 'string' && (path === '' || path.startsWith('/')), 'Invalid JSON pointer');
  for (const raw of path === '' ? [] : path.slice(1).split('/')) {
    const key = raw.replaceAll('~1','/').replaceAll('~0','~');
    if (value == null || !Object.hasOwn(value,key)) return undefined;
    value = value[key];
  }
  return value;
}
export function judge(outputs, expectations) {
  return expectations.map((rule,index) => {
    assert(Number.isInteger(rule.step) && rule.step >= 0 && rule.step < outputs.length, 'Invalid assertion step');
    const ops = ['equals','exists','contains'].filter(key => Object.hasOwn(rule,key));
    assert(ops.length === 1, 'Expected exactly one matcher');
    const value = pointer(outputs[rule.step],rule.pointer);
    const pass = ops[0]==='equals' ? isDeepStrictEqual(value,rule.equals) : ops[0]==='exists' ? (value !== undefined) === rule.exists :
      typeof value==='string' && typeof rule.contains==='string' ? value.includes(rule.contains) : Array.isArray(value) && value.some(item=>isDeepStrictEqual(item,rule.contains));
    return {index,step:rule.step,pointer:rule.pointer,pass};
  });
}
export function runCase(pkg, test, sandbox) {
  const outputs = test.doc.steps.map(step => test.doc.environment.mode === 'sandbox' && step.operation === 'tools/call'
    ? (assert(typeof sandbox === 'function','Isolated sandbox runner unavailable'), sandbox(pkg,step.params))
    : replay(pkg,test.fixtures,step));
  const checks = judge(outputs,test.doc.expect);
  return {id:test.doc.id,caseDigest:test.digest,tree:pkg.tree,surface:pkg.surface.digest,checks,passed:checks.filter(rule=>rule.pass).length,total:checks.length,outputDigests:outputs.map(value=>sha(JSON.stringify(value)))};
}
