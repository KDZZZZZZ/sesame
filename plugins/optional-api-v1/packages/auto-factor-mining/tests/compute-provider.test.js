import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createArtifacts, attemptDirectory, fileReceipt, ownedPath } from '../artifacts.js';
import { canonical } from '../contracts.js';
import { storageFixture } from './storage-fixture.js';

test('260 real provider files publish within dependency bounds and compute after durable rehydration', { skip: !process.env.PYTHON, timeout: 180000 }, async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host });
  const first = { jobId: 'large-provider', epoch: 1, attemptId: 'prepare' };
  const resumed = { ...first, attemptId: 'resumed-compute' };
  const limits = { maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, timeoutMs: 60000, maxDiagnosticWork: 64 };
  const budget = { maxCandidates: 1, batchSize: 1, maxWorkers: 1, maxSeconds: 60, maxInputBytes: limits.maxInputBytes, maxOutputBytes: limits.maxOutputBytes, seed: 7 };
  const hour = index => `2026-01-01T${String(index).padStart(2, '0')}:00:00Z`;
  const layout = { universe: ['S0', 'S1', 'S2', 'S3'], frequency: '60min', timezone: 'UTC', availableAt: 'bar_close', development: [hour(0), hour(5)], holdout: [hour(6), hour(7)], target: { kind: 'forward_return', field: 'close', horizonBars: 1 } };
  const rows = layout.universe.flatMap((symbol, symbolIndex) => Array.from({ length: 9 }, (_, barIndex) => ({
    symbol, time: hour(barIndex), availableAt: hour(barIndex), fields: { close: 2 ** barIndex, ...Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`feature_${index}`, 100 * symbolIndex + index])) },
  })));
  const source = f.artifact({ value: rows, content: { format: 'json-rows', path: 'payload.json', rowCount: rows.length } });
  const dir = attemptDirectory(f.root, first); await mkdir(dir, { recursive: true });
  const rowsPath = join(dir, 'rows.json'); await writeFile(rowsPath, canonical(rows));
  const execute = async (command, input, ctx) => {
    const root = attemptDirectory(f.root, ctx); await mkdir(root, { recursive: true });
    const requestPath = join(root, 'request.json'), responsePath = join(root, 'result.json');
    await writeFile(requestPath, canonical({ schema: 'factor-worker/1', command, limits, input: { ...input, outputDir: join(root, 'output') } }));
    const result = spawnSync(process.env.PYTHON ?? 'python', ['-I', '-B', fileURLToPath(new URL('../python/worker.py', import.meta.url)), requestPath, responsePath], { encoding: 'utf8', timeout: 90000 });
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`);
    const receipt = JSON.parse(await readFile(responsePath, 'utf8'));
    assert.equal(receipt.status, 'ok', JSON.stringify(receipt));
    return receipt.output;
  };
  const prepared = await execute('prepare', { sourceRef: source, rows: [await fileReceipt(rowsPath)], layout, budget }, first);
  const provider = await artifacts.importTree(prepared.provider, first, 'factor-provider/1', 'provider');
  const partitions = {};
  for (const name of ['development', 'holdout']) {
    const value = JSON.parse(await readFile(prepared[name].path, 'utf8'));
    partitions[name] = { manifest: await artifacts.importTree(prepared[name], first, 'factor-source-rows/1', name), digest: prepared[name].digest, rows: value.rows, bytes: prepared[name].bytes };
  }
  const usageLedgerRef = await artifacts.importTree(prepared.usageLedger, first, 'factor-usage/1', 'usage');
  const snapshot = await artifacts.publishJSON({ ...prepared.snapshot, source, provider, usageLedgerRef, ...partitions }, { schema: 'factor-snapshot/1', operationId: 'large-snapshot', dependencies: [source, provider, usageLedgerRef, ...Object.values(partitions).map(item => item.manifest)] }, first);
  const publications = f.calls.filter(call => call.kind === 'publish');
  assert.equal(publications.filter(call => call.manifest.content.schema === 'factor-provider-file/1').length, 257, 'The four identical close files share one immutable payload');
  assert.equal(publications.filter(call => call.manifest.content.schema === 'factor-provider-features/1').length, 3);
  assert.ok(publications.every(call => call.manifest.dependencies.length <= 130));
  const local = await artifacts.materialize(snapshot, resumed);
  await rename(ownedPath(f.root, dir), ownedPath(f.root, `${dir}-expired`));
  const candidate = { id: 'large', formula: { dsl: 'qlib-expr/1', tree: { call: 'Add', args: [{ field: 'feature_63' }, { field: 'close' }] } }, hypothesis: 'Synthetic grouped-provider golden', origin: { method: 'seed', parents: [], parameters: {} } };
  const result = await execute('compute', { snapshot: local, candidates: [candidate], partition: 'development' }, resumed);
  assert.equal(result.values.engine.name, 'qlib'); assert.equal(result.values.engine.version, '0.9.7');
  assert.equal(result.values.candidates[0].status, 'ok');
  const matrix = JSON.parse(await readFile(result.matrix.path, 'utf8'));
  for (const shard of matrix.shards) {
    const value = JSON.parse(await readFile(shard.path, 'utf8'));
    assert.deepEqual(value.columns.large, value.keys.map(key => Number(key.symbol.slice(1)) * 100 + 63 + 2 ** key.barIndex));
  }
});
