import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { compileNative } from '../../optional-api-v1/packages/mt5/backend/native.js';
import { digest } from '../../optional-api-v1/packages/mt5/backend/support.js';

test('compiler worker adapter retains verified EX5 bytes and full UTF16 diagnostics', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sesame-compiler-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'Experts'));
  const artifact = Buffer.from('controlled EX5 adapter result'), runId = `run_${randomUUID()}`;
  const diagnostics = '中文\r\nResult: 0 errors, 0 warnings\r\n', manifest = digest('frozen manifest');
  const environment = { runtime: { platform: process.platform }, executeWorker: async (entry, payload, options) => {
    assert.equal(entry, 'backend/compiler-worker.js'); assert.equal(payload.operation, 'compile');
    assert.equal(payload.directory, directory); assert.equal(payload.manifestDigest, manifest); assert.equal(options.runId, runId);
    return { success: true, diagnostics, ex5: artifact.toString('base64'), ex5_sha256: digest(artifact) };
  } };
  const result = await compileNative({ editor: 'unused-host-editor' }, directory, undefined, manifest, runId, environment);
  assert.equal(result.ex5_sha256, digest(artifact));
  assert.deepEqual(await readFile(join(directory, 'Experts/Strategy.ex5')), artifact);
  assert.equal((await readFile(join(directory, 'Experts/Strategy.log'))).toString('utf16le'), '\uFEFF' + diagnostics);
  environment.executeWorker = async () => ({ success: true, diagnostics, ex5: artifact.toString('base64'), ex5_sha256: digest('different result') });
  await assert.rejects(compileNative({ editor: 'unused' }, directory, undefined, manifest, runId, environment), /EX5.*摘要/);
  assert.deepEqual(await readFile(join(directory, 'Experts/Strategy.ex5')), artifact);
});
