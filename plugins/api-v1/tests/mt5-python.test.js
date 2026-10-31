import { mt5Import, mt5Path } from './mt5-path.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const worker = mt5Path('python-worker.py');
const { MT5Python, winePath } = await mt5Import('process.js');
// Substitute only the external broker package; execute the real JSON-lines
// worker. No MT5 process, stored credentials or broker can be touched.
const broker = `
import runpy, sys, types
mt5 = types.ModuleType('MetaTrader5')
mt5.__version__ = 'fixture'
def connection(login=None, **kwargs):
    return dict(login=login, server=kwargs.get('server'), password_supplied='password' in kwargs,
                password_matches=kwargs.get('password') == 'fixture-password')
mt5.initialize = lambda path, **kwargs: dict(connection(**kwargs), terminal=path,
                                           portable=kwargs.get('portable'), timeout=kwargs.get('timeout'))
mt5.login = connection
mt5.last_error = lambda: (1, 'Success')
mt5.shutdown = lambda: None
np = types.ModuleType('numpy')
np.ndarray = type('ndarray', (), {})
np.generic = type('generic', (), {})
sys.modules.update(MetaTrader5=mt5, numpy=np)
runpy.run_path(sys.argv[1], run_name='__main__')
`;

function call(tool, account, portable = false) {
  const python = process.platform === 'win32' ? process.env.MT5AGENT_PYTHON || 'python' : 'python3';
  const output = spawnSync(python, ['-B', '-c', broker, worker], { encoding: 'utf8', timeout: 10000, windowsHide: true,
    input: JSON.stringify({ tool, account, arguments: {}, terminal: 'fixture-terminal.exe', portable }) + '\n' });
  assert.equal(output.status, 0, output.stderr || output.error?.message);
  assert.doesNotMatch(output.stdout, /fixture-password/);
  return JSON.parse(output.stdout);
}

test('initialize retains the selected account when the password is stored in MT5', () => {
  assert.deepEqual(call('initialize', { login: '700123', server: 'Example-Demo' }).result,
    { login: '700123', server: 'Example-Demo', password_supplied: false, password_matches: false,
      terminal: 'fixture-terminal.exe', portable: false, timeout: 15000 });
});

for (const portable of [true, false]) {
  test(`Python bridge retains the selected terminal and account in ${portable ? 'portable' : 'profile'} mode`, async t => {
    const directory = resolve('fixture-terminal');
    const native = { directory, dataDirectory: portable ? `${directory}/profile/..` : join(directory, 'profile'),
      terminal: join(directory, 'terminal64.exe') };
    const account = { login: '700123', server: 'Example-Demo', password: 'fixture-password' };
    const bridge = new MT5Python(native), sent = [];
    t.mock.method(bridge, 'start', () => {
      bridge.child = { kill() {}, stdin: { write(line) {
        sent.push(JSON.parse(line));
        queueMicrotask(() => bridge.pending.resolve({ result: true }));
      } } };
    });
    t.after(() => bridge.close());
    assert.deepEqual(await bridge.call('initialize', {}, account), { result: true });
    assert.deepEqual(sent, [{ tool: 'initialize', arguments: {}, terminal: winePath(native.terminal), account, portable }]);
    assert.deepEqual(await bridge.call('account_info', {}, account), { result: true });
    assert.deepEqual(sent[1], { tool: 'account_info', arguments: {}, terminal: winePath(native.terminal) },
      'ordinary reads neither initialize again nor forward saved account credentials');
  });

  test(`Python worker initializes the configured terminal with portable=${portable}`, () => {
    assert.deepEqual(call('initialize', { login: '700123', server: 'Example-Demo', password: 'fixture-password' }, portable).result,
      { login: '700123', server: 'Example-Demo', password_supplied: true, password_matches: true,
        terminal: 'fixture-terminal.exe', portable, timeout: 15000 });
  });
}

test('login can reuse saved password and server, or accept explicit credentials', () => {
  assert.deepEqual(call('login', { login: '700123' }).result,
    { login: '700123', server: null, password_supplied: false, password_matches: false });
  assert.deepEqual(call('login', { login: '700123', server: 'Example-Demo', password: 'fixture-password' }).result,
    { login: '700123', server: 'Example-Demo', password_supplied: true, password_matches: true });
});
