import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Type } from '@sesame/plugin-sdk/schema';
import { createTools } from '../packages/research/tools.js';
import { digest } from '../packages/research/support.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sesame-research-real-path-')); t.after(() => rm(root, { recursive: true, force: true }));
  const input = { id: 'fixed', rows: [{ value: '2' }, { value: '3' }], provenance: { source_kind: 'synthetic' } }, registered = [], executions = new Map();
  const string = description => Type.String({ description, minLength: 1, maxLength: 20000 });
  const host = { scope: { conversationId: 'main' }, tools: { Type, string, optional: description => Type.Optional(string(description)), define: (name, description, properties, execute) => ({ name, label: name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) },
    workspace: { root: () => root, path: path => resolve(root, path), file: async (_operation, path, content) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); } },
    datasets: { read: id => { assert.equal(id, input.id); return input; }, register: data => registered.push(data) }, executions: { read: id => executions.get(id) } };
  const tools = createTools(host), call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  return { root, input, registered, executions, tools, call };
}

test('research data defaults to the real cwd and schemas match native path instructions', async t => {
  const f = await fixture(t);
  assert.deepEqual(JSON.parse(JSON.stringify(f.tools.map(({ execute, ...tool }) => tool))), JSON.parse(await readFile(new URL('../packages/research/tools.json', import.meta.url))));
  const data = await f.call('data_read', { dataset_id: f.input.id });
  assert.equal(data.path, join(f.root, 'inputs', 'fixed.json')); assert.deepEqual(JSON.parse(await readFile(data.path)), f.input.rows);
  assert.doesNotMatch(f.tools[0].description, /bwrap|沙箱/);
});

test('research registration retains frozen output and refuses paths or inputs outside the actual execution', async t => {
  const f = await fixture(t), path = join(f.root, 'output.json'); await writeFile(path, '[{"sum":999}]');
  const execution = { id: 'run', conversation_id: 'main', status: 'completed', workspace_path: f.root, code: { 'inputs/fixed.json': digest(JSON.stringify(f.input.rows)) }, source_files: { 'compute.py': Buffer.from('sum(values)').toString('base64') }, files: { 'output.json': Buffer.from('[{"sum":5}]').toString('base64') } };
  f.executions.set('run', execution);
  const args = { execution_id: 'run', path, input_ids: ['fixed'], recipe_paths: ['compute.py'], title: 'Demo sum', description: 'Exact frozen fixture' };
  await f.call('research_register', args);
  assert.deepEqual(f.registered[0].rows, [{ sum: 5 }]); assert.equal(f.registered[0].provenance.provider, 'pi/host'); assert.equal(f.registered[0].provenance.kind, 'demo');
  assert.throws(() => f.call('research_register', { ...args, path: join(f.root, '..', 'outside.json') }), /执行目录/);
  assert.throws(() => f.call('research_register', { ...args, recipe_paths: ['not-frozen.py'] }), /冻结输入/);
  f.input.rows[0].value = '100'; assert.throws(() => f.call('research_register', args), /原始快照/);
});

test('web source delivery returns an actual readable native path, not a mount alias', async t => {
  const { createServer } = await import('node:http');
  const { createTools: sourceTools } = await import('../packages/web-sources/tools.js');
  const root = await mkdtemp(join(tmpdir(), 'sesame-source-native-')); t.after(() => rm(root, { recursive: true, force: true }));
  const server = createServer((_request, response) => response.end('native source fixture'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const string = description => Type.String({ description }); let saved;
  const tool = sourceTools({ tools: { Type, string, define: (_name, _description, _shape, execute) => ({ execute }) }, scope: {}, datasets: { register: value => { saved = value; } }, workspace: { path: path => join(root, path), file: async (_method, path, content) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); } } })[0];
  const result = await tool.execute({ url: `http://127.0.0.1:${server.address().port}/example` });
  assert.equal(result.path, join(root, 'inputs', `${saved.id}.json`)); assert.equal(JSON.parse(await readFile(result.path))[0].text, 'native source fixture');
});
