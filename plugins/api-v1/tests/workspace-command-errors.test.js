import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Type } from '@sesame/plugin-sdk/schema';
import { createTools } from '../packages/workspace/tools.js';

const string = description => Type.String({ description, minLength: 1, maxLength: 20000 });
const toolsPort = { Type, string, define: (name, description, properties, run) => ({ name, label: name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute: (_id, args, signal) => run(args, signal) }) };
function fixture(run, read) {
  const host = { tools: toolsPort, storage: { directory: 'fixture' }, scope: { conversationId: 'owner' }, environment: { capabilities: { platform: 'linux', shell: '/bin/bash' } }, workspace: { operations: {}, root: () => '/tasks/current', run }, executions: { read } };
  return createTools(host).find(tool => tool.name === 'bash');
}

test('timeouts, output limits and cancellation expose captured progress and preserve failure identity', async () => {
  for (const [code, status] of [['host_command_timeout', 504], ['host_command_output_limit', 413], ['host_command_canceled', 409]]) {
    const original = Object.assign(new Error('Native command failed'), { code, status, details: { executionId: `exec_${code}`, cwd: '/tasks/native', output: 'downloaded verified wheel 3/4', snapshot_errors: [{ stage: 'after', message: 'External directory was not captured' }] } });
    const tool = fixture(async () => { throw original; }, () => { throw new Error('Record temporarily unavailable'); });
    await assert.rejects(tool.execute('call', { command: 'actual command' }), error => {
      assert.equal(error.code, code); assert.equal(error.status, status); assert.equal(error.cause, original);
      assert.equal(error.details.execution_id, original.details.executionId); assert.equal(error.details.cwd, '/tasks/native');
      assert.equal(error.details.exit_code, null); assert.equal(error.details.truncated, false);
      assert.equal(error.details.output, original.details.output); assert.deepEqual(error.details.snapshot_errors, original.details.snapshot_errors);
      assert.ok(error.message.includes(`execution_id=${original.details.executionId}`)); assert.ok(error.message.includes(original.details.output));
      assert.match(error.message, /"snapshot_errors":\[\{"stage":"after"/);
      return true;
    });
  }
});

test('missing immediate output is recovered from the exact host execution without replacing the original error', async () => {
  const signal = new AbortController().signal, reads = [];
  const original = Object.assign(new Error('Canceled after launch'), { name: 'AbortError', code: 'host_command_canceled', details: { executionId: 'exec_retained' } });
  const tool = fixture(async (_argv, options) => { assert.equal(options.signal, signal); throw original; }, id => {
    reads.push(id); return { id, workspace_path: '/persisted/cwd', exit_code: null, output: 'checkpoint available', snapshot_errors: [{ stage: 'before', message: 'Input evidence incomplete' }] };
  });
  await assert.rejects(tool.execute('call', { command: 'native operation' }, signal), error => {
    assert.equal(error.name, 'AbortError'); assert.equal(error.code, 'host_command_canceled');
    assert.equal(error.details.cwd, '/persisted/cwd'); assert.equal(error.details.output, 'checkpoint available');
    assert.ok(error.message.includes('Input evidence incomplete')); return true;
  });
  assert.deepEqual(reads, ['exec_retained']);
});

test('output tails are UTF-8 and byte bounded on failure and success; unavailable execution IDs are honest', async () => {
  const output = 'old output\n' + '进度🟢'.repeat(6000) + '\nverified checkpoint';
  const failed = fixture(async () => { throw Object.assign(new Error('Output limit'), { code: 'host_command_output_limit', details: { output } }); }, () => { assert.fail('No execution identity to read'); });
  await assert.rejects(failed.execute('call', { command: 'native operation' }), error => {
    assert.equal(error.details.execution_id, null); assert.equal(error.details.truncated, true);
    assert.ok(Buffer.byteLength(error.details.output) <= 50000); assert.ok(output.endsWith(error.details.output));
    assert.equal(error.details.output.includes('\uFFFD'), false); assert.match(error.message, /execution_id=unavailable/);
    assert.equal(error.message.includes('old output'), false); return true;
  });
  const successful = fixture(async () => ({ executionId: 'exec_ok', exitCode: 0, output }));
  const result = await successful.execute('call', { command: 'native operation' });
  assert.equal(result.truncated, true); assert.ok(Buffer.byteLength(result.output) <= 50000); assert.ok(output.endsWith(result.output));
});

test('short upstream-truncated failure and recorded tails remain visibly incomplete', async () => {
  for (const fromRecord of [false, true]) {
    const original = Object.assign(new Error('Captured output was capped'), { code: 'host_command_output_limit', details: { executionId: 'exec_capped', ...(fromRecord ? {} : { output: 'retained tail', truncated: true }) } });
    const tool = fixture(async () => { throw original; }, () => ({ output: 'recorded tail', truncated: true }));
    await assert.rejects(tool.execute('call', { command: 'native operation' }), error => {
      assert.equal(error.cause, original); assert.equal(error.details.truncated, true);
      assert.equal(error.details.output, fromRecord ? 'recorded tail' : 'retained tail');
      assert.match(error.message, /"truncated":true/); return true;
    });
  }
});

test('successful and nonzero commands preserve the host truncation flag for short output', async () => {
  for (const exitCode of [0, 7]) {
    const tool = fixture(async () => ({ executionId: 'exec_capped', exitCode, output: 'host tail', truncated: true }));
    if (exitCode === 0) assert.equal((await tool.execute('call', { command: 'native operation' })).truncated, true);
    else await assert.rejects(tool.execute('call', { command: 'native operation' }), error => {
      assert.equal(error.code, 'PROCESS_EXIT'); assert.equal(error.details.truncated, true);
      assert.match(error.message, /"truncated":true/); return true;
    });
  }
});

test('workspace tool schemas match the shipped descriptions after failure diagnostics change', () => {
  const expected = JSON.parse(readFileSync(new URL('../packages/workspace/tools.json', import.meta.url))).filter(tool => !tool.name.startsWith('host_files_'));
  const actual = createTools({ tools: toolsPort, workspace: {} }).map(({ execute, ...definition }) => definition);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
});
