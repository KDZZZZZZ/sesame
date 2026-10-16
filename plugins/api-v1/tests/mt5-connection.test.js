import { mt5Import, mt5Path } from './mt5-path.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { Tester, testerFiles } = await mt5Import('tester.js');
const { proxySettings, testerProxyLines, waitForTradingConnection } = await mt5Import('connection.js');
const { MT5Official } = await mt5Import('official.js');
const { DEFAULT_RISK_LIMITS } = await mt5Import('contracts.js');

const account = { login: '12345678', server: 'Fixture-Demo', password: 'fixture-account-only' };
const pass = { id: 'pass_fixture', build_id: 'build_fixture', risk_limits: DEFAULT_RISK_LIMITS,
  config: { symbol: 'EURUSD', period: 'H1', model: 1, from_date: '2026-09-01', to_date: '2026-09-02', deposit: 10000, currency: 'USD', leverage: 100, parameters: {} } };

test('isolated Tester inherits only explicit proxy settings, clears stale proxies, and redacts proxy credentials', () => {
  const ini = '\ufeff[Common]\r\nLogin=999\r\nServer=Wrong-Demo\r\nProxyEnable=1\r\nProxyType=1\r\nProxyAddress=192.0.2.10:7890\r\nProxyLogin=tester\r\nProxyPassword=fixture=proxy-password\r\n[Experts]\r\nAllowLiveTrading=1\r\n[StartUp]\r\nExpert=Unsafe\r\n[Tester]\r\nUseCloud=1\r\n';
  const output = testerFiles(pass, account, ini).ini;
  assert.match(output, /Login=12345678\r\n/);
  assert.match(output, /Server=Fixture-Demo\r\n/);
  assert.match(output, /ProxyEnable=1\r\nProxyType=1\r\nProxyAddress=192\.0\.2\.10:7890\r\nProxyLogin=tester\r\nProxyPassword=fixture=proxy-password\r\n/);
  assert.match(output, /AllowLiveTrading=0/); assert.match(output, /UseCloud=0/);
  assert.doesNotMatch(output, /Wrong-Demo|Unsafe|\[StartUp\]|AllowLiveTrading=1/);
  assert.deepEqual(testerProxyLines(''), ['ProxyEnable=0']);
  assert.deepEqual(testerProxyLines('[Common]\nProxyEnable=0\nProxyPassword=old\n'), ['ProxyEnable=0']);
  assert.deepEqual(testerProxyLines('[Tester]\nProxyEnable=1\n'), ['ProxyEnable=0']);
  assert.equal(proxySettings('[common]\nproxyenable = 1\nPROXYTYPE=2\n;ProxyType=0\n').ProxyType, '2');
  for (const invalid of ['[Common]\nProxyEnable=1', '[Common]\nProxyEnable=bad', '[Common]\nProxyEnable=1\nProxyType=1\nProxyAddress=host:99999']) assert.throws(() => testerProxyLines(invalid));
  const official = new MT5Official({ storage: {} }, null);
  official.config = { account, servers: {}, startup_ini: ini };
  assert.equal(official.redact('proxy: fixture=proxy-password'), 'proxy: [redacted]');
});

test('readiness recovers transient reads and waits for broker synchronization, without any trading calls', async () => {
  const progress = [], calls = [];
  const client = { async call(name, args) {
    calls.push(name); assert.deepEqual(args, {});
    if (calls.length === 1) throw new Error('temporary IPC disconnect');
    if (calls.length === 2) return { isError: true, content: [{ type: 'text', text: 'reconnecting' }] };
    const data = { account, terminal: { server_connected: calls.length === 4 } };
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } };
  const result = await waitForTradingConnection(client, account, { timeout: 2000, delay: 1, progress: text => progress.push(text) });
  assert.equal(result.terminal.server_connected, true); assert.equal(progress.length, 3);
  assert.deepEqual(calls, Array(4).fill('get_trading_account_info'));
  let attempts = 0;
  await assert.rejects(waitForTradingConnection({ async call() { attempts++; return { structuredContent: { account: { ...account, login: '999' }, terminal: { server_connected: true } } }; } }, account), { code: 'mt5_account_mismatch' });
  assert.equal(attempts, 1);
});

test('offline readiness expires and user cancellation stops polling', async () => {
  const client = { async call() { return { structuredContent: { account, terminal: { server_connected: false } } }; } };
  await assert.rejects(waitForTradingConnection(client, account, { timeout: 25, delay: 1 }), { code: 'mt5_connection_unavailable' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(waitForTradingConnection({ call() { assert.fail('canceled readiness must not call MT5'); } }, account, { signal: controller.signal }), { name: 'AbortError' });
});

test('reused Tester logs include only this launch, preserving UTF-16 and UTF-8 boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mt5-connection-log-'));
  const tester = new Tester({ official: { redact: text => text } });
  try {
    await mkdir(join(directory, 'logs')); await mkdir(join(directory, 'Tester/logs'), { recursive: true });
    const native = join(directory, 'logs', '20261001.log'), agent = join(directory, 'Tester/logs', '20261001.log');
    await writeFile(native, Buffer.from('\ufeffold connection lost\r\n', 'utf16le'));
    await writeFile(agent, '旧任务连接错误\n');
    const offsets = await tester.logOffsets(directory);
    await appendFile(native, Buffer.from(`'${account.login}': authorized on Fixture-Demo\r\n`, 'utf16le'));
    await appendFile(agent, '本次回测已启动\n');
    await writeFile(join(directory, 'logs', '20261002.log'), Buffer.from('\ufeffnew day log\r\n', 'utf16le'));
    const logs = await tester.logs(directory, 0, account, true, offsets);
    assert.doesNotMatch(logs, /old connection lost|旧任务|12345678/);
    assert.match(logs, /\[redacted\].*: authorized/); assert.match(logs, /本次回测已启动/); assert.match(logs, /new day log/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
