import '../../../../mt5agent/modules/plugins/sdk-loader.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { validateCapabilityManifest, validateCapabilityBindings } from '../../../../mt5agent/modules/plugins/capability-contract.js';
import { inspectPackage } from '../../../../mt5agent/modules/agent/plugin-system/package.js';

const root = new URL('../packages/ultra/', import.meta.url);
async function filesAt(base = root, prefix = '') {
  const files = {};
  for (const entry of await readdir(base, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await filesAt(new URL(`${entry.name}/`, base), `${path}/`));
    else files[path] = await readFile(new URL(entry.name, base));
  }
  return files;
}

test('official Ultra package passes the actual host package/schema/native binding contract', async () => {
  const files = await filesAt(), manifest = JSON.parse(files['capabilities.json']);
  const parsed = inspectPackage(files, { applicationVersion: '0.3.0-dev.1' });
  assert.equal(parsed.id, 'sesame/ultra');
  assert.equal(parsed.default_state, 'mounted');
  const checked = await validateCapabilityManifest(manifest, { pluginId: parsed.id, files });
  assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics));
  const { createCapabilities } = await import('../packages/ultra/index.js');
  const native = createCapabilities({});
  const bindings = validateCapabilityBindings(manifest, native.map(item => ({ id: item.name, binding: { type: 'native', name: item.name } })), { pluginId: parsed.id });
  assert.equal(bindings.valid, true, JSON.stringify(bindings.diagnostics));
  assert.equal(native.length, 11);
  assert.ok(parsed.capabilityManifest.hooks.some(item => item.event === 'lifecycle.beforeAgentTurn'));
  assert.ok(parsed.capabilityManifest.hooks.some(item => item.event === 'lifecycle.afterAgentTurn'));
});
