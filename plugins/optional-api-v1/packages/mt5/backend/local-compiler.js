import { promises as fs, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join, delimiter, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { stageFrozenBuild } from './frozen-compiler.js';
import { runTesterProcess } from './tester-process.js';
import { pythonPath } from './process.js';
import { wineCommand, wineEnvironment } from './platform.js';
import { ApiError, digest, requireValue } from './support.js';

const exec = promisify(execFile);
const onPath = command => isAbsolute(command) ? existsSync(command) : (process.env.PATH ?? '').split(delimiter).some(path => existsSync(join(path, command)));
export function nativeCompilerAvailable(native) {
  return Boolean(native && existsSync(native.editor) && existsSync(pythonPath(native)) && (process.platform === 'win32' || onPath(wineCommand(native))));
}

/** Compile only a verified snapshot. This is owned native execution, not an OS sandbox. */
export async function compileLocal(native, source, manifestDigest, signal, { runProcess = runTesterProcess, stopWine } = {}) {
  requireValue(nativeCompilerAvailable(native), JSON.stringify({ code: 'PREREQUISITE_REQUIRED', capability: 'local-compiler', missing: ['MetaEditor + Windows Python process controller', ...(process.platform === 'win32' ? [] : ['Wine'])], next: 'mt5_dependencies inspect' }), 503, 'PREREQUISITE_REQUIRED');
  signal?.throwIfAborted();
  const stage = await fs.mkdtemp(join(dirname(source), 'native-compile-'));
  let preserve = false, started = false;
  const owned = { ...native, python: pythonPath(native), winePrefix: join(stage, '.wine'), compiler: true };
  try {
    await stageFrozenBuild(source, manifestDigest, stage, signal);
    await fs.mkdir(join(stage, 'Include'), { recursive: true });
    // The frozen source manifest contains inputs only; never accept stale output.
    for (const name of ['Experts/Strategy.ex5', 'Experts/Strategy.log']) {
      try { await fs.access(join(stage, name)); throw new Error('Frozen build contains pre-existing compiler output'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (process.platform !== 'win32') await fs.mkdir(owned.winePrefix, { mode: 0o700 });
    started = true;
    const receipt = await runProcess(owned, { kind: 'compiler', editor: join(stage, '.compiler', 'MetaEditor64.exe'), directory: stage }, { signal, graceMs: 0 });
    requireValue(receipt.cleanup?.confirmed === true && receipt.cleanup.activeProcesses === 0, 'Compiler process cleanup was not confirmed', 503, 'runtime_cleanup_failed');
    const log = join(stage, 'Experts', 'Strategy.log'), info = await fs.stat(log);
    requireValue(info.isFile() && info.size <= 8 * 1024 ** 2, 'MetaEditor log is missing or too large');
    const diagnostics = (await fs.readFile(log)).toString('utf16le').replace(/^\uFEFF/, '');
    const output = join(stage, 'Experts', 'Strategy.ex5');
    const success = /Result: 0 errors, \d+ warnings/.test(diagnostics) && existsSync(output);
    let bytes;
    if (success) {
      const stat = await fs.lstat(output); requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 32 * 1024 ** 2, 'Invalid compiler output');
      bytes = await fs.readFile(output);
    }
    return { success, diagnostics, ex5: bytes?.toString('base64') ?? null, ex5_sha256: bytes ? digest(bytes) : null,
      execution: { backend: 'native', nativePid: receipt.nativePid, cleanup: receipt.cleanup, isolation: 'owned-process-job' } };
  } catch (error) { preserve = error.code === 'runtime_cleanup_failed'; throw error; }
  finally {
    // Wine's server is outside the Windows Job. Stop only the fresh prefix,
    // never the user's running terminal prefix or a global wineserver.
    if (started && process.platform !== 'win32') {
      try {
        if (stopWine) await stopWine(owned);
        else {
          const wine = wineCommand(owned), server = isAbsolute(wine) ? join(dirname(wine), 'wineserver') : 'wineserver';
          const env = wineEnvironment(owned);
          // Wine returns 1 when this private prefix has no active server.
          // The subsequent wait must still positively complete.
          await exec(server, ['-k'], { env, timeout: 5000 }).catch(error => { if (error.code !== 1) throw error; });
          await exec(server, ['-w'], { env, timeout: 5000 });
        }
      } catch (cause) { preserve = true; throw new ApiError(503, 'runtime_cleanup_failed', `Cannot confirm private compiler Wine shutdown: ${cause.message}`); }
    }
    if (!preserve) await fs.rm(stage, { recursive: true, force: true });
  }
}
