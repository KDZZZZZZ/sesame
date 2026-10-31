import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSchemas } from '../../../../mt5agent/modules/agent/plugin-system/mcp-client.js';
import { createCapabilities, fixedRows } from '../packages/vnpy/index.js';
import { environment } from '../packages/vnpy/environment.js';
import { processHost } from './backend-process-fixture.mjs';

const row = { datetime: '2024-01-01T00:00:00Z', open: '9007199254740993.00001', high: '9007199254740994.00001', low: '9007199254740992.00001', close: '9007199254740993.00002', volume: '0' };
const ref = { id: 'fixed', revision: 'r1', kind: 'data', schemaVersion: '1.0.0', digest: `sha256:${'a'.repeat(64)}` };
function fixture(rows = [row, { ...row, datetime: '2024-01-02T00:00:00Z' }], origin = 'demo') {
  const bytes = Buffer.from(JSON.stringify(rows)), manifest = { content: { format: 'json-rows', path: 'rows.json', rowCount: rows.length, provenance: { kind: origin } }, blobs: [{ path: 'rows.json', size: bytes.length }] };
  return { resources: { read: async (received, options) => {
    assert.deepEqual(received, ref);
    if (options.part === 'manifest') return structuredClone(manifest);
    assert.equal(options.part, 'content'); assert.equal(options.entry, 'rows.json'); assert.equal(options.encoding, 'base64');
    const offset = options.offset ?? 0, end = Math.min(bytes.length, offset + options.length);
    return { content: bytes.subarray(offset, end).toString('base64'), total: bytes.length, length: end - offset, ...(end < bytes.length ? { nextOffset: end } : {}) };
  } } };
}

test('vn.py declares three real tools and explicit decimal/matching inputs', async () => {
  const definitions = createCapabilities({});
  const declaration = JSON.parse(await readFile(new URL('../packages/vnpy/capabilities.json', import.meta.url)));
  assert.equal(declaration.apiVersion, '2');
  assert.deepEqual(definitions.map(item => item.name).sort(), declaration.capabilities.map(item => item.id).sort());
  assert.deepEqual(declaration.capabilities.filter(item => item.consumers.includes('agent')).map(item => item.id).sort(), ['vnpy_backtest', 'vnpy_environment', 'vnpy_operation', 'vnpy_result']);
  const schema = declaration.capabilities.find(item => item.id === 'vnpy_backtest').inputSchema;
  const args = { operation_id: 'once', title: 'Fictional', data: ref, strategy_path: 'strategy.py', class_name: 'TestStrategy', config: { vt_symbol: 'DEMO.LOCAL', interval: 'd', rate: '0', slippage: '0', size: '1', pricetick: '1', capital: '10000' } };
  await validateSchemas([{ schema, value: args }]);
  await assert.rejects(validateSchemas([{ schema, value: { ...args, config: { ...args.config, capital: 10000 } } }]));
  await assert.rejects(validateSchemas([{ schema, value: { ...args, config: { ...args.config, interval: 'tick' } } }]));
});

test('fixed inputs retain exact strings, demo identity, missing values and time authority', async () => {
  const fixed = await fixedRows(fixture(), ref); assert.equal(fixed.rows[0].open, row.open); assert.equal(fixed.rows[0].volume, '0'); assert.equal(fixed.origin, 'demo');
  await assert.rejects(fixedRows(fixture([{ ...row, volume: null }, row]), ref), /missing fields/);
  await assert.rejects(fixedRows(fixture([row, row], 'claimed_safe'), ref), /provenance/);
  const wall = { ...row, datetime: { basis: 'wall', authority: 'broker-clock', value: '2024-01-01T12:00:00' } };
  await assert.rejects(fixedRows(fixture([wall, wall]), ref), /authority/);
  assert.equal((await fixedRows(fixture([wall, wall]), ref, {}, 'broker-clock')).rows[0].datetime, '2024-01-01T12:00:00');
  await assert.rejects(fixedRows(fixture([{ ...row, datetime: '2024-01-01T12:00:00' }, row]), ref), /wall_time_authority/);
});

test('explicit column mapping and SourceTime UTC are applied without changing original data', async () => {
  const raw = { ...row, moment: { basis: 'utc', unixMs: 1704067200000 }, closing: row.close }; delete raw.datetime; delete raw.close;
  const fixed = await fixedRows(fixture([raw, raw]), ref, { datetime: 'moment', close: 'closing' });
  assert.equal(fixed.rows[0].datetime, '2024-01-01T00:00:00.000Z'); assert.equal(fixed.rows[0].close, row.close); assert.equal(raw.moment.basis, 'utc');
});

test('environment inspection with no discovered Python never downloads or fabricates readiness', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'vnpy-no-environment-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const host = processHost({ storageRoot: directory, pythonPath: null }, () => assert.fail('no process expected without an interpreter'));
  assert.equal((await environment(host, { action: 'inspect' })).ready, false);
  await assert.rejects(environment(host, { action: 'prepare' }), { code: 'ENVIRONMENT_UNAVAILABLE' });
  assert.deepEqual(await readdir(directory), []);
});

test('changed configured inventories require explicit reconfiguration and never retain unobserved wheel hashes', async t => {
  const { writeFile } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'vnpy-inventory-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let packages = { vnpy: '4.5.0', 'vnpy-ctastrategy': '1.4.1' };
  const host = processHost({ storageRoot: directory, pythonPath: '/fixture/python' }, async ({ argv }) => {
    assert.deepEqual(argv.slice(1, 4), ['-I', '-B', '-c']);
    await writeFile(argv.at(-1), JSON.stringify({ python: '/fixture/python', platform: process.platform, arch: process.arch, bits: 64, version: [3, 13, 12], engineImport: 'BacktestingEngine', packages })); return { exitCode: 0 };
  });
  await environment(host, { action: 'prepare' });
  packages = { ...packages, additional: '1.0.0' };
  await assert.rejects(environment(host, { action: 'inspect' }), { code: 'ENVIRONMENT_CHANGED' });
  const selected = await environment(host, { action: 'prepare', python_path: '/fixture/python' });
  assert.equal(selected.environment.packages.additional, '1.0.0'); assert.deepEqual(selected.environment.downloads, []);
});
