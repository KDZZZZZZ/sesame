import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, hostForStore } from './mt5-host.js';
import { MT5 } from '../../optional-api-v1/packages/mt5/backend/service.js';
import { projectFiles } from '../../optional-api-v1/packages/mt5/backend/contracts.js';
import { visualTemplate } from '../../optional-api-v1/packages/mt5/backend/visual/index.js';

test('checkout returns real host paths and save checks writable SDK content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mt5-host-checkout-'));
  const store = new Store(join(root, 'private')), host = hostForStore(store), mt5 = new MT5(host);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  mt5.template = projectFiles(visualTemplate()); mt5.sdk = { 'Fixture.mqh': '// fixed package SDK\n' }; mt5.tester = { list: () => [] };
  const workspace = join(root, 'workspace with spaces'); await mkdir(workspace);
  const box = hostForStore(store, { workspaceRoot: workspace });
  const project = mt5.create('Native workspace'), checkout = await mt5.checkout(box, project.id, undefined, 'conv_main');
  assert.ok(checkout.path.startsWith(join(workspace, 'projects') + (process.platform === 'win32' ? '\\' : '/'))); assert.ok(checkout.sdk_path.startsWith(join(workspace, 'inputs') + (process.platform === 'win32' ? '\\' : '/'))); assert.equal(checkout.path.startsWith('/work/'), false);
  assert.equal((await readFile(join(checkout.path, 'Experts/Strategy.mq5'), 'utf8')), mt5.template.files['Experts/Strategy.mq5']);
  assert.equal((await mt5.save(box, checkout.id, undefined, 'conv_main')).revision, 1);
  await writeFile(join(checkout.sdk_path, 'Include/Product/Fixture.mqh'), '// user can write here\n');
  await assert.rejects(mt5.save(box, checkout.id, undefined, 'conv_main'), { code: 'sdk_changed' });
  assert.equal(store.get('mt5_project', project.id).revision, 1);
  await writeFile(join(checkout.sdk_path, 'Include/Product/Fixture.mqh'), mt5.sdk['Fixture.mqh']);
  await writeFile(join(checkout.path, 'README.md'), mt5.template.files['README.md'] + '\nNative workspace note.\n');
  assert.equal((await mt5.save(box, checkout.id, undefined, 'conv_main')).revision, 2);
  await assert.rejects(mt5.save(box, checkout.id, undefined, 'another_conversation'), /当前会话/);
});
