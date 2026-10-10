import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fail = (condition, message) => { if (!condition) throw new Error(message); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const treeDigest = files => `sha256:${sha256(JSON.stringify([...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => [file.path, `sha256:${file.sha256}`])))}`;
const safePath = path => typeof path === 'string' && path.length > 0 && path.length <= 512 && !/[\x00-\x1f\\:]/.test(path) && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
const semver = value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);

/** A package may require a newer host than its bundle profile. Keep the source
 * format deliberately narrow (one SemVer lower bound); compound ranges and
 * widened alternatives need a separate review rather than a guessed subset. */
export function engineWithinProfile(range, profileRange) {
  const lower = value => {
    const match = typeof value === 'string' && /^>=(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
    if (!match) return null;
    const pre = match[4]?.split('.') ?? null;
    if (pre?.some(part => /^\d+$/.test(part) && !/^(0|[1-9]\d*)$/.test(part))) return null;
    return { numbers: match.slice(1, 4).map(BigInt), pre };
  };
  const requested = lower(range), minimum = lower(profileRange);
  if (!requested || !minimum) return false;
  // SemVer ranges admit prereleases only at their explicitly named base.
  // A higher prerelease base would add hosts excluded by the profile range.
  for (let i = 0; i < 3; i++) if (requested.numbers[i] !== minimum.numbers[i]) return requested.numbers[i] > minimum.numbers[i] && !requested.pre;
  if (!requested.pre || !minimum.pre) return !requested.pre;
  for (let i = 0; i < Math.max(requested.pre.length, minimum.pre.length); i++) {
    const a = requested.pre[i], b = minimum.pre[i];
    if (a === b) continue;
    if (a === undefined || b === undefined) return b === undefined;
    const an = /^\d+$/.test(a), bn = /^\d+$/.test(b);
    if (an && bn) return BigInt(a) > BigInt(b);
    if (an !== bn) return !an;
    return a > b;
  }
  return true;
}

// A fixed gzip header and RFC 1951 stored blocks make archive bytes independent
// of Node's bundled zlib version, compression tuning and the runner platform.
// These source bundles are small; portability is more valuable than compression.
export function portableGzip(bytes) {
  const parts = [Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255])];
  for (let offset = 0; offset < bytes.length || offset === 0; offset += 65535) {
    const chunk = bytes.subarray(offset, offset + 65535), header = Buffer.alloc(5);
    header[0] = offset + chunk.length >= bytes.length ? 1 : 0;
    header.writeUInt16LE(chunk.length, 1); header.writeUInt16LE(chunk.length ^ 0xffff, 3);
    parts.push(header, chunk);
  }
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const trailer = Buffer.alloc(8); trailer.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 0); trailer.writeUInt32LE(bytes.length >>> 0, 4);
  return Buffer.concat([...parts, trailer]);
}

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

export function readProfile(source) {
  const path = join(source, 'bundle-profile.json');
  if (!existsSync(path)) return null; // Historical fixed releases predate profiles.
  const stat = lstatSync(path);
  fail(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Bundle profile must be an ordinary file');
  const value = JSON.parse(readFileSync(path));
  fail(value.schemaVersion === 1 && ['core', 'optional'].includes(value.kind) && value.engines?.sesame === '>=0.2.0-0', 'Invalid bundle profile or Sesame engine range');
  fail(Array.isArray(value.packages) && value.packages.length > 0 && value.packages.every(id => /^sesame\/[a-z][a-z0-9-]*$/.test(id)) && new Set(value.packages).size === value.packages.length, 'Profile requires unique package identities');
  fail(Object.keys(value).every(key => ['schemaVersion', 'kind', 'engines', 'packages'].includes(key)), 'Unknown profile field');
  return value;
}

export function buildLock(source = root) {
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
      if (profile) fail(!/\bstorage\s*(?:(?:\?\.)?\[\s*['"]legacy['"]\s*\]|(?:\?\.|\.)\s*legacy\b)/.test(text), `${id}: profiled packages must use private storage`);
      for (const match of text.matchAll(/(?:(?<!['"])\bfrom\s*|\bimport\s*\(|\bimport\s*|\brequire\s*\()\s*['"]([^'"]+)['"]/g)) {
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
  return portableGzip(Buffer.concat([...entries.map(entry => tarFile(entry.path, entry.bytes)), Buffer.alloc(1024)]));
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
