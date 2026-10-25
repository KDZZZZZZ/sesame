import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectTerminalProcess } from '../backend/terminal-process.js';

const native = { terminal: 'C:\\Selected MT5\\terminal64.exe' };
const observe = (rows, selected = native) => inspectTerminalProcess(selected, undefined, { platform: 'win32', execProcess: async (_executable, args, options) => {
  assert.equal(options.env.SESAME_MT5_INSPECT_PATH, selected.terminal);
  assert.equal(options.windowsHide, true); assert.ok(options.timeout <= 5000);
  assert.equal(args.includes(selected.terminal), false, 'Selected paths are environment data, not executable code');
  return { stdout: JSON.stringify(rows) };
} });

test('process evidence matches the configured full path instead of any terminal64.exe', async () => {
  const unrelated = { ProcessId: 1101, ExecutablePath: 'C:\\Other MT5\\terminal64.exe' };
  const absent = await observe([unrelated]); assert.equal(absent.running, false); assert.deepEqual(absent.pids, []);
  const exact = await observe([unrelated, { ProcessId: 2202, ExecutablePath: 'c:\\selected mt5\\TERMINAL64.EXE' }]);
  assert.equal(exact.running, true); assert.deepEqual(exact.pids, [2202]);
  assert.equal(exact.terminal_path, native.terminal); assert.ok(Number.isFinite(Date.parse(exact.checked_at)));
});

test('no processes is absent, but inaccessible paths or malformed evidence remain unknown', async () => {
  assert.equal((await observe([])).running, false);
  for (const rows of [[{ ProcessId: 44, ExecutablePath: null }], [{ ProcessId: '44', ExecutablePath: native.terminal }], null]) {
    const result = await observe(rows); assert.equal(result.running, null); assert.equal(result.status, 'unknown');
  }
  const known = await observe([{ ProcessId: 44, ExecutablePath: null }, { ProcessId: 55, ExecutablePath: native.terminal }]);
  assert.equal(known.running, true); assert.deepEqual(known.pids, [55]);
});

test('missing paths, unsupported platforms and query failures never become a closed terminal', async () => {
  const unavailable = () => assert.fail('No process query is possible');
  assert.equal((await inspectTerminalProcess(null, undefined, { platform: 'win32', execProcess: unavailable })).running, null);
  assert.equal((await inspectTerminalProcess(native, undefined, { platform: 'linux', execProcess: unavailable })).running, null);
  const failed = await inspectTerminalProcess(native, undefined, { platform: 'win32', execProcess: async () => { throw new Error('private diagnostic'); } });
  assert.equal(failed.running, null); assert.doesNotMatch(failed.reason, /private diagnostic/);
});

test('cancellation is propagated instead of being mistaken for unknown process status', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectTerminalProcess(native, controller.signal, { platform: 'win32', execProcess: () => assert.fail('No canceled query') }), { name: 'AbortError' });
});

test('Windows inspection script handles literal paths and emits only matching process rows', { skip: process.platform !== 'win32' }, async () => {
  const literal = { terminal: "C:\\MT5 ' $() 中文\\terminal64.exe" };
  const result = await inspectTerminalProcess(literal, undefined, { platform: 'win32', execProcess: async (executable, args, options) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    const fixture = `function Get-CimInstance { param($ClassName)
      [pscustomobject]@{Name='terminal64.exe'; ProcessId=771; ExecutablePath=$env:SESAME_MT5_INSPECT_PATH}
      [pscustomobject]@{Name='unrelated.exe'; ProcessId=882; ExecutablePath=$env:SESAME_MT5_INSPECT_PATH}
    }\n`;
    return promisify(execFile)(executable, [...args.slice(0, -1), Buffer.from(fixture + script, 'utf16le').toString('base64')], options);
  } });
  assert.equal(result.running, true); assert.deepEqual(result.pids, [771]);
});
