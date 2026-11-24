import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function memoryHost(t, respond) {
  const load = name => import(pathToFileURL(join(process.env.SESAME_HOST_ROOT, name)));
  const [{ Store }, { Runtime }, { createHostContextV2 }] = await Promise.all([
    load('modules/agent/store.js'), load('modules/agent/runtime.js'), load('modules/plugins/host-v2/context.js'),
  ]);
  const root = await mkdtemp(join(tmpdir(), 'sesame-memory-host-')), store = new Store(join(root, 'state'));
  const runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: join(root, 'empty') }).init();
  t.after(async () => { await runtime.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  runtime.modelRuntime.registerProvider('fixture', { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'fixture-only',
    models: [{ id: 'curator', name: 'Isolated curation fixture', input: ['text'], reasoning: false, contextWindow: 200000,
      maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  await runtime.modelRuntime.setRuntimeApiKey('fixture', 'fixture-only');
  runtime.model = runtime.modelRuntime.getModel('fixture', 'curator');
  const calls = [];
  runtime.sessionModels = { completeSimple: async (model, request, options) => {
    const input = JSON.parse(request.messages[1].content); calls.push(input);
    const result = await respond(input, options);
    return { provider: model.provider, model: model.id, stopReason: 'stop', usage: { input: 1, output: 1 },
      content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
  } };
  const main = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
  const target = join(runtime.workspaces.root('conv_main'), 'memory');
  await cp(new URL('../../packages/memory/', import.meta.url), target, { recursive: true });
  await main.plugins.install({ path: target });
  await main.plugins.setEnabled('sesame/memory', true, { scope: 'workspace' });
  const entry = runtime.plugins.entry('sesame/memory');
  assert.equal(entry.runtime_status, 'ready', JSON.stringify(entry.diagnostics));
  const child = runtime.createConversation('research', 'Study ETF data quality', 'conv_main', 'child');
  assert.ok(runtime.plugins.active(child.id, 'sesame/memory'));
  function bindChild() {
    const run = runtime.runs.start({ kind: 'agent', capabilityId: 'host.agent.run', sessionId: 'conv_main',
      operationId: crypto.randomUUID(), input: {} }, async () => ({ text: 'Study complete' }));
    runtime.runs.bindSession(run.id, child.id);
    store.update('conversation', child.id, { host_run_id: run.id, owner_session_id: 'conv_main' });
    return run;
  }
  return { runtime, store, calls, child, entry, bindChild };
}
