import { fileManifest } from './frozen-compiler.js';
export { fileManifest, stageFrozenBuild } from './frozen-compiler.js';
import { promises as fs, existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ApiError, digest, requireValue } from './support.js';
import { macPrefix, winePrefix } from './platform.js';
import { taskRunId } from './support.js';
import { nativeCompilerAvailable, compileLocal } from './local-compiler.js';

export function installation(directory = process.env.MT5AGENT_MT5_DIR, dataDirectory = null) {
  if (directory) return resolveInstallation(directory, dataDirectory);
  if (process.platform === 'win32') {
    const windows = validInstallations([...windowsOriginCandidates(), ...windowsDefaultCandidates()]);
    return windows.length === 1 ? windows[0] : null;
  }
  const prefixes = process.env.MT5AGENT_WINEPREFIX || process.env.WINEPREFIX
    ? [winePrefix()]
    : [...(process.platform === 'darwin' ? [macPrefix()] : []), join(homedir(), '.mt5')];
  const defaults = validInstallations(prefixes.map(prefix => ({ directory: join(prefix, 'drive_c/Program Files/MetaTrader 5') })));
  return defaults.length === 1 ? defaults[0] : null;
}

function validInstallations(candidates) {
  const result = [], seen = new Set();
  for (const candidate of candidates) {
    const native = resolveInstallation(candidate.directory, candidate.dataDirectory);
    if (!native) continue;
    const key = native.directory.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(native);
  }
  return result;
}

function windowsOriginCandidates() {
  if (!process.env.APPDATA) return [];
  const root = join(process.env.APPDATA, 'MetaQuotes/Terminal');
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); }
  catch { return []; }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dataDirectory = join(root, entry.name);
    const origin = readOrigin(dataDirectory);
    if (origin) candidates.push({ directory: origin, dataDirectory });
  }
  return candidates;
}

function windowsDefaultCandidates() {
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(root => ({ directory: join(root, 'MetaTrader 5') }));
}

function readOrigin(dataDirectory) {
  try {
    const bytes = readFileSync(join(dataDirectory, 'origin.txt'));
    return bytes.toString(bytes.includes(0) ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '').trim() || null;
  } catch { return null; }
}

function resolveInstallation(directory, discoveredDataDirectory = null) {
  directory = resolve(directory);
  const editor = ['MetaEditor64.exe', 'metaeditor64.exe'].map(name => join(directory, name)).find(existsSync);
  const terminal = join(directory, 'terminal64.exe');
  let dataDirectory = discoveredDataDirectory ? resolve(discoveredDataDirectory) : process.env.MT5AGENT_MT5_DATA_DIR ? resolve(process.env.MT5AGENT_MT5_DATA_DIR) : directory;
  if (process.platform === 'win32' && !discoveredDataDirectory) {
    if (process.env.MT5AGENT_MT5_DATA_DIR) dataDirectory = resolve(process.env.MT5AGENT_MT5_DATA_DIR);
    else if (!existsSync(join(directory, 'MQL5/Include')) && process.env.APPDATA) {
      // MT5 identifies each non-portable data directory through origin.txt.
      // https://www.metatrader5.com/en/terminal/help/start_advanced/start
      for (const candidate of windowsOriginCandidates()) {
        if (resolve(candidate.directory).toLowerCase() === directory.toLowerCase()) { dataDirectory = candidate.dataDirectory; break; }
      }
    }
  }
  const include = join(dataDirectory, 'MQL5/Include');
  return editor && existsSync(terminal) && existsSync(include) ? { directory, dataDirectory, editor, terminal, include } : null;
}

export function compilerDependencies(environment = {}) {
  return nativeCompilerAvailable(environment.native ?? installation());
}

export async function compileNative(native, directory, signal, manifestDigest, runId, environment = {}) {
  if (runId) taskRunId(runId);
  if (!native) throw new ApiError(503, 'compiler_unavailable', '需要已安装的 MT5 及可用编译环境');
  signal?.throwIfAborted();
  const editor = join(resolve(directory), '.compiler', 'MetaEditor64.exe');
  if (!manifestDigest) {
    // Direct compiler callers get the same frozen input boundary as service builds.
    await fs.mkdir(join(directory, '.compiler'), { recursive: true });
    if (resolve(native.editor).toLowerCase() !== editor.toLowerCase()) await fs.copyFile(native.editor, editor);
    const files = await fileManifest(directory);
    delete files['manifest.json'];
    const manifestText = JSON.stringify({ compiler_sha256: files['.compiler/MetaEditor64.exe'].sha256, files }, null, 2);
    await fs.writeFile(join(directory, 'manifest.json'), manifestText);
    manifestDigest = digest(manifestText);
  }
  const backend = 'native';
  const result = typeof environment.executeWorker === 'function'
    ? await environment.executeWorker('backend/compiler-worker.js', { operation: 'compile', directory: resolve(directory), manifestDigest, runId: runId ?? null, native }, { signal, runId, timeoutMs: 600000 })
    : await compileLocal(native, resolve(directory), manifestDigest, signal);
  requireValue(typeof result.success === 'boolean' && typeof result.diagnostics === 'string', 'Runner 编译响应无效');
  if (result.success) {
    requireValue(typeof result.ex5 === 'string' && result.ex5.length <= 48 * 1024 * 1024, 'Runner 编译产物无效或过大');
    const bytes = Buffer.from(result.ex5, 'base64');
    requireValue(bytes.length > 0 && digest(bytes) === result.ex5_sha256, 'Runner 返回的 EX5 摘要不匹配');
    signal?.throwIfAborted();
    await fs.writeFile(join(directory, 'Experts/Strategy.ex5'), bytes);
  }
  await fs.writeFile(join(directory, 'Experts/Strategy.log'), Buffer.from('\uFEFF' + (result.diagnostics ?? ''), 'utf16le'));
  return { success: result.success, diagnostics: result.diagnostics, ex5_sha256: result.ex5_sha256, execution: result.execution ?? { backend } };
}
