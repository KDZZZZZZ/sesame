import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { runTesterProcess } from '../../optional-api-v1/packages/mt5/backend/tester-process.js';

const request = { terminal: '/private/tester/terminal64.exe', ini: '/private/tester/pass.ini', directory: '/private/tester' };
const native = { directory: '/private/installed', python: '/private/python.exe' };
function processFixture(plan) {
  return () => {
    const child = new EventEmitter(); child.pid = 2000000000; child.kill = () => child.emit('close');
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const send = value => child.stdout.write(JSON.stringify(value) + '\n');
    child.stdin = new Writable({ write(bytes, _encoding, done) { plan(bytes.toString(), send, child); done(); } });
    return child;
  };
}
const started = { type: 'started', pid: 77, jobOwned: true };
const completed = { type: 'result', ok: true, cleanup: { confirmed: true, activeProcesses: 0 }, code: null };

test('a private Tester Job receipt confirms the native process and cleanup', async () => {
  let observed;
  const result = await runTesterProcess(native, request, { onStarted: pid => { observed = pid; }, spawnProcess: processFixture((_line, send, child) => { queueMicrotask(() => { send(started); send(completed); child.emit('close'); }); }) });
  assert.equal(observed, 77); assert.equal(result.nativePid, 77); assert.equal(result.cleanup.activeProcesses, 0);
});

for (const [name, messages] of [
  ['wrapper exit without receipt', []],
  ['native PID without cleanup', [started]],
  ['native processes still present', [started, { ...completed, cleanup: { confirmed: true, activeProcesses: 1 } }]],
  ['success without native identity', [completed]],
  ['contradictory cleanup error', [started, { ...completed, code: 'runtime_cleanup_failed' }]],
  ['repeated protocol completion', [started, completed, completed]],
]) test(`preserves task state after ${name}`, async () => {
  await assert.rejects(runTesterProcess(native, request, { spawnProcess: processFixture((_line, send, child) => queueMicrotask(() => { messages.forEach(send); child.emit('close'); })) }), { code: 'runtime_cleanup_failed' });
});

test('cancellation waits for a positive native Job cleanup acknowledgement', async () => {
  const controller = new AbortController(); let acknowledged = false;
  const pending = runTesterProcess(native, request, { signal: controller.signal, graceMs: 1, spawnProcess: processFixture((line, send, child) => {
    if (line === 'cancel\n') queueMicrotask(() => { acknowledged = true; send({ ...completed, ok: false, error: 'Tester canceled' }); child.emit('close'); });
    else queueMicrotask(() => { send(started); controller.abort(); });
  }) });
  await assert.rejects(pending, /canceled/); assert.equal(acknowledged, true);
});
