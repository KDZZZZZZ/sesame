import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createCapabilities as orchestration } from '../packages/orchestration/index.js';
import { createCapabilities as management } from '../packages/plugin-manager/index.js';
import { scaffold, writeDraft } from '../packages/plugin-manager/scaffold.js';

test('orchestration delegates explicit limits and uses actual Run wait/read/cancel', async () => {
  const calls = [], host = { capabilities: { invoke: (...args) => { calls.push(['invoke', ...args]); return { type: 'run', run: { id: 'run_1' } }; } }, runs: {
    list: input => ({ items: [input] }), wait: async (...args) => { calls.push(['wait', ...args]); return { reason: 'settled' }; },
    read: (...args) => { calls.push(['read', ...args]); return { run: { id: args[0], status: 'completed' } }; },
    cancel: (...args) => { calls.push(['cancel', ...args]); return { run: { id: args[0], status: 'cancelled' } }; },
  } };
  const tools = new Map(orchestration(host).map(item => [item.name, item.execute]));
  assert.equal(tools.has('agent_finish'), false);
  const input = { title: 'Check', instructions: 'Calculate only.', objective: 'A result', input: {}, allowedCalls: [], budget: { maxTurns: 1, maxToolCalls: 0, timeoutMs: 5000 } };
  const signal = new AbortController().signal;
  assert.equal((await tools.get('agent_delegate')(input, signal)).run.id, 'run_1');
  assert.equal(calls[0][1], 'host.agent.run'); assert.deepEqual(calls[0][2], input); assert.equal(calls[0][3].signal, signal);
  const result = await tools.get('agent_inspect')({ runId: 'run_1', wait: 'settled', includeHistory: true }, signal);
  assert.equal(result.waitReason, 'settled'); assert.deepEqual(calls[2][2].include, ['messages', 'calls', 'events', 'outputs', 'resources']);
  await tools.get('agent_stop')({ runId: 'run_1', reason: 'done' }); assert.deepEqual(calls.at(-1), ['cancel', 'run_1', { reason: 'done' }]);
});

test('management exposes one install operation with digest and cancellation intact', async () => {
  const calls = [], host = { plugins: { install: (...args) => { calls.push(args); return { plugin: { id: 'example/p' }, receipt: {} }; } } };
  const tools = new Map(management(host).map(item => [item.name, item.execute]));
  for (const name of ['plugin_test', 'plugin_validate', 'plugin_rollback', 'plugin_export']) assert.equal(tools.has(name), false);
  const signal = new AbortController().signal, result = await tools.get('plugin_install')({ path: '/actual/package', digest: 'sha256:fixed', operationId: 'same-operation' }, signal);
  assert.equal(result.plugin.id, 'example/p'); assert.deepEqual(calls[0][0], { path: '/actual/package', digest: 'sha256:fixed' }); assert.equal(calls[0][1].signal, signal);
});

test('portable native and knowledge templates declare complete API 2 shapes and native bindings execute', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sesame-v2-scaffold-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const template of ['native', 'skill']) {
    const recipe = scaffold({ name: 'test-example', publisher: 'fixture', description: 'A fixture', template });
    const manifest = JSON.parse(recipe.files['plugin.json']), declarations = JSON.parse(recipe.files['capabilities.json']);
    assert.equal(manifest.apiVersion, '2'); assert.equal(manifest.tool_names, undefined); assert.equal(recipe.files['tools.json'], undefined);
    for (const key of ['capabilities', 'sources', 'views', 'services', 'hooks', 'knowledge', 'stateCollections', 'artifactSchemas']) assert.ok(Array.isArray(declarations[key]), key);
    assert.equal(declarations.capabilities.length, template === 'native' ? 1 : 0);
    const path = join(root, template); await writeDraft(path, recipe);
    const implementation = await import(pathToFileURL(join(path, 'index.js')).href);
    assert.equal(implementation.createTools, undefined);
    const capabilities = implementation.createCapabilities({});
    if (template === 'native') assert.deepEqual(await capabilities[0].execute({ text: 'actual' }), { text: 'actual' });
    await assert.rejects(writeDraft(path, recipe), { code: 'EEXIST' });
    assert.equal(await readFile(join(path, 'index.js'), 'utf8'), recipe.files['index.js']);
  }
});

test('migrated declarations exactly match the production native factory identities', async () => {
  for (const name of ['orchestration', 'plugin-manager', 'workspace']) {
    const root = new URL(`../packages/${name}/`, import.meta.url);
    const descriptor = JSON.parse(await readFile(new URL('capabilities.json', root), 'utf8'));
    const implementation = await import(new URL('index.js', root).href);
    const host = { context: { filePolicy: { protectedRoots: [], readRoots: [], writeRoots: [] } } };
    assert.deepEqual(implementation.createCapabilities(host).map(item => item.name).sort(), descriptor.capabilities.map(item => item.binding.name).sort());
    assert.ok(descriptor.capabilities.every(item => item.usage.inputs && item.usage.outputs && item.inputSchema && item.outputSchema));
  }
});
