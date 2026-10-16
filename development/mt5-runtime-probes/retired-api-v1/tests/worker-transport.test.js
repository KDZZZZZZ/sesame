import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorker} from '@sesame/plugin-sdk/transport/worker-client';

test('shared VM transport fails closed on cancellation, malformed output and missing completion', async () => {
  const options = { label: 'Lima', timeoutMs: 3000 };
  await assert.rejects(runWorker('must-not-launch', [], {}, { ...options, signal: AbortSignal.abort() }), /canceled/);
  await assert.rejects(runWorker(process.execPath, ['-e', 'console.log("invalid json")'], {}, options), /NDJSON/);
  await assert.rejects(runWorker(process.execPath, ['-e', 'process.exit(0)'], {}, options), /退出码/);
  const child = 'process.stdin.on("data", b => { if(b.toString().includes("cancel")) process.exit(0); });';
  await assert.rejects(runWorker(process.execPath, ['-e', child], {}, { ...options, timeoutMs: 100 }), /timeout/);
  const ok = 'console.log(JSON.stringify({type:"result",value:{exitCode:0,files:{}}}))';
  assert.deepEqual(await runWorker(process.execPath, ['-e', ok], {}, options), { exitCode: 0, files: {} });
});
