import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mt5Import } from './mt5-path.js';

const { launch } = await mt5Import('process.js');
const native = { directory: 'C:\\Program Files\\MetaTrader 5', terminal: 'C:\\Program Files\\MetaTrader 5\\terminal64.exe', editor: 'C:\\Program Files\\MetaTrader 5\\MetaEditor64.exe' };
const config = 'C:\\Users\\Jane Doe 芝麻\\AppData\\Local\\Temp\\sesame-mt5-config-unique\\terminal.ini';

const spawnFixture = calls => (program, args, options) => {
  const child = new EventEmitter(); child.pid = 12345;
  child.unref = () => { calls.at(-1).unreferenced = true; };
  calls.push({ program, args, options });
  queueMicrotask(() => child.emit('spawn'));
  return child;
};

test('native Windows startup passes value-quoted config and profile with verbatim argv and a quoted executable', async () => {
  const calls = [];
  const result = await launch(native, 'start_terminal', { portable: true, profile: 'Research 芝麻', use_account_login: true, configured_login: '7001', use_startup_config: true }, config, {}, undefined, { platform: 'win32', spawnProcess: spawnFixture(calls) });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.program, native.terminal, 'Executable lookup receives the unquoted real path');
  assert.deepEqual(call.args, ['/portable', '/profile:"Research 芝麻"', '/login:7001', `/config:"${config}"`]);
  assert.equal(call.options.windowsVerbatimArguments, true, 'Node must not whole-token quote or escape the option values again');
  assert.equal(call.options.argv0, `"${native.terminal}"`, 'Verbatim mode must also preserve the spaced executable token');
  assert.equal(Boolean(call.options.shell), false);
  const raw = [call.options.argv0, ...call.args].join(' ');
  assert.equal(raw.match(/\/config:"([^"]+)"/)[1], config);
  assert.doesNotMatch(raw, /"\/config:|\\"|\/password:/);
  assert.equal(result.status, 'spawned'); assert.equal(call.unreferenced, true);
});

test('native Windows editor startup quotes argv0 without adding terminal flags', async () => {
  const calls = [];
  await launch(native, 'start_editor', {}, null, {}, undefined, { platform: 'win32', spawnProcess: spawnFixture(calls) });
  assert.equal(calls[0].program, native.editor);
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].options.argv0, `"${native.editor}"`);
  assert.equal(calls[0].options.windowsVerbatimArguments, true);
});

test('native Windows launch refuses embedded option delimiters without starting or echoing private input', async () => {
  for (const bad of ['"', '\r', '\n', '\0']) {
    const calls = [];
    for (const [installation, args, file] of [
      [native, { use_startup_config: true }, `private-path${bad}tail`],
      [native, { profile: `private-profile${bad}tail` }, null],
      [{ ...native, terminal: `private-executable${bad}tail` }, {}, null],
    ]) {
      await assert.rejects(launch(installation, 'start_terminal', args, file, {}, undefined, { platform: 'win32', spawnProcess: spawnFixture(calls) }), error => {
        assert.doesNotMatch(error.message, /private-(?:path|profile|executable)/);
        return ['invalid_native_path', 'invalid_native_argument'].includes(error.code);
      });
    }
    assert.deepEqual(calls, []);
  }
  await assert.rejects(launch(native, 'start_terminal', { use_account_login: true, configured_login: '7001 /config:other' }, null, {}, undefined, { platform: 'win32', spawnProcess: () => assert.fail('Must not spawn') }), { code: 'invalid_native_argument' });
});
