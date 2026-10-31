import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ensureMT5Connection } from '../backend/connect.js';
import { MT5Official } from '../backend/official.js';

const refused = () => Object.assign(new Error('connection refused'), { cause: { code: 'ECONNREFUSED' } });
const account = { login: '7001', server: 'Fixture-Demo' };
const server = { enabled: true, url: 'http://127.0.0.1:22346/mcp', token: 'fixture-token' };

function fixture(running = true) {
  const calls = [], native = { terminal: 'C:\\Fixture MT5\\terminal64.exe', directory: 'C:\\Fixture MT5', dataDirectory: 'C:\\Fixture MT5' };
  const config = { version: 1, account: { ...account }, servers: { terminal: { ...server } } };
  const mt5 = { native, official: { config, jobs: new Map(), clients: new Map(), access: () => ({}), redact: value => value }, tester: { pending: new Set() }, deployments: { list: () => [] } };
  const observation = { status: running === null ? 'unknown' : running ? 'running' : 'not_running', running, terminal_path: native.terminal, pids: running ? [1234] : [] };
  const deps = {
    inspectTerminal: async (selected, signal) => { assert.equal(selected, native); signal?.throwIfAborted(); calls.push('inspect_terminal'); return observation; },
    readNativeSettings: async () => { calls.push('native_settings'); return { account, servers: { terminal: server } }; },
    probeAccount: async () => { calls.push('probe'); throw refused(); },
    startTerminal: () => assert.fail('A running or unknown terminal must not be launched again'),
    timeoutMs: 100, pollIntervalMs: 1,
  };
  return { mt5, deps, calls, observation, invoke: (args = { start_if_needed: false }, signal) => ensureMT5Connection(mt5, args, signal, deps) };
}

test('local connection checks the configured terminal process before MCP or account diagnostics', async () => {
  const f = fixture(), result = await f.invoke();
  assert.equal(f.calls[0], 'inspect_terminal');
  assert.equal(result.code, 'mcp_unreachable');
  assert.equal(result.terminal_process.running, true);
  assert.equal(result.terminal_process.terminal_path, f.mt5.native.terminal);
  assert.match(result.reason, /终端已运行/);
  assert.equal(result.steps[0].step, 'inspect_terminal');
});

test('a refused MCP listener is not evidence that a running terminal is closed or logged out', async () => {
  const f = fixture(), result = await f.invoke({ start_if_needed: true });
  assert.equal(result.code, 'mcp_unreachable');
  assert.equal(result.started, false);
  assert.equal(result.terminal_process.running, true);
  assert.doesNotMatch(result.reason, /请.*提供.*(?:密码|token)|请.*登录/);
  assert.equal(result.account, undefined);
  assert.equal(result.mcp_connected, undefined);
  assert.ok(f.calls.filter(value => value === 'probe').length <= 2, 'Do not poll a running terminal with an unavailable MCP service');
});

test('a confirmed closed terminal takes precedence over missing MCP credentials', async () => {
  const f = fixture(false); f.mt5.official.config.servers.terminal.token = '';
  f.deps.readNativeSettings = async () => ({ account, servers: { terminal: { ...server, token: '' } } });
  f.deps.probeAccount = () => assert.fail('No MCP or broker call without a configured token');
  const result = await f.invoke();
  assert.equal(result.code, 'terminal_not_running');
  assert.equal(result.terminal_process.running, false);
  assert.match(result.reason, /mt5_start_terminal/);
  assert.doesNotMatch(result.reason, /索取|提供.*密码|提供.*token/);
});

test('failed or unavailable process inspection stays unknown and never authorizes startup', async () => {
  for (const throwing of [false, true]) {
    const f = fixture(null);
    if (throwing) f.deps.inspectTerminal = async () => { throw new Error('permission denied'); };
    const result = await f.invoke({ start_if_needed: true });
    assert.equal(result.code, 'mcp_unreachable');
    assert.equal(result.terminal_process.running, null);
    assert.equal(result.started, false);
    assert.match(result.reason, /无法确认.*终端进程/);
  }
});

test('explicit MCP 401 and a connected broker keep their distinct proof after process inspection', async () => {
  const denied = fixture(); denied.deps.probeAccount = async () => { throw Object.assign(new Error('Unauthorized'), { upstreamStatus: 401 }); };
  const rejection = await denied.invoke();
  assert.equal(rejection.code, 'mcp_auth_failed'); assert.equal(rejection.terminal_process.running, true);
  const ready = fixture(); ready.deps.probeAccount = async () => ({ account, terminal: { server_connected: true } });
  const connected = await ready.invoke();
  assert.equal(connected.status, 'connected'); assert.equal(connected.broker_connected, true);
  assert.equal(connected.terminal_process.running, true); assert.equal(connected.started, false);
});

test('startup rechecks process absence under ownership and skips a terminal that opened meanwhile', async () => {
  const f = fixture(false); let inspections = 0;
  f.deps.inspectTerminal = async () => ++inspections === 1 ? f.observation : { ...f.observation, status: 'running', running: true, pids: [4321] };
  const result = await f.invoke({ start_if_needed: true });
  assert.equal(inspections, 2); assert.equal(result.started, false);
  assert.equal(result.terminal_process.running, true); assert.equal(result.code, 'mcp_unreachable');
});

test('only a twice-confirmed closed terminal can request startup and then verify the saved account', async t => {
  const f = fixture(false), directory = await mkdtemp(join(tmpdir(), 'mt5-connection-diagnosis-'));
  f.mt5.official.directory = directory; let started = false, launches = 0;
  f.deps.timeoutMs = 10000;
  f.deps.startTerminal = async (native, tool, args, file) => {
    launches++; assert.equal(native, f.mt5.native); assert.equal(tool, 'start_terminal');
    assert.deepEqual(args, { portable: true, use_startup_config: true });
    assert.doesNotMatch(await readFile(file, 'utf8'), /Password|Login|Server=/);
    started = true;
  };
  f.deps.probeAccount = async () => { if (!started) throw refused(); return { account, terminal: { server_connected: true } }; };
  t.after(async () => { assert.equal(dirname(directory), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  const result = await f.invoke({ start_if_needed: true });
  assert.equal(result.status, 'connected'); assert.equal(result.started, true); assert.equal(launches, 1);
  assert.equal(f.calls.filter(value => value === 'inspect_terminal').length, 2);
});

test('broker disconnection is reported only after MCP returns actual broker state', async () => {
  const f = fixture(); f.deps.timeoutMs = 25;
  f.deps.probeAccount = async () => ({ account, terminal: { server_connected: false } });
  const result = await f.invoke();
  assert.equal(result.code, 'broker_offline'); assert.equal(result.mcp_connected, true);
  assert.equal(result.terminal_process.running, true);
});

test('catalog labels an unavailable terminal MCP listener without claiming that the terminal is closed', async () => {
  const fake = { config: { servers: { terminal: { ...server } } }, native: {}, jobs: new Map(), clients: new Map(), redact: value => value,
    tools: async () => { throw refused(); } };
  const result = await MT5Official.prototype.catalog.call(fake, 'terminal');
  assert.equal(result.items[0].status, 'unavailable');
  assert.match(result.items[0].reason, /mt5_connect/);
  assert.doesNotMatch(result.items[0].reason, /正在等待 MT5 启动|请.*登录/);
});

test('catalog without a terminal token routes to process diagnosis before requesting credentials', async () => {
  const fake = { config: { servers: { terminal: { ...server, token: '' } } }, redact: value => value,
    tools: () => assert.fail('An unconfigured catalog must not make native calls') };
  const result = await MT5Official.prototype.catalog.call(fake, 'terminal');
  assert.equal(result.items[0].status, 'unconfigured');
  assert.match(result.items[0].reason, /先用 mt5_connect.*终端是否开启/);
  assert.doesNotMatch(result.items[0].reason, /请.*提供.*(?:密码|token)/);
});
