import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readPackageDirectory } from '../../protocol/directory.mjs';
import { posix } from 'node:path';

const root = new URL('../packages/orchestration/', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const json = async path => JSON.parse(await read(path));

test('orchestration exposes only the three immediate navigation functions', async () => {
  const {manifest,capabilities:declarations} = readPackageDirectory(root);
  assert.deepEqual(declarations.capabilities.map(item => item.id).sort(), ['workflow_plan', 'workflow_status', 'workflow_step']);
  for (const capability of declarations.capabilities) {
    assert.equal(capability.kind, 'function');
    assert.equal(capability.execution, 'immediate');
    assert.ok(capability.effects.every(effect => ['state.read', 'state.write', 'read'].includes(effect)), capability.id);
    assert.equal(capability.effects.includes('state.write'), ['workflow_plan', 'workflow_step'].includes(capability.id));
  }
  assert.deepEqual(declarations.capabilities.filter(item => item.consumers.includes('host')).map(item => item.id), []);
  for (const key of ['sources', 'views', 'services', 'hooks', 'artifactSchemas']) assert.deepEqual(declarations[key], [], key);
  assert.deepEqual(declarations.stateCollections.map(item => item.name), []);
  assert.equal(manifest.entry, 'index.js');
  assert.equal(manifest.execution, 'native');
  assert.deepEqual(manifest.main_tool_names, ['workflow_status', 'workflow_plan', 'workflow_step']);
  assert.deepEqual(manifest.permissions, { scopes: ['workflows.navigate'], calls: [] });
  assert.equal((await json('package.json')).version, manifest.version);
  const files = await readdir(root);
  assert.ok(files.includes('index.js'));
});

test('the separate product guide retains all seven linked reference chapters and declared prompt and skill', async () => {
  const guideRead = path => readFile(new URL(`../user-guide/${path}`, root), 'utf8');
  const {manifest,capabilities:declarations} = readPackageDirectory(new URL('../user-guide/',root));
  const route = 'skills/sesame-user-guide/SKILL.md', body = await guideRead(route);
  const links = [...body.matchAll(/\]\(([^)]+\.md)\)/g)].map(match => posix.normalize(posix.join(posix.dirname(route), match[1])));
  assert.equal(links.length, 7);
  assert.equal(new Set(links).size, 7);
  assert.deepEqual([...manifest.resources].sort(), [...links].sort());
  assert.deepEqual(declarations.knowledge.map(item => item.path).sort(), ['instructions.md', route, ...links].sort());
  for (const path of links) assert.ok((await guideRead(path)).length > 100, path);
});

test('the published guidance uses the host names and preserves execution boundaries', async () => {
  const {capabilities:declarations} = readPackageDirectory(root);
  const text = (await Promise.all(declarations.knowledge.map(item => read(item.path)))).join('\n');
  assert.equal(/\bagent_(?:list|delegate|inspect|stop)\b/.test(text), false, 'the guide must not advertise removed aliases');
  assert.match(text, /host\.agent\.run/);
  assert.match(text, /host_agent_run/);
  for (const action of ['list', 'read', 'wait', 'interrupt', 'resume', 'message', 'cancel']) {
    assert.ok(text.includes(`host.runs.${action}`), action);
    assert.ok(text.includes(`host_runs_${action}`), action);
  }
  for (const field of ['allowedCalls', 'run.output', 'interruptIds']) assert.ok(text.includes(field), field);
  assert.match(text, /type:\s*"report"/);
});
