import { createHash } from 'node:crypto';
import { parseDocument, stringify } from './vendor/yaml.mjs';

export const PROTOCOL_VERSION = '2026-07-28';
const toolPath = /^tools\/([a-zA-Z0-9_.-]+)\.yaml$/;
const workflowPath = /^workflows\/([a-zA-Z0-9_.-]+)\.yaml$/;
const publicFields = ['id', 'title', 'description', 'version', 'license', 'engines', 'author', 'entry', 'dependencies'];
const sections = ['sources', 'views', 'services', 'hooks', 'knowledge', 'stateCollections', 'artifactSchemas'];
const wireFields = ['name', 'title', 'description', 'inputSchema', 'outputSchema', 'annotations', 'errors'];
const has = (o, k) => Object.hasOwn(o, k);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (value, message) => { if (!value) throw new Error(message); };
const sha = value => createHash('sha256').update(value).digest('hex');
const normalize = value => String(value).replace(/\r\n?/g, '\n');
const select = (obj, keys) => Object.fromEntries(keys.filter(key => has(obj, key)).map(key => [key, obj[key]]));
const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function parseYaml(value, path = 'YAML') {
  check(value !== undefined, 'Missing ' + path);
  const text = normalize(value);
  check(Buffer.byteLength(text) <= 8 * 1024 * 1024, path + ': document too large');
  // Generated JSON-syntax YAML can be verified without constructing a YAML CST.
  // Equality with a fresh serialization excludes duplicate keys.
  if (text.trimStart().startsWith('{')) {
    try {
      const data = JSON.parse(text), source = text.trim();
      if (JSON.stringify(data) === source || JSON.stringify(data, null, 2) === source) return data;
    } catch { /* Ordinary YAML is parsed below. */ }
  }
  const doc = parseDocument(text, { uniqueKeys: true, merge: false, prettyErrors: false });
  if (doc.errors.length || doc.warnings.length) throw new Error(path + ': ' + (doc.errors[0] ?? doc.warnings[0]).message);
  return doc.toJS({ maxAliasCount: 0 });
}
export function writeYaml(value) {
  return stringify(value, { lineWidth: 0, aliasDuplicateObjects: false, defaultKeyType: 'PLAIN' });
}
function decodeHeader(bytes) {
  const source = parseYaml(bytes, 'plugin.yaml');
  check(object(source) && source.formatVersion === 1 && source.protocolVersion === PROTOCOL_VERSION, 'Unsupported plugin.yaml formatVersion or protocolVersion');
  check(typeof source.id === 'string' && source.id.split('/').length === 2 && source.id.split('/').every(part => part.length <= 64 && /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(part)), 'Invalid plugin.yaml publisher/name');
  for (const key of ['version', 'title', 'description']) check(typeof source[key] === 'string' && source[key].trim(), 'Invalid plugin.yaml ' + key);
  const ext = source['x-sesame'] ?? {}, contributions = ext.contributions ?? {};
  check(object(ext) && object(contributions), 'Invalid x-sesame contributions');
  for (const reserved of [...publicFields, 'formatVersion', 'protocolVersion', 'apiVersion', 'capability_manifest']) check(!has(ext, reserved), 'Reserved x-sesame field: ' + reserved);
  const manifest = { default_state: 'discoverable', ...without(ext, ['contributions']), ...select(source, publicFields), apiVersion: '2', capability_manifest: 'capabilities.json' };
  return { manifest, contributions };
}
export function readProtocolHeader(bytes) {
  const {manifest, contributions} = decodeHeader(bytes);
  return {manifest, hooks: contributions.hooks ?? []};
}
function build(files) {
  const { manifest, contributions } = decodeHeader(files['plugin.yaml']);
  const elements = new Map();
  const element = (id, value) => {
    const full = manifest.id + ':' + id;
    check(!elements.has(full), 'Duplicate surface element: ' + full);
    elements.set(full, sha(Buffer.isBuffer(value) ? value : typeof value === 'string' ? normalize(value) : JSON.stringify(canonical(value))));
  };
  const paths = Object.keys(files).sort();
  const tools = [], definitions = new Map();
  element('plugin.description', {title:manifest.title,description:manifest.description});
  for (const path of paths.filter(path => toolPath.test(path))) {
    const source = parseYaml(files[path], path), name = toolPath.exec(path)[1];
    check(object(source) && source.name === name && typeof source.title === 'string' && typeof source.description === 'string' && object(source.inputSchema) && object(source.outputSchema) && object(source.annotations) && object(source.errors), 'Invalid tool declaration: ' + path);
    const ext = source['x-sesame'] ?? {};
    check(object(ext) && !['id', ...wireFields].some(key => has(ext, key)), 'Reserved tool x-sesame field: ' + path);
    const consumers = ext.consumers ?? ['agent'];
    check(Array.isArray(consumers) && consumers.includes('agent'), 'Public tool requires an agent consumer: ' + path);
    tools.push(select(source, wireFields));
    definitions.set(name, {...ext, consumers, id:name, description:source.description, inputSchema:source.inputSchema, outputSchema:ext.finalOutputSchema ?? source.outputSchema});
    delete definitions.get(name).finalOutputSchema;
    element('tool/' + name + '.description', {name, title:source.title, description:source.description, annotations:source.annotations, usage:ext.usage ?? {}});
    element('tool/' + name + '.input', source.inputSchema);
    element('tool/' + name + '.output', {wire:source.outputSchema, ...(ext.finalOutputSchema ? {final:ext.finalOutputSchema} : {})});
    for (const [code, error] of Object.entries(source.errors)) element('tool/' + name + '.error/' + code, error);
  }
  const ordered = contributions.capabilities ?? [...definitions.keys()].map(name => 'tool/' + name);
  const seen = new Set();
  const capabilities = {schemaVersion:1, apiVersion:'2', configSchema:{type:'object'}, ...Object.fromEntries(sections.map(key => [key, []])), ...contributions, capabilities:ordered.map(ref => {
    if (typeof ref !== 'string') {
      check(object(ref) && Array.isArray(ref.consumers) && !ref.consumers.includes('agent'), 'Inline capability must be host-only');
      return ref;
    }
    const name = ref.startsWith('tool/') && ref.slice(5);
    check(definitions.has(name) && !seen.has(name), 'Unknown or repeated tool reference: ' + ref);
    seen.add(name);
    return definitions.get(name);
  })};
  check(seen.size === definitions.size, 'Unreferenced public tool in ' + manifest.id);
  const resourceFiles = new Set(manifest.resources ?? []);
  const prompts = new Set(manifest.prompts ?? []);
  if (has(files, 'instructions.md')) prompts.add('instructions.md');
  const skillPaths = new Set();
  for (const item of capabilities.knowledge) {
    if (item.kind === 'prompt') prompts.add(item.path);
    else if (item.kind === 'skill') skillPaths.add(item.path);
    else resourceFiles.add(item.path);
  }
  manifest.prompts = [...prompts];
  for (const root of manifest.skills ?? []) for (const path of paths) {
    if (path.endsWith('/SKILL.md') && (path === root || path.startsWith(root + '/'))) skillPaths.add(path);
  }
  for (const path of prompts) {
    check(has(files,path),'Missing instructions: ' + path);
    const text = normalize(files[path]), parts = text.split(/(?=^##\s)/m);
    const counts = new Map();
    for (const part of parts) {
      if (!part) continue;
      const heading = part.match(/^##\s+([^\n]+)/)?.[1]?.trim() || 'preamble';
      const base = (path === 'instructions.md' ? '' : path + '/') + heading;
      const occurrence = (counts.get(base) ?? 0) + 1; counts.set(base, occurrence);
      element('instructions#' + base + (occurrence === 1 ? '' : '~' + occurrence), part);
    }
  }
  for (const path of skillPaths) {
    check(has(files,path),'Missing skill ' + path);
    const match = normalize(files[path]).match(/^---\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    check(match,'Invalid SKILL.md frontmatter: ' + path);
    const meta = parseYaml(match[1],path);
    check(typeof meta?.name === 'string' && typeof meta.description === 'string','Missing skill identity: ' + path);
    element('skill/' + meta.name + '.description',{name:meta.name,description:meta.description});
    element('skill/' + meta.name + '.body',match[2]);
    const dir = path.slice(0, -'SKILL.md'.length);
    for (const file of paths) if (file !== path && file.startsWith(dir)) {
      element('skill/' + meta.name + '.file/' + file.slice(dir.length), Buffer.isBuffer(files[file]) ? files[file] : Buffer.from(files[file]));
    }
  }
  for (const path of resourceFiles) {
    check(has(files,path),'Missing resource ' + path);
    element('resource/' + path,normalize(files[path]));
  }
  const workflows = [];
  for (const path of paths.filter(path => workflowPath.test(path))) {
    const text = normalize(files[path]), doc = parseYaml(text,path);
    check(typeof doc?.workflow === 'string' && object(doc.steps), 'Invalid workflow declaration ' + path);
    workflows.push({path, text});
    for (const [name, step] of Object.entries(doc.steps)) element('workflow/' + doc.workflow + '.step/' + name,step);
  }
  const messages = has(files,'messages.yaml') ? parseYaml(files['messages.yaml'],'messages.yaml') : {};
  check(object(messages),'Invalid messages.yaml');
  for (const [code, template] of Object.entries(messages)) element('message/' + code, template);
  const requirements = parseYaml(files['requirements.yaml'],'requirements.yaml');
  check(object(requirements) && typeof requirements.goal === 'string' && object(requirements.acceptance), 'Invalid requirements.yaml');
  const entries = Object.fromEntries([...elements].sort(([a],[b])=>a<b?-1:a>b?1:0));
  const surface = {formatVersion:1,elements:entries,digest:sha(JSON.stringify(entries))};
  return {manifest,capabilities,tools,workflows,messages,requirements,surface};
}
export function buildSurfaceLock(files) { return build(files).surface; }
export function readProtocolPackage(files, {verifyLock = true} = {}) {
  check(!has(files, 'plugin.json') && !has(files,'capabilities.json'), 'Conflicting legacy package declarations');
  const result = build(files);
  if (verifyLock) {
    check(has(files,'surface.lock.json'),'Missing surface.lock.json');
    const lock = JSON.parse(files['surface.lock.json']);
    check(JSON.stringify(canonical(lock)) === JSON.stringify(canonical(result.surface)), 'Surface lock mismatch: ' + result.manifest.id);
  }
  return result;
}
export function createProtocolFiles(manifest, capabilities, assets = {}) {
  const files = {...assets};
  delete files['plugin.json']; delete files['capabilities.json'];
  const pathOf = path => path === 'prompt.md' ? 'instructions.md' : path;
  if (has(files,'prompt.md')) { files['instructions.md'] = files['prompt.md']; delete files['prompt.md']; }
  const ext = without(manifest,[...publicFields, 'apiVersion', 'capability_manifest']);
  if (ext.prompts) ext.prompts = ext.prompts.map(pathOf);
  const declaration = without(capabilities,['apiVersion','schemaVersion']);
  declaration.knowledge = (capabilities.knowledge ?? []).map(item=>({...item,path:pathOf(item.path)}));
  declaration.capabilities = capabilities.capabilities.map(cap => {
    if (!cap.consumers.includes('agent')) return cap;
    const extras = without(cap,['id','description','inputSchema','outputSchema']);
    if (cap.execution === 'run') extras.finalOutputSchema = cap.outputSchema;
    const outputSchema = cap.execution === 'run' ? {type:'object',properties:{type:{const:'run'},run:{type:'object'},receipt:{type:'object'}},required:['type','run']} : cap.outputSchema;
    const tool = {name:cap.id,title:cap.id,description:cap.description,inputSchema:cap.inputSchema,outputSchema,annotations:{},errors:{internal_error:{message:'The operation failed.',recovery:'Inspect the recorded diagnostic before retrying.'}},'x-sesame':extras};
    files['tools/' + cap.id + '.yaml'] = writeYaml(tool);
    return 'tool/' + cap.id;
  });
  ext.contributions = declaration;
  files['plugin.yaml'] = writeYaml({formatVersion:1,protocolVersion:PROTOCOL_VERSION,...select(manifest,publicFields),'x-sesame':ext});
  files['requirements.yaml'] ??= writeYaml({goal:manifest.description,acceptance:{result:[manifest.description]}});
  files['surface.lock.json'] = JSON.stringify(buildSurfaceLock(files),null,2) + '\n';
  return files;
}
export const writeProtocolPackage = createProtocolFiles;
