import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapters } from '../packages/portfolio-execution/adapters.js';
import { nativeAdapterFixture } from './portfolio-adapter-fixture.mjs';

function fixture(failure) {
  const calls = [], hooks = {};
  const host = { context: { kind: 'main' }, plugins: { read: async () => ({ state: 'mounted' }) }, capabilities: { invoke: async (id, input) => {
    calls.push({ id, input });
    if (id.endsWith('#mt5_settings')) return { type: 'result', value: { settings: { account: { login: 'fixture', server: 'Synthetic' }, version: 1 } } };
    if (id.endsWith('#mt5_catalog')) return { type: 'result', value: { items: [{ server: 'python', tools: [{ name: 'order_send', callable: true, inputSchema: { properties: { execution_guard: {} } } }] }] } };
    if (id.endsWith('#mt5_python')) { await hooks.read?.(); return { type: 'result', value: { id: 'observed-command', status: 'failed', ...failure } }; }
    assert.fail(`Unexpected capability ${id}`);
  } } };
  nativeAdapterFixture(host);
  return { host, adapters: createAdapters(host), calls, hooks };
}

test('a confirmed missing Python IPC stops snapshot after one call and preserves actionable native evidence', async () => {
  const { adapters, calls } = fixture({ result: { result: null, last_error: [-10004, 'No IPC connection'] } });
  await assert.rejects(adapters.snapshot('mt5', 'XAUUSD'), error => {
    assert.equal(error.code, 'MT5_PYTHON_UNAVAILABLE');
    assert.equal(error.details.retryable, false); assert.equal(error.details.requiredTransport, 'python');
    assert.equal(error.details.nativeCode, -10004); assert.equal(error.details.nativeMessage, 'No IPC connection');
    assert.equal(error.details.commandId, 'observed-command'); assert.match(error.details.recovery, /new workflow run/);
    return true;
  });
  assert.deepEqual(calls.filter(call => call.id.endsWith('#mt5_python')).map(call => call.input.tool), ['account_info']);
  assert.equal(calls.some(call => call.id.endsWith('#mt5_trade')), false);
});

test('other Python failures retain their native reason without an invented nonretryable classification', async () => {
  const { adapters } = fixture({ error: { code: 'RPC_TIMEOUT', message: 'Native bridge response timed out' }, result: { result: null, last_error: [-10005, 'Timeout'] } });
  await assert.rejects(adapters.snapshot('mt5', 'XAUUSD'), error => {
    assert.equal(error.code, 'RPC_TIMEOUT'); assert.match(error.message, /Native bridge response timed out/);
    assert.equal(error.details.nativeCode, -10005); assert.equal(error.details.retryable, undefined);
    return true;
  });
});

test('aborting a Python read preserves the caller cancellation instead of classifying the late response', async () => {
  const f = fixture({ result: { result: null, last_error: [-10004, 'No IPC connection'] } });
  const controller = new AbortController(), reason = new Error('Stop this observation');
  f.hooks.read = () => controller.abort(reason);
  await assert.rejects(f.adapters.snapshot('mt5', 'XAUUSD', controller.signal), error => error === reason);
  assert.equal(f.calls.filter(call => call.id.endsWith('#mt5_python')).length, 1);
});
