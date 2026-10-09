import { compileFrozenDirectory } from './frozen-compiler.js';
import { requireValue, taskRunId } from './support.js';
import { join } from 'node:path';

/** Entry executed by the host's generic isolated package worker transport. */
export async function execute(payload, { signal, directory } = {}) {
  requireValue(payload.operation === 'compile', 'Unknown MT5 compiler worker operation');
  if (payload.runId) taskRunId(payload.runId);
  if (payload.runtime) {
    const platform = { darwin: ['macos', 'createMacOSBackend'], win32: ['windows', 'createWindowsBackend'], linux: ['linux', 'createLinuxBackend'] }[process.platform];
    requireValue(platform && payload.runtime.platform === process.platform, 'Compiler runtime does not match this platform', 503, 'compiler_unavailable');
    const module = await import(`./runners/${platform[0]}.js`);
    return module[platform[1]](payload.runtime, { directory: join(directory, 'compiler-runtime') }).compile(payload.directory, payload.manifestDigest, { signal, runId: payload.runId });
  }
  if (process.platform === 'darwin') return (await import('./runners/lima.js')).compileWithLima(payload.directory, payload.manifestDigest, signal, payload.runId);
  if (process.platform === 'win32') return (await import('./runners/wsl.js')).runWSL('compile', { directory: payload.directory, editor: join(payload.directory, '.compiler', 'MetaEditor64.exe'), manifest_sha256: payload.manifestDigest, run_id: payload.runId }, { signal, timeoutMs: 330000 });
  requireValue(process.platform === 'linux', 'MT5 isolated compiler requires a verified runtime or Linux Wine environment', 503, 'compiler_unavailable');
  return compileFrozenDirectory(payload.directory, payload.manifestDigest, signal, 300000, payload.runId);
}
