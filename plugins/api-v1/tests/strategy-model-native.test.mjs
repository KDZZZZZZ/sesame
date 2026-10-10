import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Explicit opt-in: uses a configured paid provider once, with only fictional
// data. Auth is copied into a temporary private directory and removed afterward.
const root = process.env.SESAME_HOST_ROOT, configured = process.env.SESAME_MODEL_STORE_DIR;
test('configured provider completes a frozen isolated decision through the real host transport', { skip: !root || !configured, timeout: 150000 }, async t => {
  const load = path => import(pathToFileURL(join(root, path)));
  const { ModelRuntime } = await load('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const { ModelTransport } = await load('modules/agent/model-transport.js');
  const { createInferencePort } = await load('modules/plugins/inference.js');
  const directory = mkdtempSync(join(tmpdir(), 'sesame-native-decision-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of ['auth.json', 'models.json', 'models-store.json']) if (existsSync(join(configured, 'pi', file))) {
    copyFileSync(join(configured, 'pi', file), join(directory, file)); chmodSync(join(directory, file), 0o600);
  }
  const db = new DatabaseSync(join(configured, 'app.sqlite'), { readOnly: true });
  const row = db.prepare("SELECT body FROM entities WHERE kind='settings' AND id='providers'").get(); db.close();
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, 'auth.json'), modelsPath: join(directory, 'models.json'), modelsStorePath: join(directory, 'models-store.json') });
  for (const [id, config] of Object.entries(row ? JSON.parse(row.body).entries ?? {} : {})) modelRuntime.registerProvider(id, config);
  await modelRuntime.refresh({ allowNetwork: false });
  const transport = new ModelTransport(); t.after(() => transport.close());
  const runtime = { modelRuntime, sessionModels: transport.wrap(modelRuntime), plugins: { track() {} } };
  const inference = createInferencePort(runtime, { id: 'sesame/strategy-authoring' }, {});
  const selected = inference.models().find(model => model.provider === (process.env.SESAME_TEST_PROVIDER ?? 'muzeai') && model.id === (process.env.SESAME_TEST_MODEL ?? 'grok-4.7'));
  assert.ok(selected, 'Selected provider must already be configured');
  const response = await inference.complete({ requestId: `isolated-fixture-${Date.now()}`, model: selected,
    systemPrompt: 'You are a deterministic test component. Use only the fictional input. Return exactly one JSON object with keys direction and evidenceId. If observations are insufficient, direction must be flat. Do not use external knowledge or include Markdown.',
    input: { evidenceId: 'fictional-fixture', observations: [], purpose: 'Transport contract test only; no market decision or order' },
    maxTokens: 1024, temperature: 0, timeoutMs: 120000 });
  const output = JSON.parse(response.text);
  assert.deepEqual(output, { direction: 'flat', evidenceId: 'fictional-fixture' });
  assert.deepEqual(response.model, selected);
  assert.equal(response.modelRevisionVerified, false);
  assert.equal(runtime.inferenceCalls, 0);
});
