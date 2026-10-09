import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from '@sesame/plugin-sdk/schema';
import { createTools, replacements } from '../packages/workspace/tools.js';

test('exact edits match the original, reject overlapping regions and preserve BOM/newlines', () => {
  assert.equal(replacements('\uFEFFone\r\ntwo\r\n', [{ oldText: 'one\ntwo', newText: 'three\nfour' }]), '\uFEFFthree\r\nfour\r\n');
  assert.equal(replacements('A B', [{ oldText: 'A', newText: 'B' }, { oldText: 'B', newText: 'C' }]), 'B C');
  assert.throws(() => replacements('ababa', [{ oldText: 'aba', newText: '' }]), /exactly one/);
  assert.throws(() => replacements('abcdef', [{ oldText: 'abc', newText: '' }, { oldText: 'bcde', newText: '' }]), /overlap/);
});

test('file and process operations use only the provided workspace ports', async () => {
  const files = new Map([['/work/input', Buffer.from('one\ntwo\nthree')]]), calls = [];
  const host = { tools: { Type, string: description => Type.String({ description }), define: (name, description, properties, run) => ({ name, description, parameters: Type.Object(properties), execute: (_id, args, signal) => run(args, signal) }) }, environment: { capabilities: { platform: 'linux', shell: '/bin/bash' } }, storage: { directory: 'fixture' }, scope: { conversationId: 'one' }, workspace: {
    path: name => name.startsWith('/') ? name : `/work/${name}`,
    operations: { readFile: async path => files.get(path.startsWith('/') ? path : `/work/${path}`), writeFile: async (path, text) => files.set(path, Buffer.from(text)), mkdir: async () => {} },
    run: async (argv, options) => { calls.push({ argv, options }); return { executionId: 'execution_fixture', exitCode: 0, output: 'actual output' }; },
  } };
  const tools = new Map(createTools(host).map(tool => [tool.name, tool]));
  const read = await tools.get('read').execute('', { path: 'input', offset: 2, limit: 1 }); assert.equal(read.details.next_offset, 3); assert.match(read.content[0].text, /^two/);
  await tools.get('edit').execute('', { path: 'input', edits: [{ oldText: 'two', newText: 'changed' }] }); assert.equal(files.get('/work/input').toString(), 'one\nchanged\nthree');
  const result = await tools.get('bash').execute('', { command: 'printf value', cwd: '/work/project', timeout: 3 });
  assert.equal(result.execution_id, 'execution_fixture'); assert.equal(calls[0].options.cwd, '/work/project'); assert.deepEqual(calls[0].argv, ['/bin/bash', '-c', 'printf value']);
  host.workspace.run = async () => ({ executionId: 'execution_failed', exitCode: 7, output: 'failure details' });
  await assert.rejects(tools.get('bash').execute('', { command: 'exit 7' }), error => {
    assert.equal(error.code, 'PROCESS_EXIT');
    assert.match(error.message, /code 7; execution_id=execution_failed\nfailure details/);
    assert.deepEqual(error.details, { cwd: undefined, shell: '/bin/bash', execution_id: 'execution_failed', exit_code: 7, output: 'failure details', truncated: false });
    return true;
  });
});

test('read preserves host authorization for plugin resources; edits remain in the workspace', async () => {
  const resource = '/installed/plugins/guide/skills/guide/SKILL.md'; let active = true;
  const host = { tools: { Type, string: description => Type.String({ description }), define: (name, description, properties, run) => ({ name, description, parameters: Type.Object(properties), execute: (_id, args, signal) => run(args, signal) }) }, environment: { capabilities: { platform: 'linux', shell: '/bin/bash' } }, storage: { directory: 'fixture' }, scope: { conversationId: 'one' }, workspace: {
    path: name => { assert.ok(name.startsWith('/work/'), 'workspace access only'); return name; },
    operations: { readFile: async path => { assert.equal(path, resource); if (!active) throw Object.assign(new Error('Plugin resource is not active'), { code: 'FORBIDDEN' }); return Buffer.from('Authorized resource'); } },
  } };
  const tools = new Map(createTools(host).map(tool => [tool.name, tool]));
  assert.equal((await tools.get('read').execute('', { path: resource })).content[0].text, 'Authorized resource');
  assert.throws(() => tools.get('edit').execute('', { path: resource, edits: [{ oldText: 'resource', newText: 'changed' }] }), /workspace access only/);
  active = false;
  await assert.rejects(tools.get('read').execute('', { path: resource }), { code: 'FORBIDDEN' });
});

test('Windows commands use the discovered PowerShell without rewriting source or cwd', async () => {
  let received;
  const host = { tools: { Type, string: description => Type.String({ description }), define: (name, description, properties, run) => ({ name, execute: (_id, args, signal) => run(args, signal) }) }, environment: { capabilities: { platform: 'win32', shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' } }, storage: { directory: 'fixture' }, scope: { conversationId: 'one' }, workspace: {
    operations: {}, root: () => 'C:\\Tasks\\one',
    run: async (argv, options) => { received = { argv, options }; return { executionId: 'host-execution', exitCode: 0, output: 'value', cwd: 'C:\\Tasks\\one' }; },
  } };
  const source = 'Write-Output "/work/is-literal"', signal = new AbortController().signal;
  const result = await createTools(host).find(tool => tool.name === 'bash').execute('', { command: source }, signal);
  assert.deepEqual(received.argv, [host.environment.capabilities.shell, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', source]);
  assert.equal(received.options.signal, signal); assert.equal(result.cwd, 'C:\\Tasks\\one'); assert.equal(result.shell, host.environment.capabilities.shell);
});
