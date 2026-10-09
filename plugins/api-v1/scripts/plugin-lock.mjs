import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const fail = (condition, message) => { if (!condition) throw new Error(message); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const treeDigest = files => `sha256:${sha256(JSON.stringify([...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => [file.path, `sha256:${file.sha256}`])))}`;
const safePath = path => typeof path === 'string' && path.length > 0 && path.length <= 512 && !/[\x00-\x1f\\:]/.test(path) && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
const semver = value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);

export function packageFiles(directory, base = '') {
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    fail(!['.git', 'node_modules', '__pycache__', '.DS_Store'].includes(name), `Local or generated files must not enter a plugin: ${base}${name}`);
    const path = base + name, absolute = join(directory, name), stat = lstatSync(absolute);
    fail(safePath(path) && !stat.isSymbolicLink(), `Unsafe package entry: ${path}`);
    if (stat.isDirectory()) files.push(...packageFiles(absolute, `${path}/`));
    else {
      fail(stat.isFile() && stat.nlink === 1, `Only ordinary files may be packaged: ${path}`);
      const bytes = readFileSync(absolute); fail(bytes.length <= 2 * 1024 * 1024, `File exceeds 2 MiB: ${path}`);
      files.push({ path, sha256: sha256(bytes), bytes: bytes.length });
    }
  }
  fail(files.length <= 1024 && files.reduce((size, file) => size + file.bytes, 0) <= 16 * 1024 * 1024, 'Plugin exceeds file or byte budget');
  return files;
}

export function buildLock(source = root) {
  const packagesDirectory = join(source, 'packages'), packages = [];
  for (const directory of readdirSync(packagesDirectory).sort()) {
    fail(/^[a-z][a-z0-9-]*$/.test(directory), `Package directory must be a simple slug: ${directory}`);
    const path = join(packagesDirectory, directory), stat = lstatSync(path);
    fail(stat.isDirectory() && !stat.isSymbolicLink(), `Package is not an ordinary directory: ${directory}`);
    const files = packageFiles(path), names = new Set(files.map(file => file.path));
    fail(new Set(files.map(file => file.path.normalize('NFD').toLowerCase())).size === files.length, `${directory}: paths collide on a supported filesystem`);
    const manifest = JSON.parse(readFileSync(join(path, 'plugin.json'))), npm = JSON.parse(readFileSync(join(path, 'package.json'))), extension = manifest.extensions?.['bot.sesame'];
    const id = extension?.id ?? manifest.id;
    fail(id === `sesame/${directory}`, `Incorrect publisher identity: ${directory}`);
    fail((extension?.apiVersion ?? manifest.apiVersion) === '1', `${id}: API version must be 1`);
    fail(semver(manifest.version) && npm.version === manifest.version && npm.type === 'module', `${id}: package version or module scope differs`);
    fail(typeof manifest.license === 'string' && manifest.license === npm.license && names.has('LICENSE'), `${id}: explicit per-package license is required`);
    if (manifest.$schema) {
      fail(manifest.$schema === 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' && !manifest.entry && names.has('mcp.json'), `${id}: unsupported standard MCP package`);
      fail(extension.builtin && safePath(extension.builtin.tool_definitions) && names.has(extension.builtin.tool_definitions), `${id}: MCP tool schema is missing`);
      const servers = JSON.parse(readFileSync(join(path, 'mcp.json'))).mcpServers;
      const tools = JSON.parse(readFileSync(join(path, extension.builtin.tool_definitions)));
      fail(servers && tools && JSON.stringify(Object.keys(servers).sort()) === JSON.stringify(Object.keys(tools).sort()) && Object.values(tools).every(Array.isArray), `${id}: MCP server and tool schema differ`);
    } else {
      fail(['mounted', 'discoverable', 'disabled'].includes(manifest.default_state), `${id}: invalid default state`);
      fail(Array.isArray(manifest.tool_names) && new Set(manifest.tool_names).size === manifest.tool_names.length, `${id}: tool names must be unique`);
      if (manifest.tool_names.length) fail(safePath(manifest.entry) && names.has(manifest.entry), `${id}: native entry is missing`);
      fail(names.has(manifest.tool_definitions), `${id}: tool schema is missing`);
      const tools = JSON.parse(readFileSync(join(path, manifest.tool_definitions)));
      fail(Array.isArray(tools) && JSON.stringify(tools.map(tool => tool.name).sort()) === JSON.stringify([...manifest.tool_names].sort()), `${id}: tool schema differs from manifest`);
      for (const resource of [...manifest.prompts ?? [], ...manifest.resources ?? []]) fail(safePath(resource) && names.has(resource), `${id}: missing resource ${resource}`);
    }
    for (const file of files.filter(file => /\.(?:m?js|cjs)$/.test(file.path))) {
      const text = readFileSync(join(path, file.path), 'utf8');
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
  fail(packages.length > 0 && packages.length <= 100, 'Bundle requires 1–100 packages');
  return { schemaVersion: 1, apiVersion: '1', channel: 'development', packages };
}

function tarFile(name, bytes) {
  const header = Buffer.alloc(512); let base = name, prefix = '';
  if (Buffer.byteLength(base) > 100) {
    const slash = name.lastIndexOf('/'); prefix = name.slice(0, slash); base = name.slice(slash + 1);
    fail(slash > 0 && Buffer.byteLength(base) <= 100 && Buffer.byteLength(prefix) <= 155, `Archive path is too long: ${name}`);
  }
  const field = (offset, size, value) => { const text = String(value); fail(Buffer.byteLength(text) <= size, 'Archive field overflow'); header.write(text, offset, size, 'utf8'); };
  const octal = (offset, size, value) => field(offset, size, value.toString(8).padStart(size - 1, '0') + '\0');
  field(0, 100, base); octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, bytes.length); octal(136, 12, 0);
  header.fill(32, 148, 156); field(156, 1, '0'); field(257, 6, 'ustar\0'); field(263, 2, '00'); field(345, 155, prefix);
  const sum = header.reduce((a, b) => a + b, 0); field(148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}

export function createArchive(source, lock) {
  const actual = buildLock(source); fail(JSON.stringify(actual) === JSON.stringify(lock), 'Source changed after lock generation');
  const lockBytes = Buffer.from(JSON.stringify(lock, null, 2) + '\n');
  const entries = [{ path: 'official-plugins.lock.json', bytes: lockBytes }];
  for (const pkg of lock.packages) for (const file of pkg.files) entries.push({ path: `${pkg.directory}/${file.path}`, bytes: readFileSync(join(source, 'packages', pkg.directory, file.path)) });
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return gzipSync(Buffer.concat([...entries.map(entry => tarFile(entry.path, entry.bytes)), Buffer.alloc(1024)]), { level: 9 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), sourceIndex = args.indexOf('--source');
  fail(args.length > 0 && args.every((arg, i) => ['--write', '--check', '--archive', '--source'].includes(arg) || ['--archive', '--source'].includes(args[i - 1])), 'Use --write, --check, or --archive <path>, with optional --source <directory>');
  fail(sourceIndex === -1 || args[sourceIndex + 1], '--source needs a directory');
  const source = sourceIndex === -1 ? root : resolve(args[sourceIndex + 1]), lockPath = join(source, 'official-plugins.lock.json'), lock = buildLock(source), text = JSON.stringify(lock, null, 2) + '\n';
  if (args.includes('--write')) writeFileSync(lockPath, text);
  if (args.includes('--check') || args.includes('--archive')) fail(readFileSync(lockPath, 'utf8') === text, 'Lock differs from source; regenerate and review it');
  const archiveIndex = args.indexOf('--archive');
  if (archiveIndex !== -1) {
    fail(args[archiveIndex + 1], '--archive needs an output path'); const target = resolve(args[archiveIndex + 1]), bytes = createArchive(source, lock);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
    console.log(JSON.stringify({ archive: target, bytes: bytes.length, sha256: sha256(bytes), lockSha256: sha256(text), packages: lock.packages.length }));
  } else console.log(`Validated ${lock.packages.length} API 1 packages; lock sha256:${sha256(text)}`);
}
