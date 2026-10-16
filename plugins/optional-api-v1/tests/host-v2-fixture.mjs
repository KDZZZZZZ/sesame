// Real host data/resource/capability ports with explicit in-process plugin modules.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const hostRoot = process.env.SESAME_HOST_ROOT;

export async function nativeHost(t) {
  const { Store } = await import(pathToFileURL(join(hostRoot, 'modules/agent/store.js')));
  const { Runtime } = await import(pathToFileURL(join(hostRoot, 'modules/agent/runtime.js')));
  const { createHostContextV2 } = await import(pathToFileURL(join(hostRoot, 'modules/plugins/host-v2/context.js')));
  const directory = mkdtempSync(join(tmpdir(), 'sesame-memory-host-')), store = new Store(directory), runtime = new Runtime(store);
  runtime.workspaces.init(); runtime.resources.recover(); runtime.createConversation('main', 'Main', null, 'conv_main'); await runtime.reportLibrary.init();
  const owned = [], disposers = [];
  runtime.plugins = { entries: new Map(), state: () => 'mounted', activeTools: () => [], hook: async () => [], own: (_id, dispose) => owned.push(dispose),
    entry(id) { return this.entries.get(id); }, summary: () => ({ loaded: true, state: 'mounted' }) };
  const attach = (name, factory, select = () => true) => {
    const root = new URL(`../packages/${name}/`, import.meta.url), packageInfo = JSON.parse(readFileSync(new URL('plugin.json', root)));
    const manifest = JSON.parse(readFileSync(new URL('capabilities.json', root)));
    manifest.capabilities = manifest.capabilities.filter(select); manifest.hooks = [];
    const entry = { ...packageInfo, digest: `sha256:${'a'.repeat(64)}`, capabilityManifest: manifest, module: Promise.resolve({ createCapabilities: factory }), runtime_status: 'ready' };
    runtime.plugins.entries.set(entry.id, entry); return createHostContextV2(runtime, entry, 'conv_main');
  };
  t.after(async () => {
    for (const dispose of disposers) await dispose();
    for (const dispose of owned) await dispose(); await runtime.capabilities.close(); await runtime.runs.close();
    await runtime.reportLibrary.flush(); runtime.resources.close(); store.close();
    assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), 'sesame-memory-host-')))); rmSync(directory, { recursive: true, force: true });
  });
  const actor = { pluginId: 'host', sessionId: 'conv_main', kind: 'main', consumer: 'agent' };
  return { runtime, store, attach, onDispose: fn => disposers.push(fn), call: async (id, input) => (await runtime.capabilities.invoke(id, input, {}, actor)).value };
}
