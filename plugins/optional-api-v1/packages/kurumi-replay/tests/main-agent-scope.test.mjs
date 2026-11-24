import {readPackageDirectory} from '@sesame/plugin-sdk/surface';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCapabilities } from '../index.js';

test('Kurumi main-only declarations match executable audience guards while player capabilities remain delegatable', async () => {
  const manifest = readPackageDirectory(new URL('../', import.meta.url)).manifest;
  const declarations = readPackageDirectory(new URL('../', import.meta.url)).capabilities.capabilities;
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
