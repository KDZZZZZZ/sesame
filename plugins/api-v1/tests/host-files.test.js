import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Type } from '@sesame/plugin-sdk/schema';
import { Check } from '@sesame/plugin-sdk/schema/value';
import { createTools } from '../packages/host-files/tools.js';

function fixture() {
  const calls = [];
  const externalFiles = Object.fromEntries(['list', 'search', 'read', 'import', 'write', 'mkdir', 'move', 'remove', 'run'].map(method => [method, async (args, signal) => { calls.push({ method, args, signal }); return { method, completed: true }; }]));
  const tools = createTools({ tools: { Type, define: (name, description, properties, execute) => ({ name, label: name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) }, externalFiles });
  return { calls, tools, byName: new Map(tools.map(tool => [tool.name, tool])) };
}

test('declared host file schemas match nine concrete SDK ports', () => {
  const f = fixture();
  const declared = JSON.parse(readFileSync(new URL('../packages/host-files/tools.json', import.meta.url)));
  const manifest = JSON.parse(readFileSync(new URL('../packages/host-files/plugin.json', import.meta.url)));
  assert.deepEqual(f.tools.map(({ execute, ...tool }) => tool), declared);
  assert.deepEqual(f.tools.map(tool => tool.name), manifest.tool_names);
  assert.equal(f.tools.length, 9);
});

test('writes, moves and removal preserve explicit overwrite and whole-file expectations', async () => {
  const f = fixture(), signal = new AbortController().signal;
  const write = { path: '/existing/config.json', content: '{}', overwrite: true, expected_sha256: `sha256:${'a'.repeat(64)}` };
  await f.byName.get('host_files_write').execute(write, signal);
  await f.byName.get('host_files_move').execute({ path: '/existing/config.json', destination: '/existing/config.old.json' }, signal);
  await f.byName.get('host_files_remove').execute({ path: '/existing/config.old.json', expected_sha256: 'b'.repeat(64) }, signal);
  assert.equal(f.calls[0].args, write); assert.equal(f.calls[0].signal, signal);
  assert.deepEqual(f.calls.map(call => call.method), ['write', 'move', 'remove']);
  assert.equal(Check(f.byName.get('host_files_remove').parameters, { path: '/directory', recursive: true }), false);
});

test('host commands preserve argv, empty arguments, explicit cwd, env and cancellation', async () => {
  const f = fixture(), tool = f.byName.get('host_files_run'), signal = new AbortController().signal;
  const args = { argv: ['/existing/python', '-c', 'print("literal $value")', ''], cwd: '/existing/project', timeout: 600, env: { DEMO_SETTING: 'value' } };
  assert.equal(Check(tool.parameters, args), true);
  assert.equal(Check(tool.parameters, { ...args, timeout: 601 }), false);
  assert.equal(Check(tool.parameters, { ...args, argv: [] }), false);
  await tool.execute(args, signal); assert.deepEqual(f.calls[0], { method: 'run', args, signal });
});
