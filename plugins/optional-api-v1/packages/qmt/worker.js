import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One fixed SDK bridge. Cancellation targets only the Python process tree we own. */
export async function execute(payload, { signal, directory }) {
  if (process.platform !== 'win32') throw Object.assign(new Error('QMT requires native Windows x64, a broker-authorized running MiniQMT, and its compatible Python SDK.'), { code: 'PREREQUISITE_REQUIRED' });
  if (!isAbsolute(payload.python) || !['verify','prepare','search','describe','quotes','asset','positions','orders','fills'].includes(payload.action)) throw Object.assign(new Error('Invalid fixed QMT bridge request'), { code: 'INVALID_ARGUMENT' });
  const cwd = join(directory, 'bridge'); await mkdir(cwd, { recursive: true });
  signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const child = spawn(payload.python, ['-I', '-B', fileURLToPath(new URL('./bridge.py', import.meta.url))], { cwd, windowsHide: true, stdio: ['pipe','pipe','pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let output = '', diagnostics = '', error, stop;
    const cancel = reason => {
      error ??= reason;
      if (!stop && child.pid) stop = new Promise(done => {
        const task = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        task.once('error', () => { child.kill(); done(); }); task.once('close', done);
      });
    };
    const abort = () => cancel(signal.reason ?? Object.assign(new Error('QMT read cancelled'), { code: 'CANCELLED' }));
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { if (error) return; output += text; if (Buffer.byteLength(output) > 8 * 1024 * 1024) cancel(Object.assign(new Error('QMT result exceeds 8 MiB'), { code: 'RESOURCE_EXHAUSTED' })); });
    child.stderr.on('data', text => { diagnostics = (diagnostics + text).slice(-65536); });
    child.on('error', value => { error = value; });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(payload));
    child.once('close', async code => {
      signal?.removeEventListener('abort', abort); if (stop) await stop;
      if (error) return reject(error);
      let value; try { const receipts = output.split(/\r?\n/).filter(line => line.startsWith('SESAME_QMT_RESULT:')); if (receipts.length !== 1) throw new Error('Invalid receipt count'); value = JSON.parse(receipts[0].slice('SESAME_QMT_RESULT:'.length)); } catch { return reject(Object.assign(new Error('QMT bridge returned no valid receipt'), { code: 'SOURCE_UNAVAILABLE', details: { exitCode: code, diagnostics } })); }
      if (!value.ok || code !== 0) return reject(Object.assign(new Error(value.error?.message ?? 'QMT bridge failed'), { code: value.error?.code ?? 'SOURCE_UNAVAILABLE', details: value.error?.details ?? { diagnostics } }));
      resolve({ ...value, process: { exitCode: code, nativePid: child.pid, cleanup: 'exited' } });
    });
    if (signal?.aborted) abort();
  });
}
