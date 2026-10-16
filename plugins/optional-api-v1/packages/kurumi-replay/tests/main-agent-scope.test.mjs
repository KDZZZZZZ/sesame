import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCapabilities } from '../index.js';

test('Kurumi main-only declarations match executable audience guards while player capabilities remain delegatable', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'));
  const declarations = JSON.parse(readFileSync(new URL('../capabilities.json', import.meta.url), 'utf8')).capabilities;
  const players = ['kurumi_observe', 'kurumi_decide'];
  const mainOnly = declarations.filter(item => item.id.startsWith('kurumi_') && !players.includes(item.id)).map(item => item.id);
  assert.equal(manifest.agent_scope, 'all');
  assert.deepEqual([...manifest.main_tool_names].sort(), mainOnly.sort());
  const implementations = createCapabilities({ context: { kind: 'subagent', sessionId: 'scope-fixture' } });
  for (const name of mainOnly) await assert.rejects(implementations.find(item => item.name === name).execute({}), { code: 'SCOPE_DENIED' });
  for (const name of players) {
    assert.ok(!manifest.main_tool_names.includes(name));
    assert.ok(declarations.find(item => item.id === name).consumers.includes('agent'));
  }
});
