import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pythonPath, winePath } from './process.js';
import { wineCommand, wineEnvironment } from './platform.js';
import { ApiError } from './support.js';

const worker = fileURLToPath(new URL('./tester-process.py', import.meta.url));
const cleanupError = message => new ApiError(503, 'runtime_cleanup_failed', message);

/** The helper owns a fresh native Job, never an existing terminal. */
export function runTesterProcess(native, request, { signal, onStarted = () => {}, spawnProcess = spawn, graceMs = 5000, watchdogMs = 20000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const python = pythonPath(native), args = ['-I', '-B', '-u', winePath(worker)];
    const child = spawnProcess(process.platform === 'win32' ? python : wineCommand(), process.platform === 'win32' ? args : [python, ...args], { env: wineEnvironment(native.directory), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    let buffer = '', diagnostics = '', result, nativePid, protocolError, cancelTimer, watchdog, timeout, settled = false;
    const force = () => { try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const cancel = () => {
      cancelTimer ??= setTimeout(() => { if (!settled) child.stdin.write('cancel\n'); }, graceMs);
      watchdog ??= setTimeout(force, watchdogMs);
    };
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    timeout = setTimeout(cancel, 15 * 60000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', text => {
      buffer += text;
      if (Buffer.byteLength(buffer) > 65536) { protocolError = cleanupError('Tester 进程控制回执超限；现场保留'); cancel(); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const value = JSON.parse(line);
          if (value.type === 'started' && Number.isSafeInteger(value.pid) && value.pid > 0 && value.jobOwned === true && nativePid === undefined) { nativePid = value.pid; onStarted(nativePid, child.pid); }
          else if (value.type === 'result' && result === undefined) result = value;
          else throw new Error('Unknown or repeated Tester receipt');
        } catch (error) { protocolError = cleanupError(`Tester 控制协议无效：${error.message}`); cancel(); }
      }
    });
    child.stderr.on('data', text => { diagnostics = (diagnostics + text.toString()).slice(-32768); });
    child.stdin.on('error', () => {});
    const finish = error => {
      if (settled) return; settled = true;
      clearTimeout(cancelTimer); clearTimeout(watchdog); clearTimeout(timeout); signal?.removeEventListener('abort', cancel);
      if (error && nativePid === undefined) return reject(new ApiError(503, 'tester_unavailable', error.message));
      if (protocolError || !result || buffer.trim() || result.cleanup?.confirmed !== true || result.cleanup.activeProcesses !== 0 || typeof result.ok !== 'boolean' || result.code || result.ok && nativePid === undefined) return reject(protocolError ?? cleanupError('原生 Tester Job 尚未确认清空；任务文件保留，不自动重试'));
      if (signal?.aborted || !result.ok) return reject(new Error(result.error || '回测已取消'));
      resolve({ nativePid, diagnostics, cleanup: result.cleanup });
    };
    child.once('error', finish); child.once('close', () => finish());
    child.stdin.write(JSON.stringify(Object.fromEntries(Object.entries(request).map(([key, value]) => [key, winePath(value)]))) + '\n');
  });
}
