import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createService } from '../packages/financial-research/service.js';
import { closeRecords, records } from '../packages/financial-research/records.js';

const root = process.env.SESAME_HOST_ROOT;

test('installed Financial Research keeps configuration and frozen evidence across Runtime restart without source access', { skip: !root, timeout: 60000 }, async () => {
  const { Store } = await import(pathToFileURL(join(root, 'modules/agent/store.js')));
  const { Runtime } = await import(pathToFileURL(join(root, 'modules/agent/runtime.js')));
  const { createHostContextV2 } = await import(pathToFileURL(join(root, 'modules/plugins/host-v2/context.js')));
  const directory = await mkdtemp(join(tmpdir(), 'financial-host-restart-'));
  const variable = `SESAME_FINANCIAL_BOUNDARY_${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const pluginId = 'sesame/financial-research';
  let store, runtime, host;
  const open = async () => {
    store = new Store(join(directory, 'app'));
    runtime = new Runtime(store, { piDir: join(directory, 'pi'), officialPluginsDirectory: join(directory, 'empty') });
    await runtime.init();
  };
  const close = async () => {
    if (host) closeRecords(host);
    host = null;
    await runtime?.close(); runtime = null;
    store?.close(); store = null;
  };
  try {
    await open();
    const draft = join(runtime.workspaces.root('conv_main'), 'financial-draft');
    await cp(fileURLToPath(new URL('../packages/financial-research/', import.meta.url)), draft, { recursive: true });
    const checked = await runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(checked.passed, true, JSON.stringify(checked));
    const installed = await runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
    assert.equal(installed.runtime_status, 'ready');
    runtime.plugins.activate('conv_main', installed.id);
    host = createHostContextV2(runtime, runtime.plugins.entry(pluginId), 'conv_main');
    const configured = await host.capabilities.invoke(`${pluginId}#financial_research_configure`, { fmp_key_env: variable });
    assert.equal(configured.type, 'result');
    assert.equal(configured.value.configuration.fmp_key_env, variable);
    assert.equal(configured.value.credentials.fmp_api_key, false);
    let calls = 0;
    const service = createService(host, {
      env: { [variable]: 'fixture-boundary-secret' }, now: () => Date.now() - 60000,
      fetch: async () => {
        calls++;
        return new Response(JSON.stringify([{ title: 'Frozen evidence', publishedDate: '2026-10-01T12:00:00Z', amount: '1.0000000000000001', token: 'fixture-boundary-secret' }]));
      },
    });
    const original = await service.query({ kind: 'news', symbol: 'FIX' });
    const originalRecords = records(host).list('datasets');
    const identity = { storageRoot: host.context.storageRoot, pluginId: host.context.pluginId, pluginRevision: host.context.pluginRevision };
    const originalMetadata = await host.resources.read(original.ref, { part: 'metadata' });
    await close();
    await open();
    host = createHostContextV2(runtime, runtime.plugins.entry(pluginId), 'conv_main');
    assert.deepEqual({ storageRoot: host.context.storageRoot, pluginId: host.context.pluginId, pluginRevision: host.context.pluginRevision }, identity);
    const status = await host.capabilities.invoke(`${pluginId}#financial_research_status`, {});
    assert.equal(status.value.configuration.fmp_key_env, variable);
    assert.equal(status.value.credentials.fmp_api_key, false);
    const accepted = await host.capabilities.invoke(`${pluginId}#financial_research_query`, { kind: 'news', symbol: 'FIX', as_of: new Date().toISOString() });
    assert.equal(accepted.type, 'run');
    const completed = (await host.runs.wait(accepted.run, { until: 'settled', timeoutMs: 10000 })).run;
    assert.equal(completed.status, 'completed', JSON.stringify(completed.error));
    assert.equal(completed.output.status, 'saved_evidence');
    assert.equal(completed.output.dataset_id, original.dataset_id);
    assert.deepEqual(completed.output.ref, original.ref);
    assert.deepEqual(completed.output.raw_ref, original.raw_ref);
    assert.deepEqual(await host.resources.read(original.ref, { part: 'metadata' }), originalMetadata);
    const manifest = await host.resources.read(original.ref, { part: 'manifest' });
    assert.deepEqual(manifest.dependencies, [original.raw_ref]);
    const raw = await host.capabilities.invoke(`${pluginId}#financial_research_read`, { dataset_id: original.raw_dataset_id });
    assert.equal(raw.value.rows[0].raw.amount, '1.0000000000000001');
    assert.equal(raw.value.rows[0].raw.token, '[redacted]');
    assert.deepEqual(records(host).list('datasets'), originalRecords);
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify([completed, originalRecords, store.list('run_invocation')]), /fixture-boundary-secret/);
  } finally {
    await close();
    assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), 'financial-host-restart-'))));
    await rm(directory, { recursive: true, force: true });
  }
});
