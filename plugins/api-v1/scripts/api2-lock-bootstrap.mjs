// Temporary trusted-data bootstrap for the API 2 source migration.
// Validation based on 61a4975f7c5e1779ae3c008c5ef43c2460ce906d;
// binding shape and IDs follow the host capability contract.
// Remove this helper when the complete API 2 validator replaces API 1.
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const fail = (condition, message) => { if (!condition) throw new Error(message); };
const bindingId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);

export function buildApi2Lock(source, { packageFiles, readProfile, engineWithinProfile, treeDigest, safePath, semver }) {
  const packagesDirectory = join(source, 'packages'), packages = [], profile = readProfile(source);
  for (const directory of readdirSync(packagesDirectory).sort()) {
    fail(/^[a-z][a-z0-9-]*$/.test(directory), `Package directory must be a simple slug: ${directory}`);
    const path = join(packagesDirectory, directory), stat = lstatSync(path);
    fail(stat.isDirectory() && !stat.isSymbolicLink(), `Package is not an ordinary directory: ${directory}`);
    const files = packageFiles(path), names = new Set(files.map(file => file.path));
    fail(new Set(files.map(file => file.path.normalize('NFD').toLowerCase())).size === files.length, `${directory}: paths collide on a supported filesystem`);
    const manifest = JSON.parse(readFileSync(join(path, 'plugin.json'))), npm = JSON.parse(readFileSync(join(path, 'package.json'))), extension = manifest.extensions?.['bot.sesame'];
    const id = extension?.id ?? manifest.id;
    fail(id === `sesame/${directory}`, `Incorrect publisher identity: ${directory}`);
    if (profile) {
      fail(engineWithinProfile((manifest.$schema ? extension?.engines : manifest.engines)?.sesame, profile.engines.sesame), `${id}: Sesame engine range must not widen its profile`);
      fail(!Object.hasOwn(manifest, 'migration') && !Object.hasOwn(extension ?? {}, 'migration'), `${id}: profiled packages cannot request legacy host storage grants`);
      const state = extension?.builtin?.default_state ?? manifest.default_state;
      fail(profile.kind === 'optional' ? state === 'discoverable' : ['mounted', 'discoverable'].includes(state), `${id}: profile default state differs`);
    }
    fail(manifest.apiVersion === '2', `${id}: API version must be 2`);
    fail(semver(manifest.version) && npm.version === manifest.version && npm.type === 'module', `${id}: package version or module scope differs`);
    fail(typeof manifest.license === 'string' && manifest.license === npm.license && names.has('LICENSE'), `${id}: explicit per-package license is required`);
    fail(['mounted', 'discoverable', 'disabled'].includes(manifest.default_state), `${id}: invalid default state`);
    fail(!Object.hasOwn(manifest, 'tool_names') && !Object.hasOwn(manifest, 'tool_definitions'), `${id}: capabilities.json is the single capability declaration`);
    fail(safePath(manifest.capability_manifest) && names.has(manifest.capability_manifest), `${id}: capability manifest is missing`);
    const declared = JSON.parse(readFileSync(join(path, manifest.capability_manifest)));
    fail(declared.apiVersion === '2' && declared.schemaVersion === 1, `${id}: invalid capability manifest version`);
    for (const field of ['capabilities', 'sources', 'views', 'services', 'knowledge', 'hooks', 'stateCollections', 'artifactSchemas']) fail(Array.isArray(declared[field]), `${id}: ${field} must be explicitly declared`);
    fail(new Set(declared.capabilities.map(cap => cap.id)).size === declared.capabilities.length, `${id}: capability IDs must be unique`);
    const servers = manifest.execution === 'mcp' ? JSON.parse(readFileSync(join(path, 'mcp.json'))).mcpServers : {};
    for (const cap of declared.capabilities) {
      fail(typeof cap.id === 'string' && cap.inputSchema && cap.outputSchema && cap.usage && ['purpose', 'inputs', 'outputs'].every(key => typeof cap.usage[key] === 'string' && cap.usage[key].trim()) && ['prerequisites', 'limitations'].every(key => Array.isArray(cap.usage[key])), `${id}: incomplete capability declaration ${cap.id}`);
      fail(Array.isArray(cap.consumers) && cap.consumers.length && cap.consumers.every(value => ['agent', 'host'].includes(value)), `${id}: capability consumers must be explicit`);
      const binding = cap.binding;
      fail(binding !== null && typeof binding === 'object' && !Array.isArray(binding), `${id}: capability binding must be an object: ${cap.id}`);
      fail(['native', 'mcp', 'agent', 'graph'].includes(binding.type), `${id}: unsupported binding type: ${cap.id}`);
      if (binding.type === 'native' || binding.type === 'mcp') fail(bindingId(binding.name), `${id}: binding name must be a valid local ID: ${cap.id}`);
      if (binding.type === 'mcp') fail(bindingId(binding.server), `${id}: binding server must be a valid local ID: ${cap.id}`);
      if (cap.binding?.type === 'native') fail(safePath(manifest.entry) && names.has(manifest.entry), `${id}: native entry is missing`);
      if (binding.type === 'mcp') fail(servers && Object.hasOwn(servers, binding.server) && servers[binding.server], `${id}: undeclared MCP server binding`);
    }
    for (const resource of [...manifest.prompts ?? [], ...manifest.resources ?? [], ...declared.knowledge.map(item => item.path)]) fail(safePath(resource) && names.has(resource), `${id}: missing resource ${resource}`);
    for (const file of files.filter(file => /\.(?:m?js|cjs)$/.test(file.path))) {
      const text = readFileSync(join(path, file.path), 'utf8');
      if (profile) fail(!/\bstorage\s*(?:(?:\?\.)?\[\s*['"]legacy['"]\s*\]|(?:\?\.|\.)\s*legacy\b)/.test(text), `${id}: profiled packages must use private storage`);
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\bimport\s*|\brequire\s*\()\s*['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (specifier.startsWith('.')) {
          const target = relative(path, resolve(dirname(join(path, file.path)), specifier)).replaceAll('\\', '/');
          fail(safePath(target) && names.has(target), `${id}: import escapes package or is missing: ${file.path} -> ${specifier}`);
        } else fail(specifier.startsWith('node:') || specifier.startsWith('@sesame/plugin-sdk/'), `${id}: undeclared dependency ${specifier}`);
      }
    }
    packages.push({ id, version: manifest.version, directory, treeDigest: treeDigest(files), files });
  }
  if (profile) fail(JSON.stringify(packages.map(pkg => pkg.id).sort()) === JSON.stringify([...profile.packages].sort()), 'Package set differs from the reviewed core/optional profile');
  fail(packages.length > 0 && packages.length <= 100, 'Bundle requires 1–100 packages');
  return { schemaVersion: 1, apiVersion: '2', channel: 'development', packages };
}
