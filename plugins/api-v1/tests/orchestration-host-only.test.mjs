import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { posix } from 'node:path';

const root = new URL('../packages/orchestration/', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const json = async path => JSON.parse(await read(path));

test('orchestration declares knowledge without duplicate callable or native entry points', async () => {
  const manifest = await json('plugin.json'), declarations = await json('capabilities.json');
  assert.equal(declarations.capabilities.length, 0, 'Agent execution and Run control belong to the host');
  for (const key of ['sources', 'views', 'services', 'hooks', 'stateCollections', 'artifactSchemas']) assert.deepEqual(declarations[key], [], key);
  assert.equal(manifest.entry, undefined);
  assert.equal(manifest.execution, undefined);
  assert.equal(manifest.version, '3.1.0');
  assert.equal((await json('package.json')).version, manifest.version);
  const files = await readdir(root);
  for (const path of ['index.js', 'tools.js', 'support.js']) assert.ok(!files.includes(path), `${path} is not part of a knowledge-only guide`);
});

test('the guide retains all seven linked reference chapters and declared prompt and skill', async () => {
  const manifest = await json('plugin.json'), declarations = await json('capabilities.json');
  const route = 'skills/sesame-user-guide/SKILL.md', body = await read(route);
  const links = [...body.matchAll(/\]\((references\/[^)]+\.md)\)/g)].map(match => posix.join(posix.dirname(route), match[1]));
  assert.equal(links.length, 7);
  assert.equal(new Set(links).size, 7);
  assert.deepEqual([...manifest.resources].sort(), [...links].sort());
  assert.deepEqual(declarations.knowledge.map(item => item.path).sort(), ['prompt.md', route, ...links].sort());
  for (const path of links) assert.ok((await read(path)).length > 100, path);
});

test('the published guidance uses the host names and preserves execution boundaries', async () => {
  const declarations = await json('capabilities.json');
  const text = (await Promise.all(declarations.knowledge.map(item => read(item.path)))).join('\n');
  assert.equal(/\bagent_(?:list|delegate|inspect|stop)\b/.test(text), false, 'the guide must not advertise removed aliases');
  assert.match(text, /host\.agent\.run/);
  assert.match(text, /host_agent_run/);
  for (const action of ['list', 'read', 'wait', 'interrupt', 'resume', 'message', 'cancel']) {
    assert.ok(text.includes(`host.runs.${action}`), action);
    assert.ok(text.includes(`host_runs_${action}`), action);
  }
  for (const field of ['allowedCalls', 'maxTurns', 'maxToolCalls', 'timeoutMs', 'run.output', 'interruptIds']) assert.ok(text.includes(field), field);
  assert.match(text, /type:\s*"report"/);
});
