import {createProtocolFiles} from '@sesame/plugin-sdk/surface';
import {dirname} from 'node:path';
// Opt-in probes against the unmodified production SDK, using an isolated test plugin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const scratch = process.env.SESAME_FACTOR_TEST_ROOT;
const pluginId = 'test/factor-native-lifecycle';
const json = value => JSON.stringify(value, null, 2);
const boundedObject = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const capability = name => ({ id: name, kind: 'function', consumers: ['agent'], description: 'Synthetic native lifecycle probe',
  inputSchema: boundedObject({ value: { type: 'integer' } }), outputSchema: boundedObject({ value: { type: 'integer' }, attempt: { type: 'integer' }, response: { type: ['string', 'null'] } }),
  execution: 'run', resumable: true, effects: ['plugin.state.write'], binding: { type: 'native', name },
  usage: { purpose: 'Verify native cancellation and checkpoint recovery', inputs: 'An invented integer', outputs: 'Retained value and attempt', prerequisites: [], limitations: ['Isolated test fixture only'] } });

test('real SDK fences cancelled writes and distinguishes safe recovery from stopped processes', { skip: !hostRoot || !scratch, timeout: 90000 }, async t => {
  await mkdir(scratch, { recursive: true });
  const ownedRoot = await realpath(scratch);
  assert.equal(resolve(ownedRoot).slice(0, 2).toUpperCase(), 'E:', 'Use the explicit isolated E: fixture root');
  const root = await mkdtemp(join(ownedRoot, 'native-sdk-'));
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const [{ Store }, { Runtime }, { createHostContextV2 }] = await Promise.all([load('modules/agent/store.js'), load('modules/agent/runtime.js'), load('modules/plugins/host-v2/context.js')]);
  const store = new Store(join(root, 'state'));
  const runtime = new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: join(root, 'empty') });
  const evidence = { synthetic: true, hostModified: false, stages: [] };
  try {
    await runtime.init();
    const draft = join(runtime.workspaces.root('conv_main'), 'native-lifecycle');
    await mkdir(draft, { recursive: true });
    const metadata = { id: pluginId, version: '1.0.0', apiVersion: '2', title: 'Native lifecycle probe', description: 'Isolated synthetic lifecycle fixture', default_state: 'mounted', entry: 'index.js', capability_manifest: 'capabilities.json', prompts: [], skills: [], permissions: { scopes: ['process.execute', 'capabilities.compose'], calls: ['host.process.exec'] } };
    const protocolFiles = createProtocolFiles(metadata,{ schemaVersion: 1, apiVersion: '2', configSchema: { type: 'object' },
      capabilities: ['fixture_checkpoint', 'fixture_cancel_commit', 'fixture_process'].map(name => ({ ...capability(name), ...(name === 'fixture_process' ? { effects: ['process', 'filesystem'] } : {}) })), sources: [], views: [], services: [], knowledge: [], hooks: [], artifactSchemas: [],
      stateCollections: [{ name: 'evidence', schemaVersion: '1.0.0', mode: 'document', access: 'private', schema: boundedObject({ value: { type: 'integer' } }) }] });
    for (const [file,bytes] of Object.entries(protocolFiles)) {
      const target=join(draft,file); await mkdir(dirname(target),{recursive:true}); await writeFile(target,bytes);
    }
    await writeFile(join(draft, 'index.js'), `
export function createCapabilities(host) {
  return [
    { name: 'fixture_checkpoint', async execute(input, signal, execution) {
      signal.throwIfAborted();
      if (!execution.checkpointState) {
        await host.state.commit([{ op: 'put', key: { collection: 'evidence', key: 'retained' }, expectedVersion: 0, value: input }], { operationId: 'retained-once' });
        await execution.checkpoint({ value: input.value });
        execution.interrupt({ reason: 'Synthetic safe checkpoint' });
      }
      return { value: execution.checkpointState.value, attempt: execution.attempt, response: execution.resume?.response ?? null };
    } },
    { name: 'fixture_cancel_commit', async execute(input, signal, execution) {
      signal.throwIfAborted();
      const pending = host.state.commit([{ op: 'put', key: { collection: 'evidence', key: 'late' }, expectedVersion: 0, value: input }], { operationId: 'cancelled-write' });
      execution.progress({ phase: 'validating-state' });
      await pending;
      return { value: input.value, attempt: execution.attempt, response: null };
    } },
    { name: 'fixture_process', async execute(input, signal, execution) {
      const accepted = await host.capabilities.invoke('host.process.exec', {
        argv: [process.execPath, '-e', "process.stdout.write('fixture-entered');setTimeout(() => {}, 30000)"],
        cwd: host.context.storageRoot, timeoutMs: 45000,
      });
      await host.runs.wait(accepted.run, { until: 'settled', timeoutMs: 45000 });
      signal.throwIfAborted();
      return { value: input.value, attempt: execution.attempt, response: null };
    } },
  ];
}
`);
    const checked = await runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(checked.passed, true, json(checked));
    const installed = await runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
    assert.equal(installed.runtime_status, 'ready', json(installed));
    runtime.plugins.activate('conv_main', pluginId);
    const main = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
    const own = createHostContextV2(runtime, runtime.plugins.entry(pluginId), 'conv_main');
    let call = 0;
    const invoke = async name => {
      const tool = runtime.plugins.definitions({ conversationId: 'conv_main' }).find(tool => tool.name === name);
      assert.ok(tool);
      const returned = await tool.execute(`native-fixture-${++call}`, { value: 7 });
      assert.notEqual(returned.isError, true, json(returned));
      const accepted = returned.details ?? JSON.parse(returned.content[0].text);
      assert.equal(accepted.type, 'run'); return accepted.run;
    };
    const wait = async ref => {
      let result;
      do { result = await main.runs.wait(ref, { until: 'settled', timeoutMs: 10000 }); } while (result.reason === 'timeout');
      return result.run;
    };
    const events = async ref => {
      const entries = []; let cursor;
      do {
        const result = await main.runs.read(ref, { include: ['events'], limit: 2, ...(cursor ? { cursor } : {}) });
        entries.push(...result.history.items); cursor = result.history.nextCursor;
      } while (cursor);
      return entries;
    };

    await t.test('cancel between commit entry and post-validation transaction blocks the write', async () => {
      let cancelled = false, observation;
      const listener = event => {
        if (event.type !== 'run.updated' || event.data.capabilityId !== `${pluginId}#fixture_cancel_commit` || event.data.progress?.phase !== 'validating-state' || cancelled) return;
        cancelled = true;
        observation = main.runs.cancel({ id: event.data.id }, { reason: 'Synthetic UI cancellation during asynchronous schema validation' });
      };
      store.on('event', listener);
      let ref, stopped;
      try { ref = await invoke('fixture_cancel_commit'); stopped = await wait(ref); }
      finally { store.off('event', listener); }
      assert.equal(cancelled, true);
      assert.equal(observation.run.status, 'cancelling');
      assert.equal(stopped.status, 'cancelled');
      await assert.rejects(async () => own.state.read({ collection: 'evidence', key: 'late' }), { code: 'NOT_FOUND' });
      assert.equal((await own.state.query({ collection: 'evidence', limit: 10 })).items.length, 0);
      evidence.cancel = { run: stopped, events: await events(ref), committedRecords: 0 };
      evidence.stages.push('cancelled commit remained absent');
    });

    await t.test('resume keeps the same Run, restores checkpoint and increments attempt', async () => {
      const ref = await invoke('fixture_checkpoint'), paused = await wait(ref);
      assert.equal(paused.status, 'interrupted'); assert.equal(paused.attempt, 1);
      const before = await own.state.read({ collection: 'evidence', key: 'retained' });
      assert.equal(before.version, 1);
      const interruptIds = paused.interrupts.filter(item => !item.resolvedAt).map(item => item.id);
      const resumed = await main.runs.resume(ref, { interruptIds, response: 'Synthetic dependency restored', operationId: 'fixture-safe-resume' });
      assert.equal(resumed.run.id, ref.id);
      const completed = await wait(ref);
      assert.equal(completed.status, 'completed'); assert.equal(completed.attempt, 2);
      assert.deepEqual(completed.output, { value: 7, attempt: 2, response: 'Synthetic dependency restored' });
      assert.deepEqual(await own.state.read({ collection: 'evidence', key: 'retained' }), before, 'Completed work is not committed again');
      const history = await events(ref);
      assert.equal(history.filter(item => item.type === 'status' && item.data.status === 'running').length, 2);
      assert.ok(history.some(item => item.type === 'status' && item.data.status === 'interrupted'));
      assert.ok(history.some(item => item.type === 'resumed' && item.data.attempt === 2));
      assert.ok(history.every((item, index) => item.sequence === index + 1 && Number.isFinite(Date.parse(item.at))));
      assert.equal(completed.executionSessionId, null, 'A primitive Run creates no workflow task');
      evidence.resume = { run: completed, events: history, retainedVersion: before.version };
      evidence.stages.push('same Run restored the checkpoint without repeating state effects');
    });
    await t.test('an interrupted started process prevents automatic native replay', async () => {
      let childId;
      const listener = event => {
        if (childId || event.type !== 'run.updated' || event.data.capabilityId !== 'host.process.exec') return;
        const history = store.get('run_history', `${event.data.id}:${event.data.historySequence}`);
        if (history?.type !== 'output' || !history.data.text.includes('fixture-entered')) return;
        const parent = store.get('run', event.data.parentRunId);
        if (parent?.capabilityId !== `${pluginId}#fixture_process`) return;
        childId = event.data.id;
        main.runs.interrupt({ id: parent.id }, { reason: 'Synthetic active process interruption' });
      };
      store.on('event', listener);
      let ref, paused;
      try { ref = await invoke('fixture_process'); paused = await wait(ref); }
      finally { store.off('event', listener); }
      assert.ok(childId, 'The actual process emitted output before interruption');
      assert.equal(paused.status, 'interrupted');
      const child = (await main.runs.read(childId)).run;
      assert.equal(child.status, 'interrupted');
      await assert.rejects(main.runs.resume(ref, { interruptIds: paused.interrupts.filter(item => !item.resolvedAt).map(item => item.id), operationId: 'fixture-reject-process-replay' }), { code: 'RESUME_UNSUPPORTED' });
      assert.equal((await main.runs.read(ref)).run.attempt, 1);
      assert.equal((await main.runs.read(childId)).run.attempt, 1);
      evidence.processInterruption = { parent: (await main.runs.read(ref)).run, child, events: await events(ref), resumeCode: 'RESUME_UNSUPPORTED' };
      await main.runs.cancel(ref, { reason: 'Expected non-resumable fixture was verified' });
      await wait(ref);
      evidence.stages.push('started child process was observed, never replayed');
    });
    evidence.completed = true;
  } catch (error) {
    evidence.error = { message: error.message, stack: error.stack };
    throw error;
  } finally {
    await writeFile(join(ownedRoot, 'native-sdk-lifecycle-evidence.json'), json(evidence));
    await runtime.close(); store.close();
    const child = relative(ownedRoot, await realpath(root));
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && child.startsWith('native-sdk-'));
    await rm(root, { recursive: true, force: true });
  }
});
