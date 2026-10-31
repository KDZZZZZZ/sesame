import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginRegistry } from '../../../../mt5agent/modules/agent/plugin-registry.js';
import { Store } from '../../../../mt5agent/modules/agent/store.js';
import { Runtime } from '../../../../mt5agent/modules/agent/runtime.js';
import { createHostContextV2 } from '../../../../mt5agent/modules/plugins/host-v2/context.js';
import { validateSchemas } from '../../../../mt5agent/modules/shared/schema-service.js';
import { start, status } from '../packages/ultra/src/runtime.js';
import { fixture, until } from '../packages/ultra/tests/fixture.js';

test('the real host lifecycle preserves the completed main input and owner binding', async t => {
  const { createCapabilities } = await import('../packages/ultra/index.js');
  const f = fixture(); t.after(() => f.close());
  const task = await start(f.host, { objective: 'Continue the unmet goal from an actual completed main lifecycle callback.' });
  await until(() => f.store.runs.get(task.cycle.id)?.value.status === 'completed');
  const manifest = JSON.parse(await readFile(new URL('../packages/ultra/capabilities.json', import.meta.url), 'utf8'));
  const entry = { id: 'sesame/ultra', capabilityManifest: manifest };
  const declaration = manifest.hooks.find(hook => hook.event === 'lifecycle.afterAgentTurn');
  assert.equal(declaration.operations.handle, 'ultra_after_turn');
  const descriptor = manifest.capabilities.find(capability => capability.id === 'ultra_after_turn');
  assert.equal(descriptor.execution, 'immediate'); assert.deepEqual(descriptor.consumers, ['host']);
  const received = [];
  const registry = Object.create(PluginRegistry.prototype);
  registry.store = { get: () => ({ id: 'conv_main', scope: 'main', host_run_id: null }), event: () => {} };
  registry.runtime = {
    options: {}, workspaces: { current: () => null },
    authority: { bind: context => context },
    capabilities: {
      resolve: () => ({ descriptor }),
      validate: async (schema, value) => {
        assert.deepEqual(Object.keys(value).sort(), ['conversationId', 'responseId', 'scope', 'status']);
        await validateSchemas([{ schema, value }]);
      },
      execute: async (_target, input, context, execution) => {
        received.push({ input, context });
        const binding = createCapabilities(f.hostFor({ kind: context.kind, sessionId: context.sessionId })).find(item => item.name === 'ultra_after_turn');
        return binding.execute(input, execution.signal);
      },
    },
  };
  registry.state = () => 'mounted'; registry.entry = () => entry; registry.track = () => {};
  registry.afterTurnCalls = new Map();
  registry.services = new Map([[entry.id, registry.lifecycleService({ ...entry, capabilityManifest: { hooks: [declaration] } })]]);
  await registry.afterTurn({ conversationId: 'conv_main', responseId: 'host-response', status: 'completed' });
  assert.equal(received.length, 1);
  assert.equal(received[0].context.kind, 'main'); assert.equal(received[0].context.sessionId, 'conv_main');
  const next = await status(f.host, {}); assert.notEqual(next.cycle.id, task.cycle.id);
});

test('actual host contexts preserve after-turn Runs after return and wait for queued main notifications', { timeout: 30000 }, async t => {
  const base = fileURLToPath(new URL('../../../../outputs/slash-ultra-20261024/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'ultra-lifecycle-'));
  const store = new Store(join(directory, 'state'));
  const runtime = await new Runtime(store, { piDir: join(directory, 'empty-models'), officialPluginsDirectory: join(directory, 'empty-official') }).init();
  t.after(async () => {
    await runtime.close(); store.close();
    assert.ok(resolve(directory).startsWith(resolve(base) + sep));
    await rm(directory, { recursive: true, force: true });
  });
  const source = fileURLToPath(new URL('../packages/ultra/', import.meta.url));
  const target = join(runtime.workspaces.root('conv_main'), 'ultra');
  await cp(source, target, { recursive: true });
  const main = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
  await main.plugins.install({ path: target });
  await main.plugins.setEnabled('sesame/ultra', true, { scope: 'session' });
  let hold, entered;
  const plannerSignals = [];
  // Only model inference is deterministic. Run admission, native bindings,
  // authority, public ports, state, lifecycle and signal propagation are real.
  runtime.capabilities.builtins.get('host.agent.run').execute = async (_input, execution) => {
    plannerSignals.push(execution.signal);
    if (hold) {
      entered.resolve();
      let abort;
      try {
        await Promise.race([hold.promise, new Promise((_, reject) => {
          abort = () => reject(execution.signal.reason);
          execution.signal.addEventListener('abort', abort, { once: true });
          if (execution.signal.aborted) abort();
        })]);
      } finally { execution.signal.removeEventListener('abort', abort); }
    }
    return { text: 'Use a new validation method and dispatch the next useful branch.', turns: 1, toolCalls: [], sessionId: 'fixture-model', model: { provider: 'fixture', id: 'planner', configurationDigest: 'fixture:planner' } };
  };
  const accepted = await main.capabilities.invoke('sesame/ultra#ultra_start', { objective: 'Continue an unfinished goal using the real lifecycle.' });
  const first = (await runtime.runs.wait(accepted.value.cycle.id, { timeoutMs: 5000 })).run;
  assert.equal(first.status, 'completed', JSON.stringify(runtime.runs.list().map(run => ({ id: run.id, capability: run.capabilityId, status: run.status, error: run.error }))));
  const before = runtime.runs.list().length;
  for (const [status, activeResponseId] of [['queued', 'completion-queued'], ['working', 'completion-streaming']]) {
    store.update('conversation', 'conv_main', { status, active_response_message_id: activeResponseId });
    await runtime.plugins.afterTurn({ conversationId: 'conv_main', responseId: `old-${status}`, status: 'completed' });
    assert.equal(runtime.runs.list().length, before);
  }
  store.update('conversation', 'conv_main', { status: 'idle', active_response_message_id: null });
  hold = Promise.withResolvers(); entered = Promise.withResolvers();
  await runtime.plugins.afterTurn({ conversationId: 'conv_main', responseId: 'actual-final', status: 'completed' });
  await entered.promise;
  const current = await main.capabilities.invoke('sesame/ultra#ultra_status', {});
  assert.notEqual(current.value.cycle.id, accepted.value.cycle.id);
  assert.equal(plannerSignals.at(-1).aborted, false);
  assert.equal(runtime.runs.read(current.value.cycle.id).status, 'running');
  hold.resolve();
  assert.equal((await runtime.runs.wait(current.value.cycle.id, { timeoutMs: 5000 })).run.status, 'completed');
  assert.equal(runtime.runs.list().some(run => run.status === 'interrupted'), false);
});
