import {readPackageDirectory, readSurfaceFiles, PROTOCOL_VERSION} from './protocol/directory.mjs';
const root = new URL('.',import.meta.url);
const {manifest,capabilities,tools} = readPackageDirectory(root);
const files = readSurfaceFiles(root);
const resources = [...new Set([...manifest.resources??[],...manifest.prompts??[],...capabilities.knowledge.map(item=>item.path)])].sort().map(path=>({
  uri:'sesame://plugins/'+manifest.id+'/'+path.split('/').map(encodeURIComponent).join('/'),
  name:path, mimeType:'text/markdown', text:String(files[path])
}));
console.log(JSON.stringify({id:manifest.id,version:manifest.version,protocol:PROTOCOL_VERSION,instructions:String(files['instructions.md']??''),tools,resources,capabilities:capabilities.capabilities}));
