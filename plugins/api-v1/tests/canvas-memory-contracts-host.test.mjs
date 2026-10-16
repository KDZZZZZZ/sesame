import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Value } from '@sesame/plugin-sdk/schema/value';

const hostRoot = process.env.SESAME_HOST_ROOT;
const packages = fileURLToPath(new URL('../packages/', import.meta.url));
const integration = (name, run) => test(name, { skip: !hostRoot }, run);
const load = path => import(pathToFileURL(join(hostRoot, path)));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const memoryEntry = sources => ({ category: 'lessons/data-quality', title: '固定数据口径', summary: '保留证据版本。', content: '报告引用固定版本的来源。', scope: { kind: 'global' }, evidence: 'verified', sources });

async function fixture(t) {
  const [{ Store }, { Runtime }, { createHostContextV2 }] = await Promise.all([
    load('modules/agent/store.js'), load('modules/agent/runtime.js'), load('modules/plugins/host-v2/context.js'),
  ]);
  const directory = await mkdtemp(join(tmpdir(), 'sesame-canvas-memory-')), store = new Store(join(directory, 'state'));
  const runtime = await new Runtime(store, { piDir: join(directory, 'empty-models'), officialPluginsDirectory: join(directory, 'empty-official') }).init();
  t.after(async () => { await runtime.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const main = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main'), groups = {}, declarations = {};
  for (const name of ['canvas-control', 'memory', 'orchestration']) {
    const target = join(runtime.workspaces.root('conv_main'), name);
    await cp(join(packages, name), target, { recursive: true });
    await main.plugins.install({ path: target });
    await main.plugins.setEnabled('sesame/' + name, true, { scope: 'session' });
    assert.equal(runtime.plugins.entry('sesame/' + name).runtime_status, 'ready');
    declarations[name] = await json(join(target, 'capabilities.json'));
  }
  const definitions = runtime.plugins.definitions({ conversationId: 'conv_main' });
  for (const [name, declared] of Object.entries(declarations)) groups[name] = definitions.filter(tool => declared.capabilities.some(cap => cap.id === tool.name && cap.consumers.includes('agent')));
  const tool = name => definitions.find(item => item.name === name);
  const call = async (name, args) => (await tool(name).execute(crypto.randomUUID(), args)).details;
  store.put('message', { id: 'msg_user', role: 'user', conversation_id: 'conv_main', content: [{ type: 'text', text: '报告引用固定版本的来源。' }] });
  const ref = runtime.contractArtifacts.publish({ id: 'example/evidence', version: '1.0.0', digest: 'sha256:' + 'b'.repeat(64) }, {
    operationId: crypto.randomUUID(), manifest: { kind: 'resource', schemaVersion: '1.0.0', content: { note: 'Durable fixture evidence' }, dependencies: [], blobs: [] },
  });
  const expire = id => {
    const db = new DatabaseSync(join(directory, 'state/plugins/data/sesame/memory/memory/memory.sqlite'));
    try {
      const candidate = JSON.parse(db.prepare('SELECT body FROM memory_candidates WHERE id=?').get(id).body);
      candidate.expires_at = new Date(Date.now() - 1000).toISOString();
      db.prepare('UPDATE memory_candidates SET body=? WHERE id=?').run(JSON.stringify(candidate), id);
    } finally { db.close(); }
  };
  return { runtime, store, groups, declarations, tool, call, Check: Value.Check, ref, expire };
}

async function indicatorInput(parameters = []) {
  const definition = await json(join(packages, 'canvas-control/resources/close-line.json'));
  return { operation_id: crypto.randomUUID(), definition: { ...definition, parameters }, files: { 'close-line.js': await readFile(join(packages, 'canvas-control/resources/close-line.js'), 'utf8') } };
}

integration('indicator tool schema and actual host agree on integer and decimal parameter types', async t => {
  const f = await fixture(t), schema = f.tool('indicator_publish').parameters;
  assert.deepEqual(f.declarations['canvas-control'].artifactSchemas.find(item => item.id === 'indicator').schema, schema.properties.definition, 'publication and input schemas must use the same typed indicator body');
  const input = await indicatorInput([{ id: 'period', title: 'Period', type: 'integer', required: false, default: 20, min: 1, max: 100 }]);
  assert.equal(f.Check(schema, input), true, 'integer bounds must be JSON integers');
  const published = await f.call('indicator_publish', input);
  assert.equal(f.runtime.contractArtifacts.read(published.ref).manifest.content.parameters[0].min, 1);
  const wrong = structuredClone(input); wrong.operation_id = crypto.randomUUID(); wrong.definition.parameters[0].min = '1';
  assert.equal(f.Check(schema, wrong), false);
  const decimal = await indicatorInput([{ id: 'factor', title: 'Factor', type: 'decimal', required: false, default: '1.25', min: '0.01', max: '5' }]);
  assert.equal(f.Check(schema, decimal), true); await f.call('indicator_publish', decimal);
  decimal.definition.parameters[0].min = 0.01; assert.equal(f.Check(schema, decimal), false);
  const unsafe = structuredClone(input); unsafe.definition.parameters[0].max = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(f.Check(schema, unsafe), false);
  const outOfRange = structuredClone(input); outOfRange.operation_id = crypto.randomUUID(); outOfRange.definition.parameters[0].default = 101;
  await assert.rejects(f.call('indicator_publish', outOfRange), /exceeds max/);
});

integration('packaged indicator example is a complete publish call with top-level files', async t => {
  const f = await fixture(t), input = await json(join(packages, 'canvas-control/resources/indicator-publish.json'));
  const manifest = await json(join(packages, 'canvas-control/plugin.json'));
  assert.ok(manifest.resources.includes('resources/indicator-publish.json'));
  assert.ok(input.files[input.definition.implementation.entry]);
  assert.equal(f.Check(f.tool('indicator_publish').parameters, input), true);
  const { ref } = await f.call('indicator_publish', input);
  assert.equal(f.runtime.contractArtifacts.read(ref).manifest.kind, 'indicator');
  const { compute } = await import(`data:text/javascript,${encodeURIComponent(input.files[input.definition.implementation.entry])}`);
  const rows = [{ id: 'bar_one', openTime: { basis: 'wall', authority: 'fixture-broker', value: '2026-10-14T09:00:00' }, close: '1.234567890123456789' },
    { id: 'bar_two', openTime: { basis: 'wall', authority: 'fixture-broker', value: '2026-10-14T10:00:00' }, close: '1.234567890123456790' }];
  const output = compute({ parameters: { length: 1 }, inputs: { price: { rows } } });
  assert.deepEqual(output.series[0].points, [{ key: 'bar_two', time: rows[1].openTime, value: { status: 'value', value: rows[1].close } }]);
  assert.equal(compute({ parameters: { length: 20 }, inputs: { price: { rows: [] } } }).status, 'not_ready');
  const nested = structuredClone(input); nested.definition.implementation.files = nested.files; delete nested.files;
  assert.equal(f.Check(f.tool('indicator_publish').parameters, nested), false);
});

integration('canvas CAS errors expose the current version and inspect action without applying or retrying changes', async t => {
  const f = await fixture(t), command = { command_id: crypto.randomUUID(), expected_version: 1, operations: [
    { op: 'add', id: 'chart_two', chart: { symbol: 'Fixture' } }, { op: 'update', id: 'chart_main', chart: { averages: true } },
  ] };
  const changed = await f.call('canvas_apply', command); assert.equal(changed.version, 2);
  assert.equal((await f.call('canvas_apply', command)).replayed, true);
  for (const [name, args] of [
    ['canvas_apply', { command_id: crypto.randomUUID(), expected_version: 1, operations: [{ op: 'remove', id: 'chart_two' }] }],
    ['canvas_focus', { command_id: crypto.randomUUID(), expected_version: 1, chart_id: 'chart_two' }],
  ]) await assert.rejects(f.call(name, args), error => {
    assert.equal(error.code, 'version_conflict'); assert.equal(error.details.current_version, 2);
    assert.deepEqual(error.details.next_action, { tool: 'canvas_inspect', arguments: {} });
    assert.match(error.message, /canvas_inspect/); return true;
  });
  assert.equal(f.runtime.canvas.document().version, 2); assert.equal(f.runtime.canvas.document().charts.length, 2);
  const inspected = await f.call('canvas_inspect', {});
  await f.call('canvas_apply', { command_id: crypto.randomUUID(), expected_version: inspected.version, operations: [{ op: 'remove', id: 'chart_two' }] });
  assert.equal(f.runtime.canvas.document().version, 3);
});

integration('indicator mounting reports the same CAS recovery and respects user chart locks', async t => {
  const f = await fixture(t), { ref: artifact } = await f.call('indicator_publish', await indicatorInput());
  await f.call('canvas_apply', { command_id: crypto.randomUUID(), expected_version: 1, operations: [{ op: 'update', id: 'chart_main', chart: { volume: false } }] });
  await assert.rejects(f.call('chart_script', { action: 'put', command_id: crypto.randomUUID(), expected_version: 1, chart_id: 'chart_main', artifact }), error => {
    assert.equal(error.code, 'version_conflict'); assert.equal(error.details.current_version, 2); return true;
  });
  assert.equal(f.store.list('canvas_script').length, 0);
  f.runtime.canvas.apply({ command_id: crypto.randomUUID(), expected_version: 2, operations: [{ op: 'update', id: 'chart_main', chart: { locked: true } }] });
  await assert.rejects(f.call('canvas_focus', { command_id: crypto.randomUUID(), expected_version: 3, chart_id: 'chart_main' }), error => error.code === 'canvas_locked');
});

integration('memory schema distinguishes user messages and complete frozen ArtifactRefs without accepting legacy references', async t => {
  const f = await fixture(t), schema = f.tool('memory_propose').parameters;
  const valid = memoryEntry([{ type: 'artifact', ...f.ref }]);
  assert.equal(f.Check(schema, valid), true);
  const candidate = await f.call('memory_propose', valid); assert.deepEqual(candidate.sources, valid.sources);
  assert.equal(f.Check(schema, memoryEntry([f.ref])), false);
  assert.equal(f.Check(schema, memoryEntry([{ type: 'artifact', id: f.ref.id, revision: f.ref.revision }])), false);
  assert.equal(f.Check(schema, memoryEntry([{ type: 'user_message', ...f.ref }])), false, 'an artifact cannot silently become a user message');
  assert.equal(f.Check(schema, memoryEntry([{ type: 'user_message', id: 'msg_user' }])), true);
  assert.equal(f.Check(schema, memoryEntry([{ type: 'artifact', id: 'legacy_report', revision: 1 }])), false);
  await assert.rejects(f.call('memory_propose', memoryEntry([{ type: 'artifact', ...f.ref, digest: `sha256:${'c'.repeat(64)}` }])), /not found/);
});

integration('candidate IDs stay distinct from accepted memory IDs and stale candidate versions retain CAS', async t => {
  const f = await fixture(t), candidate = await f.call('memory_propose', memoryEntry([{ type: 'artifact', ...f.ref }]));
  await assert.rejects(f.call('memory_read', { id: candidate.id }), error => {
    assert.equal(error.code, 'memory_candidate_id');
    assert.deepEqual(error.details.next_action, { tool: 'memory_manage', arguments: { action: 'candidates' } });
    assert.match(error.message, /memory\.id/); return true;
  });
  await assert.rejects(f.call('memory_manage', { action: 'accept', id: candidate.id, expected_version: candidate.version + 1 }), error => {
    assert.equal(error.code, 'version_conflict'); assert.equal(error.details.current_version, candidate.version);
    assert.deepEqual(error.details.next_action, { tool: 'memory_manage', arguments: { action: 'candidates' } }); return true;
  });
  assert.equal((await f.call('memory_search', {})).total, 0);
  const refreshed = (await f.call('memory_manage', { action: 'candidates' })).items.find(item => item.id === candidate.id);
  const accepted = await f.call('memory_manage', { action: 'accept', id: refreshed.id, expected_version: refreshed.version });
  assert.equal(accepted.id, candidate.id); assert.notEqual(accepted.memory.id, candidate.id);
  assert.deepEqual((await f.call('memory_read', { id: accepted.memory.id })).sources, candidate.sources);
});

integration('memory scopes require the project and strategy identities before dispatch', async t => {
  const f = await fixture(t), schema = f.tool('memory_propose').parameters;
  const entry = memoryEntry([{ type: 'user_message', id: 'msg_user' }]);
  for (const scope of [{ kind: 'project' }, { kind: 'strategy', strategy_id: 'sweep' }, { kind: 'strategy', project_id: 'project_a' }, { kind: 'global', project_id: 'project_a' }]) {
    assert.equal(f.Check(schema, { ...entry, scope }), false, JSON.stringify(scope));
  }
  for (const scope of [{ kind: 'global' }, { kind: 'project', project_id: 'project_a' }, { kind: 'strategy', project_id: 'project_a', strategy_id: 'sweep' }]) {
    assert.equal(f.Check(schema, { ...entry, scope }), true, JSON.stringify(scope));
    assert.equal(f.Check(f.tool('memory_manage').parameters, { action: 'save', entry: { ...entry, scope } }), true);
  }
  assert.equal(f.Check(f.tool('memory_manage').parameters, { action: 'save', id: 'mem_existing', expected_version: 1, entry: { summary: '只修订摘要。' } }), true);
});

integration('saved-memory version conflicts and expired candidates give accurate recovery without automatic writes', async t => {
  const f = await fixture(t), entry = memoryEntry([{ type: 'artifact', ...f.ref }]);
  const saved = await f.call('memory_manage', { action: 'save', entry });
  const edited = await f.call('memory_manage', { action: 'save', id: saved.id, expected_version: saved.version, entry: { summary: '已核验固定证据版本。' } });
  await assert.rejects(f.call('memory_manage', { action: 'archive', id: saved.id, expected_version: saved.version }), error => {
    assert.equal(error.code, 'version_conflict'); assert.equal(error.details.current_version, edited.version);
    assert.deepEqual(error.details.next_action, { tool: 'memory_read', arguments: { id: saved.id } }); return true;
  });
  assert.equal((await f.call('memory_read', { id: saved.id })).version, edited.version);
  const candidate = await f.call('memory_propose', { ...entry, title: '需要另行核验的来源' }); f.expire(candidate.id);
  await assert.rejects(f.call('memory_manage', { action: 'accept', id: candidate.id, expected_version: candidate.version }), error => {
    assert.equal(error.code, 'memory_candidate_expired'); assert.match(error.message, /最终成果/); return true;
  });
  assert.equal((await f.call('memory_search', {})).total, 1);
});

integration('delegation uses the unified Agent Run input and optional explicit report output', async t => {
  const f = await fixture(t), schema = f.tool('agent_delegate').parameters;
  const task = { title: 'Fixture', instructions: 'Read fixture inputs', objective: 'Return their count', input: {}, allowedCalls: [], budget: { maxTurns: 1, maxToolCalls: 0, timeoutMs: 1000 } };
  assert.equal(f.Check(schema, { ...task, output: { type: 'none' } }), true);
  assert.equal(f.Check(schema, { ...task, output: { type: 'report', space: 'strategy', path: 'signals.html' } }), true);
  assert.equal(f.Check(schema, task), true, 'an ordinary Run does not require a report destination');
  assert.equal(f.Check(schema, { ...task, conversation_id: 'existing' }), false, 'legacy task controls are not reintroduced');
  assert.equal(f.Check(schema, { ...task, output: { type: 'report', space: 'research' } }), false);
});

integration('published capability declarations match installed Agent tool schemas without legacy tools.json', async t => {
  const f = await fixture(t);
  for (const [name, tools] of Object.entries(f.groups)) {
    const expected = f.declarations[name].capabilities.filter(cap => cap.consumers.includes('agent'));
    assert.deepEqual(tools.map(tool => tool.name).sort(), expected.map(cap => cap.id).sort());
    for (const cap of expected) {
      const tool = tools.find(tool => tool.name === cap.id);
      assert.deepEqual(tool.parameters, cap.inputSchema);
      assert.ok(tool.description.includes(cap.description));
      assert.ok(tool.description.includes(cap.usage.inputs));
    }
  }
});
