import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProtocolPackage, parseYaml } from './package.mjs';
export * from './package.mjs';

export function readSurfaceFiles(root) {
  if (root instanceof URL) root = fileURLToPath(root);
  const files = Object.create(null);
  const safe = path => typeof path === 'string' && !/[\\:\x00-\x1f]/.test(path) && path.split('/').every(s=>s && s!=='.' && s!=='..');
  const file = (path,required = true) => {
    if (safe(path)) {
      let parent=root;
      for (const segment of path.split('/').slice(0,-1)) {
        parent=join(parent,segment);
        const ancestor=lstatSync(parent,{throwIfNoEntry:false});
        if (ancestor && (!ancestor.isDirectory() || ancestor.isSymbolicLink())) throw new Error('Invalid package ancestor: '+path);
      }
    }
    if (!safe(path)) throw new Error('Invalid package path: '+path);
    const full = join(root,path), stat = lstatSync(full,{throwIfNoEntry:false});
    if (!stat && !required) return;
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('Invalid regular file: '+path);
    files[path] = readFileSync(full);
  };
  file('plugin.yaml');
  const header = parseYaml(files['plugin.yaml'],'plugin.yaml'), ext=header['x-sesame'] ?? {};
  const walk = (dir,recursive,include) => {
    if (!safe(dir)) throw new Error('Invalid package directory: '+dir);
    const base = join(root,dir), stat=lstatSync(base,{throwIfNoEntry:false});
    if (!stat) return;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid package directory: '+dir);
    for(const entry of readdirSync(base,{withFileTypes:true})) {
      const path=dir+'/'+entry.name;
      if (entry.isSymbolicLink()) throw new Error('Unexpected package symlink: '+path);
      if (entry.isDirectory()) { if(recursive && entry.name!=='__pycache__') walk(path,true,include); }
      else if(entry.isFile() && include(path)) file(path);
    }
  };
  for (const path of ['instructions.md','messages.yaml','surface.lock.json','requirements.yaml','plugin.json','capabilities.json']) file(path,false);
  for (const path of [...ext.prompts ?? [], ...ext.resources ?? [], ...(ext.contributions?.knowledge ?? []).map(k=>k.path)]) file(path);
  for (const dir of ext.skills ?? []) {
    if (dir.endsWith('/SKILL.md')) walk(dir.slice(0,-9),true,()=>true);
    else walk(dir,true,()=>true);
  }
  for (const item of ext.contributions?.knowledge ?? []) if (item.kind==='skill') walk(item.path.slice(0,-9),true,()=>true);
  walk('tools',false,path=>path.endsWith('.yaml')); walk('workflows',false,path=>path.endsWith('.yaml'));
  return files;
}
export function readPackageDirectory(root, options) { return readProtocolPackage(readSurfaceFiles(root),options); }
