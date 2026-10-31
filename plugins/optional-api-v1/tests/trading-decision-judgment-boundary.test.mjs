import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createCapabilities } from '../packages/trading-decision/index.js';
import { closeRecords } from '../packages/trading-decision/records.js';

const root = new URL('../packages/trading-decision/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('capabilities.json', root)));
const plugin = JSON.parse(readFileSync(new URL('plugin.json', root)));

test('trading decision declares only its workflow and trading memory boundary', () => {
  assert.deepEqual(manifest.capabilities.filter(capability => capability.id.startsWith('manual_judgment_')).map(capability => capability.id), []);
  assert.ok(manifest.capabilities.some(capability => capability.id === 'trading_decision_review'));
  assert.ok(!manifest.capabilities.some(capability => capability.id === 'after_turn'));
  assert.ok(!manifest.hooks.some(hook => hook.event === 'lifecycle.afterAgentTurn'));
  assert.ok(!manifest.artifactSchemas.some(schema => schema.schema?.properties?.type?.const === 'judgment-criteria'));
  assert.ok(!manifest.knowledge.some(item => item.path.startsWith('judgment/')));
  assert.ok(!plugin.main_tool_names.some(name => name.startsWith('manual_judgment_')));
});

test('trading decision exports no judgment aliases or main-response audit handler', () => {
  const names = createCapabilities({ context: {} }).map(capability => capability.name);
  assert.ok(!names.some(name => name.startsWith('manual_judgment_')));
  assert.ok(!names.includes('after_turn'));
  assert.ok(names.includes('trading_decision_review'));
  assert.deepEqual(names.sort(), manifest.capabilities.map(capability => capability.binding.name).sort());
});

function snapshot(directory) {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? Object.entries(snapshot(path)).map(([name, bytes]) => [`${entry.name}/${name}`, bytes])
      : [[entry.name, createHash('sha256').update(readFileSync(path)).digest('hex')]];
  }));
}

for (const legacy of [false, true]) test(`activation preserves trading services ${legacy ? 'without opening or rewriting the old judgment ledger' : 'without creating another judgment ledger'}`, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'manual-judgment-boundary-'));
  const host = { context: { kind: 'main', sessionId: 'conv_main', pluginId: plugin.id, storageRoot: join(directory, 'private') }, capabilities: {}, runs: {} };
  const judgmentDirectory = join(host.context.storageRoot, 'judgment-state');
  let original;
  if (legacy) {
    mkdirSync(join(judgmentDirectory, 'exports'), { recursive: true });
    const database = new DatabaseSync(join(judgmentDirectory, 'judgments.sqlite'));
    try {
      database.exec('CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id));');
      database.prepare('INSERT INTO records VALUES(?,?,?)').run('historical', 'retained', JSON.stringify({ id: 'retained', note: 'Existing private user history' }));
    } finally { database.close(); }
    writeFileSync(join(judgmentDirectory, 'exports', 'CRITERIA.md'), 'Existing private criteria must remain byte-for-byte unchanged.\n');
    original = snapshot(judgmentDirectory);
  }
  const capabilities = createCapabilities(host);
  const call = (name, input = {}) => capabilities.find(capability => capability.name === name).execute(input);
  let active = false;
  t.after(async () => {
    if (active) await call('dispose');
    closeRecords(host);
    assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), 'manual-judgment-boundary-'))));
    rmSync(directory, { recursive: true, force: true });
  });
  assert.deepEqual(await call('activate'), { ready: true });
  active = true;
  assert.deepEqual(await call('trading_decision_plan', { action: 'list' }), { plans: [] });
  await call('dispose');
  active = false;
  if (legacy) assert.deepEqual(snapshot(judgmentDirectory), original);
  else assert.equal(existsSync(judgmentDirectory), false);
});
