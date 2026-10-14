import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MiningRuntime } from '../packages/auto-factor-mining/runtime.js';
import { canonical, digest, ID } from '../packages/auto-factor-mining/shared.js';
import { createTools } from '../packages/auto-factor-mining/index.js';
import { evaluate } from '../packages/factor-evaluator/evaluator.js';
import { resolveResearch } from '../packages/auto-factor-mining/composition.js';

const iso = day => new Date(Date.UTC(2024, 0, day)).toISOString();
const expression = { op: 'field', name: 'signal' };
const rows = Array.from({ length: 13 }, (_, day) => Array.from({ length: 4 }, (_, i) => ({ time: iso(day + 1), availableAt: iso(day + 1), symbol: `S${i}`, fields: { close: 100 * (1 + i / 100) ** day, signal: i } }))).flat();
const models = [{ provider: 'fixture', id: 'main', configurationDigest: 'fixed' }, { provider: 'fixture', id: 'review', configurationDigest: 'review-fixed' }];
const input = () => ({ request_id: 'one', title: 'Synthetic test', goal: 'Exercise real formula evaluation with simulated roles', dataset_id: 'data', config: { model: models[0], agentModels: { reviewer: models[1] }, rounds: 1, directions: ['momentum'], evaluator: { plugin_id: 'sesame/factor-evaluator', tool: 'factor_evaluate', arguments: { dataset: { trainEnd: iso(5), validationEnd: iso(9), holdoutEnd: iso(13) } } } } });
const copy = value => {
  const checkJson = item => { assert.notEqual(item, undefined, 'Persisted values cannot contain undefined'); if (item && typeof item === 'object') Object.values(item).forEach(checkJson); };
  checkJson(value); return JSON.parse(canonical(value));
};
let sequence = 0;
const poll = async condition => { for (let i = 0; i < 500; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 2)); } assert.fail('Fixture did not settle'); };

function fixture({ storage, onTask } = {}) {
  const db = storage ?? new Map(), requests = [], jobs = new Map(), fileMap = new Map(), fileWrites = [];
  const store = {
    directory: 'fixture-storage',
    get(c, id, optional = false) { const v = db.get(`${c}:${id}`); if (!v && !optional) throw new Error('Missing record'); return v ? copy(v) : null; },
    put(c, value) { const v = copy(value); db.set(`${c}:${v.id}`, v); return copy(v); },
    list(c) { return [...db.entries()].filter(([k]) => k.startsWith(`${c}:`)).map(([, v]) => copy(v)); }, transaction: fn => fn(),
  };
  const files = {
    async list() { return { entries: [...fileMap.values()].map(v => ({ id: v.id, path: v.path, kind: v.kind })) }; },
    async mkdir({ path }) { fileMap.set(path, { id: path, path, kind: 'directory' }); },
    async read({ path }) { return { content: fileMap.get(path).content }; },
    async write({ path, content }) { assert.ok(!fileMap.has(path), 'Existing files must not be overwritten'); const entry = { id: path, path, kind: 'file', content }; fileMap.set(path, entry); fileWrites.push(path); return entry; },
  };
  const host = { scope: { kind: 'service' }, storage: store, datasets: { read: () => ({ rows, provenance: { kind: 'synthetic' } }) }, inference: { models: () => models.map(copy) }, reports: { files: { forSpace: () => files } }, artifacts: { blob: content => ({ digest: String(content.length), bytes: Buffer.byteLength(content) }), publish: () => ({ id: 'artifact', revision: 1 }) },
    agents: {
      submit(request) {
        const id = `job-${++sequence}`; requests.push(copy(request));
        let resolve; const promise = new Promise(r => { resolve = r; });
        const job = { id, status: 'running', request, promise, resolve }; jobs.set(id, job);
        queueMicrotask(async () => {
          const current = () => ({ id, status: job.status, pluginId: ID, input: request.input, conversationId: id });
          const child = { ...host, scope: { kind: 'subagent', conversationId: id }, agents: { ...host.agents, current } };
          child.tools = host.toolsFor(child);
          try {
            if (await onTask?.({ request, child, runtime, job }) === 'hold') return;
            const { runId, mode, direction } = request.input;
            const context = runtime.context(child, runId);
            const output = {
              plan: { directions: [direction ?? 'momentum'], stop: false, reason: 'Fixed synthetic direction' },
              hypothesis: { hypothesis: 'Synthetic ordering', rationale: 'Numerical oracle, no market claim' },
              code: { candidate: expression, explanation: 'Read the observed synthetic feature' },
              review: { verdict: 'accept', reason: 'Measured IC passes the fixture threshold' },
              reflection: { summary: 'Observed deterministic ordering', lessons: ['Test other data'], stop: false },
              selection: { trialIds: context.trials?.items.filter(t => t.status === 'accepted').map(t => t.id) ?? [], reason: 'Freeze measured candidates' },
            }[mode];
            if (mode === 'report') await runtime.report(child, runId); else if (mode === 'finalize') await runtime.finalize(child, runId); else await runtime.submit(child, runId, output);
            job.status = 'completed'; resolve({ id, status: 'completed', conversationId: id, result: { text: 'fixture done' } });
          } catch (error) { job.status = 'failed'; resolve({ id, status: 'failed', error: error.message }); }
        });
        return { id, status: 'queued' };
      },
      wait(id, signal) {
        return new Promise((resolve, reject) => {
          const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
          jobs.get(id).promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        });
      },
      cancel(id) { const job = jobs.get(id); if (job) { job.status = 'cancelled'; job.resolve({ id, status: 'cancelled' }); } },
      current: () => null,
    },
  };
  host.plugins = { inspect: id => ({ id, version: '1.0.0-dev.1', digest: 'fixture-evaluator', state: 'mounted', runtime_status: 'ready', agent_scope: 'all', tools: ['factor_evaluate'], delegatable_tools: ['factor_evaluate'] }), load: async () => {} };
  const toolsFor = context => ({ async call({ pluginId, name, arguments: args }) {
    assert.notEqual(context.scope.kind, 'service', 'Background service cannot call evaluator tools');
    assert.equal(pluginId, 'sesame/factor-evaluator'); assert.equal(name, 'factor_evaluate');
    const target = { ...context, plugin: { id: pluginId }, tools: { invocation: () => ({ chain: [{ pluginId: ID, toolName: 'workflow_fixture' }, { pluginId, toolName: name }] }) },
      storage: { get: (c, id, optional) => store.get('evaluator_' + c, id, optional), put: (c, value) => store.put('evaluator_' + c, value) } };
    return { details: evaluate(target, args) };
  } });
  host.toolsFor = toolsFor; host.tools = toolsFor(host);
  const runtime = new MiningRuntime(host).start(), main = { ...host, scope: { kind: 'main', conversationId: 'main' } }; main.tools = toolsFor(main);
  return { host, main, runtime, requests, db, files, fileMap, fileWrites };
}
async function finished(f, id) { await poll(() => !f.runtime.running.has(id)); return f.runtime.get(id); }

test('actual evaluator, structured stages, per-role models, evidence archive and idempotent retry', async () => {
  const f = fixture(), run = await f.runtime.create(f.main, input());
  assert.equal((await f.runtime.create(f.main, input())).id, run.id);
  const result = await finished(f, run.id);
  assert.equal(result.status, 'completed', JSON.stringify(result.error));
  assert.equal(result.trials[0].metrics.validation.rankIC, 1);
  assert.equal(Object.keys(result.holdout).length, 1);
  assert.ok(result.selection.frozenAt);
  assert.equal(f.requests.find(r => r.input.mode === 'review').model.id, 'review');
  assert.ok(f.requests.every(r => r.output.type === 'none' && !r.tools.some(t => /order|trade|workspace/.test(t))));
  assert.equal(f.fileWrites.length, 4);
  assert.match(f.fileMap.get(result.report.path).content, /SIMULATED/);
  const writes = f.fileWrites.length; await f.runtime.report(f.main, run.id); assert.equal(f.fileWrites.length, writes);
  await assert.rejects(() => f.runtime.create(f.main, { ...input(), goal: 'different' }), /different frozen inputs/);
  assert.throws(() => f.runtime.context({ ...f.main, scope: { kind: 'main', conversationId: 'other' } }, run.id), /another conversation/);
  const next = await f.runtime.create(f.main, { ...input(), request_id: 'next' });
  assert.equal(next.memory.length, 1); assert.equal((await finished(f, next.id)).status, 'completed');
});

test('PIT-invalid input fails before any Agent submission', async () => {
  const f = fixture(); f.main.datasets = { read: () => ({ rows: [{ ...rows[0], availableAt: iso(2) }, ...rows.slice(1)] }) };
  await assert.rejects(() => f.runtime.create(f.main, input()), /Point-in-time/); assert.equal(f.requests.length, 0);
});

test('an immediate pause/cancel before the pump microtask cannot be overwritten', async () => {
  for (const action of ['pause', 'cancel']) {
    const f = fixture(), run = await f.runtime.create(f.main, input());
    await f.runtime.control(f.main, run.id, action);
    assert.equal(f.runtime.get(run.id).status, action === 'pause' ? 'paused' : 'cancelled'); assert.equal(f.requests.length, 0);
    if (action === 'pause') { await f.runtime.control(f.main, run.id, 'resume'); assert.equal((await finished(f, run.id)).status, 'completed'); }
  }
});

test('pause in a coder, Store round trip, and explicit resume preserve prior paid checkpoints', async () => {
  let held = false;
  const f = fixture({ onTask: ({ request }) => { if (request.input.mode === 'code') { held = true; return 'hold'; } } });
  const run = await f.runtime.create(f.main, input()); await poll(() => held);
  await f.runtime.control(f.main, run.id, 'pause');
  const g = fixture({ storage: f.db });
  assert.equal(g.requests.length, 0); await g.runtime.control(g.main, run.id, 'resume');
  const result = await finished(g, run.id); assert.equal(result.status, 'completed');
  assert.ok(!g.requests.some(r => ['plan', 'hypothesis'].includes(r.input.mode)), 'Submitted checkpoints must not call models twice');
  assert.equal(result.generation, 1);
});

test('restart marks unfinished research interrupted and requires explicit resume', async () => {
  const f = fixture({ onTask: () => 'hold' }), run = await f.runtime.create(f.main, input()); await poll(() => f.requests.length > 0);
  await f.runtime.dispose(); const g = fixture({ storage: f.db });
  assert.equal(g.runtime.get(run.id).status, 'interrupted'); assert.equal(g.requests.length, 0);
  await g.runtime.control(g.main, run.id, 'resume'); assert.equal((await finished(g, run.id)).status, 'completed');
});

test('shutdown during reporter preserves completed research', async () => {
  let reporter = false;
  const f = fixture({ onTask: ({ request }) => { if (request.input.mode === 'report') { reporter = true; return 'hold'; } } });
  const run = await f.runtime.create(f.main, input()); await poll(() => reporter); await f.runtime.dispose();
  assert.equal(f.runtime.get(run.id).status, 'completed'); assert.equal(f.runtime.get(run.id).reportPending, true);
});

test('restart reconciles an unfinished reporter without reopening completed research', async () => {
  const f = fixture({ onTask: ({ request }) => request.input.mode === 'report' ? 'hold' : undefined });
  const run = await f.runtime.create(f.main, input()); await poll(() => f.runtime.get(run.id).tasks.some(task => task.role === 'reporter'));
  const g = fixture({ storage: f.db });
  const recovered = g.runtime.get(run.id);
  assert.equal(recovered.status, 'completed'); assert.equal(g.requests.length, 0);
  assert.ok(recovered.tasks.every(task => task.finishedAt)); assert.equal(recovered.tasks.at(-1).status, 'interrupted');
  assert.equal(recovered.reportPending, true); await g.runtime.report(g.main, run.id);
  assert.equal(g.fileWrites.filter(path => path.endsWith('.html')).length, 1); await f.runtime.dispose(); await g.runtime.dispose();
});

test('role spoofing, foreign run access, rewritten output and holdout rows are rejected or hidden', async () => {
  let checked = false;
  const f = fixture({ onTask: async ({ request, child, runtime }) => {
    if (request.input.mode !== 'plan') return;
    const id = request.input.runId;
    assert.ok(runtime.context(child, id, 'data', 0, 100).rows.items.every(r => r.time <= iso(9)));
    const spoof = { ...child, agents: { ...child.agents, current: () => ({ ...child.agents.current(), input: { ...request.input, role: 'reviewer' } }) } };
    await assert.rejects(() => runtime.submit(spoof, id, {}), /registered running Agent/);
    const output = { directions: ['momentum'], stop: false, reason: 'Fixed synthetic direction' };
    await runtime.submit(child, id, output); await assert.rejects(() => runtime.submit(child, id, { ...output, reason: 'rewrite' }), /different output/); checked = true;
  } });
  const run = await f.runtime.create(f.main, input()); assert.equal((await finished(f, run.id)).status, 'completed'); assert.ok(checked);
});

test('research budget stops new experiments while reserving one final summary', async () => {
  const f = fixture(), args = input(); args.config.maxTasks = 4;
  const run = await f.runtime.create(f.main, args), result = await finished(f, run.id);
  assert.equal(result.status, 'exhausted'); assert.equal(f.requests.length, 5); assert.equal(result.reportPending, false);
  assert.equal(f.requests.at(-1).input.mode, 'report');
  assert.equal(result.trials.length, 1); assert.ok(!result.selection);
  await f.runtime.report(f.main, run.id); assert.equal(f.runtime.get(run.id).reportPending, false);
});

test('configured model drift blocks resume without silently selecting a replacement', async () => {
  const f = fixture(), run = await f.runtime.create(f.main, input()); await f.runtime.control(f.main, run.id, 'pause');
  f.main.inference = { models: () => [{ ...models[0], configurationDigest: 'changed' }, models[1]] };
  await assert.rejects(f.runtime.control(f.main, run.id, 'resume'), /configuration changed/); assert.equal(f.requests.length, 0);
});

test('factory is pure and produces all declared tools for every scope', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packages/auto-factor-mining/plugin.json', import.meta.url)));
  for (const kind of ['main', 'subagent']) {
    const host = { scope: { kind }, tools: { Type: { Optional: value => value }, define: (name, description, properties, handler) => ({ name, description, properties, handler }) } };
    Object.defineProperty(host, 'storage', { get() { throw new Error('Factory side effect'); } });
    assert.deepEqual(createTools(host).map(t => t.name), manifest.tool_names);
  }
});

test('paused research publishes nothing; cancelled final summary keeps untouched holdout sealed', async () => {
  const f = fixture(); f.main.datasets = { read: () => ({ rows: rows.map(row => row.time > iso(9) ? { ...row, fields: { ...row.fields, futureOnly: 999 } } : row) }) };
  const run = await f.runtime.create(f.main, input()); await f.runtime.control(f.main, run.id, 'pause');
  assert.ok(!f.runtime.context(f.main, run.id).data.fields.includes('futureOnly'));
  await assert.rejects(f.runtime.report(f.main, run.id), /Only completed, cancelled or exhausted/);
  assert.equal(f.fileWrites.length, 0);
  const result = await f.runtime.control(f.main, run.id, 'cancel'), report = result.report;
  const archive = JSON.parse(f.fileMap.get(report.datasetPath).content);
  assert.equal(archive.holdoutSealed, true);
  assert.ok(archive.dataset.rows.every(row => row.time <= iso(9) && !('futureOnly' in row.fields)));
  await assert.rejects(f.runtime.control(f.main, run.id, 'resume'), /Only paused, interrupted or failed/);
  assert.equal(f.fileWrites.filter(path => path.endsWith('.html')).length, 1);
});

test('evaluator version or input drift prevents mixing cached and new experiments', async () => {
  for (const change of ['version', 'data']) {
    const f = fixture(), run = await f.runtime.create(f.main, input()); await f.runtime.control(f.main, run.id, 'pause');
    const stored = f.host.storage.get('datasets', run.id);
    if (change === 'version') stored.dataset.evaluatorVersion = 'changed'; else stored.dataset.rows[0].fields.close = 999;
    f.host.storage.put('datasets', stored);
    await assert.rejects(f.runtime.control(f.main, run.id, 'resume'), /version changed|identity changed/); assert.equal(f.requests.length, 0);
  }
});

test('concurrent final summary requests share one frozen publication', async () => {
  const f = fixture({ onTask: ({ request }) => request.input.mode === 'report' ? 'hold' : undefined });
  const run = await f.runtime.create(f.main, input()); await poll(() => f.runtime.get(run.id).status === 'completed');
  const write = f.files.write; let release, writing = false;
  f.files.write = async args => { writing = true; await new Promise(resolve => { release = resolve; }); f.files.write = write; return write(args); };
  const pending = f.runtime.report(f.main, run.id); await poll(() => writing);
  const second = f.runtime.report(f.main, run.id);
  await assert.rejects(f.runtime.control(f.main, run.id, 'resume'), /Only paused, interrupted or failed/); release();
  const [first, again] = await Promise.all([pending, second]); assert.deepEqual(first, again);
  assert.equal(f.fileWrites.length, 4); assert.equal(f.runtime.get(run.id).reportPending, false);
  await f.runtime.dispose();
});

test('reporter must submit its own receipt even if a main Agent has exported the run', async () => {
  const f = fixture({ onTask: async ({ request, runtime, job }) => {
    if (request.input.mode !== 'report') return;
    await runtime.report(f.main, request.input.runId);
    job.status = 'completed'; job.resolve({ id: job.id, status: 'completed', result: { text: 'No actual tool call' } }); return 'hold';
  } });
  const run = await f.runtime.create(f.main, input()), result = await finished(f, run.id);
  assert.equal(result.status, 'completed'); assert.equal(result.reportPending, true); assert.equal(result.reportError.code, 'MISSING_OUTPUT');
});

test('late cancelled task cannot access a resumed generation even if host cancellation fails', async () => {
  let oldChild, oldJob;
  const f = fixture({ onTask: ({ child, job }) => { oldChild ??= child; oldJob ??= job; return 'hold'; } });
  const run = await f.runtime.create(f.main, input()); await poll(() => oldChild);
  await f.runtime.control(f.main, run.id, 'pause'); await f.runtime.control(f.main, run.id, 'resume'); oldJob.status = 'running';
  assert.throws(() => f.runtime.context(oldChild, run.id), /registered running Agent/);
  await f.runtime.control(f.main, run.id, 'pause');
});

test('archived experiment and input reproduce through the public standalone CLI', async () => {
  const f = fixture(), run = await f.runtime.create(f.main, input()), result = await finished(f, run.id);
  const directory = mkdtempSync(join(tmpdir(), 'sesame-factor-reproduce-'));
  const runPath = join(directory, 'run.json'), dataPath = join(directory, 'data.json');
  try {
    writeFileSync(runPath, f.fileMap.get(result.report.dataPath).content);
    writeFileSync(dataPath, f.fileMap.get(result.report.datasetPath).content);
    const output = spawnSync(process.execPath, [fileURLToPath(new URL('../packages/factor-evaluator/scripts/reproduce.mjs', import.meta.url)), runPath, dataPath], { encoding: 'utf8' });
    assert.equal(output.status, 0, output.stderr); assert.equal(JSON.parse(output.stdout).verified, true);
    const changed = JSON.parse(readFileSync(dataPath, 'utf8')); changed.dataset.rows[0].fields.close = 999; writeFileSync(dataPath, JSON.stringify(changed));
    const rejected = spawnSync(process.execPath, [fileURLToPath(new URL('../packages/factor-evaluator/scripts/reproduce.mjs', import.meta.url)), runPath, dataPath], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /digest differs/);
  } finally { unlinkSync(runPath); unlinkSync(dataPath); rmdirSync(directory); }
});

test('final summary follows user moves and preserves edits and deletion', async () => {
  const f = fixture(), run = await f.runtime.create(f.main, input()), done = await finished(f, run.id);
  const original = f.fileMap.get(done.report.path), movedPath = '自选目录/总结.html';
  f.fileMap.delete(done.report.path); f.fileMap.set(movedPath, { ...original, path: movedPath });
  const moved = await f.runtime.report(f.main, run.id);
  assert.equal(moved.fileId, original.id); assert.equal(moved.path, movedPath); assert.equal(moved.state, 'archived');
  f.fileMap.set(movedPath, { ...original, path: movedPath, content: 'user edited' });
  assert.equal((await f.runtime.report(f.main, run.id)).state, 'modified_by_user');
  assert.equal(f.fileMap.get(movedPath).content, 'user edited');
  f.fileMap.delete(movedPath);
  assert.equal((await f.runtime.report(f.main, run.id)).state, 'removed_by_user');
  assert.equal(f.fileWrites.length, 4);
});

test('partial publication retries keep the same snapshot and respect saved file identities', async () => {
  const f = fixture({ onTask: ({ request }) => request.input.mode === 'report' ? 'hold' : undefined });
  const run = await f.runtime.create(f.main, input()); await poll(() => f.runtime.get(run.id).status === 'completed');
  const write = f.files.write; let calls = 0;
  f.files.write = async args => { if (++calls === 2) throw new Error('fixture write failure'); return write(args); };
  await assert.rejects(f.runtime.report(f.main, run.id), /fixture write failure/);
  const frozen = canonical(f.runtime.get(run.id).reportSnapshot), recorded = f.runtime.get(run.id).reportFiles[0];
  const file = f.fileMap.get(recorded.path); f.fileMap.delete(recorded.path);
  f.fileMap.set('moved-evidence.json', { ...file, path: 'moved-evidence.json' });
  f.files.write = write;
  const report = await f.runtime.report(f.main, run.id);
  assert.equal(report.dataPath, 'moved-evidence.json'); assert.equal(f.fileWrites.length, 4);
  assert.equal(canonical(f.runtime.get(run.id).reportSnapshot), frozen);
  await f.runtime.dispose();
});

test('resumable failures and interruption cannot publish a final summary', async () => {
  const f = fixture({ onTask: ({ job }) => { job.status = 'failed'; job.resolve({ id: job.id, status: 'failed', error: 'fixture model failed' }); return 'hold'; } });
  const run = await f.runtime.create(f.main, input()), failed = await finished(f, run.id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.reportPending, false); assert.equal(f.fileWrites.length, 0);
  await assert.rejects(f.runtime.report(f.main, run.id), /Only completed, cancelled or exhausted/);
  f.runtime.update(run.id, { status: 'interrupted' });
  await assert.rejects(f.runtime.report(f.main, run.id), /Only completed, cancelled or exhausted/);
  const cancelled = await f.runtime.control(f.main, run.id, 'cancel');
  assert.equal(cancelled.reportPending, false); assert.equal(f.fileWrites.filter(path => path.endsWith('.html')).length, 1);
});

test('a nominally completed run cannot publish while a research Agent is unsettled', async () => {
  const f = fixture({ onTask: () => 'hold' }), run = await f.runtime.create(f.main, input()); await poll(() => f.requests.length > 0);
  f.runtime.update(run.id, { status: 'completed' });
  await assert.rejects(f.runtime.report(f.main, run.id), /all research tasks settled/);
  assert.equal(f.fileWrites.length, 0); await f.runtime.dispose();
});

test('arbitrary research tools and skill-only plugins run with honest development-only evidence', async () => {
  const f = fixture(), original = f.host.plugins.inspect;
  f.host.plugins.inspect = id => id === 'sesame/factor-evaluator' ? original(id) : { id, version: '2.0.0', digest: id, state: 'discoverable', runtime_status: 'ready', agent_scope: 'all',
    tools: id === 'arbitrary/research' ? ['whatever_search', 'whatever_configure'] : [], delegatable_tools: id === 'arbitrary/research' ? ['whatever_search'] : [] };
  f.main.datasets = { read: () => ({ rows: rows.filter(row => row.time <= iso(9)) }) };
  const args = input(); args.config.research = { plugins: ['arbitrary/research', 'local/skill-only'] };
  const run = await f.runtime.create(f.main, args), result = await finished(f, run.id);
  assert.equal(result.status, 'completed', JSON.stringify(result.error)); assert.equal(result.data.holdoutMode, 'none'); assert.deepEqual(result.holdout, {});
  for (const request of f.requests.filter(r => !['report', 'finalize'].includes(r.input.mode))) {
    assert.ok(request.plugins.includes('local/skill-only')); assert.ok(request.tools.includes('whatever_search')); assert.ok(!request.tools.includes('whatever_configure'));
  }
  assert.match(f.fileMap.get(result.report.path).content, /未执行留出检验/);
  const bad = input(); bad.config.research = args.config.research; bad.request_id = 'raw-holdout'; f.main.datasets = f.host.datasets;
  await assert.rejects(f.runtime.create(f.main, bad), /after validationEnd/);
});

test('workflow accepts a selected non-AST evaluator and never calculates or accepts model-supplied metrics', async () => {
  const f = fixture({ onTask: async ({ request, child, runtime, job }) => {
    if (request.input.mode !== 'code') return;
    await runtime.submit(child, request.input.runId, { candidate: { recipe: 'custom expression language' }, explanation: 'Independent capability', metrics: { invented: 999 } });
    job.status = 'completed'; job.resolve({ id: job.id, status: 'completed', result: { text: 'Measured custom candidate' } }); return 'hold';
  } });
  f.host.plugins.inspect = id => ({ id, version: '3.0.0', digest: 'custom', state: 'mounted', runtime_status: 'ready', agent_scope: 'all', tools: ['custom_measure'], delegatable_tools: ['custom_measure'] });
  const calls = [];
  const toolsFor = context => ({ async call({ pluginId, name, arguments: request }) {
    assert.notEqual(context.scope.kind, 'service'); assert.equal(pluginId, 'vendor/independent-evaluation'); assert.equal(name, 'custom_measure'); calls.push(request.action);
    const common = { protocol: 'sesame.factor-evaluator/v1', action: request.action, runId: request.run_id, sessionId: 'custom-session' };
    const value = request.action === 'prepare' ? { ...common, inputDigest: 'custom-input', data: { digest: 'custom-input', holdoutMode: 'none' }, development: { rows: [{ observed: 1 }] }, contract: { candidateExample: { recipe: '...' }, instructions: 'Use any JSON recipe; no AST operators.' } }
      : request.action === 'candidate' ? { ...common, trialId: request.trial_id, candidate: request.candidate, candidateDigest: digest(request.candidate), metrics: { quality: 42 }, eligible: true, gate: 'custom gate', redundancy: [] }
        : request.action === 'select' ? { ...common, trialIds: request.trial_ids, selectionDigest: 'custom-selection' }
          : { ...common, selectionDigest: request.selection_digest, holdout: {}, holdoutStatus: 'not-requested', archive: { rows: [{ observed: 1 }] } };
    return { details: { ...value, receiptDigest: digest(value) } };
  } });
  f.host.toolsFor = toolsFor; f.main.tools = toolsFor(f.main);
  const args = input(); args.config.evaluator = { plugin_id: 'vendor/independent-evaluation', tool: 'custom_measure' }; delete args.dataset_id;
  const run = await f.runtime.create(f.main, args), result = await finished(f, run.id);
  assert.equal(result.status, 'completed', JSON.stringify(result.error));
  assert.deepEqual(calls, ['prepare', 'candidate', 'select', 'finalize']); assert.deepEqual(result.trials[0].metrics, { quality: 42 });
  assert.deepEqual(result.trials[0].candidate, { recipe: 'custom expression language' });
  assert.match(f.fileMap.get(result.report.path).content, /quality/); assert.ok(!JSON.stringify(result.trials[0].metrics).includes('invented'));
});

test('an explicit evaluator rejection allows the assigned Agent to correct a candidate', async () => {
  let corrected = false;
  const f = fixture({ onTask: async ({ request, child, runtime }) => {
    if (request.input.mode !== 'code') return;
    await assert.rejects(runtime.submit(child, request.input.runId, { candidate: { op: 'invalid' }, explanation: 'Rejected proposal' }), error => error.code === 'EVALUATION_REJECTED');
    corrected = true;
  } });
  const run = await f.runtime.create(f.main, input()), result = await finished(f, run.id);
  assert.equal(corrected, true); assert.equal(result.status, 'completed'); assert.equal(result.trials[0].status, 'accepted');
});

test('final evaluator retry preserves frozen selection and does not consume the research budget', async () => {
  const f = fixture({ onTask: ({ request }) => request.input.mode === 'finalize' ? 'hold' : undefined });
  const args = input(); args.config.maxTasks = 6;
  const run = await f.runtime.create(f.main, args); await poll(() => f.requests.some(request => request.input.mode === 'finalize'));
  const selection = f.runtime.get(run.id).selection; assert.ok(selection.digest);
  await f.runtime.control(f.main, run.id, 'pause'); assert.equal(f.fileWrites.length, 0);
  const g = fixture({ storage: f.db }); await g.runtime.control(g.main, run.id, 'resume');
  const result = await finished(g, run.id);
  assert.equal(result.status, 'completed'); assert.deepEqual(result.selection, selection);
  assert.deepEqual(g.requests.map(request => request.input.mode), ['finalize', 'report']);
  assert.equal(g.fileWrites.filter(path => path.endsWith('.html')).length, 1);
});

test('legacy records never resume with an implicit evaluator and retain existing report identity', async () => {
  const f = fixture(), run = await f.runtime.create(f.main, input()), done = await finished(f, run.id);
  const legacy = f.runtime.get(run.id); delete legacy.config.evaluator; f.runtime.save(legacy);
  assert.equal((await f.runtime.report(f.main, run.id)).fileId, done.report.fileId);
  const g = fixture(), paused = await g.runtime.create(g.main, input()); await g.runtime.control(g.main, paused.id, 'pause');
  const old = g.runtime.get(paused.id); delete old.config.evaluator; g.runtime.save(old);
  await assert.rejects(g.runtime.control(g.main, paused.id, 'resume'), error => error.code === 'EVALUATOR_REQUIRED');
  assert.equal(g.requests.length, 0);
});

test('plugin union is checked before evaluator preparation and again before task submission', async () => {
  const f = fixture(), original = f.host.plugins.inspect;
  f.host.plugins.inspect = id => id === 'sesame/factor-evaluator' ? original(id) : { id, version: '1.0.0', digest: id, state: 'discoverable', runtime_status: 'ready', agent_scope: 'all', tools: [], delegatable_tools: [] };
  const research = { plugins: Array.from({ length: 32 }, (_, i) => `arbitrary/skill-${i}`) };
  let prepareCalls = 0, loads = 0;
  const call = f.main.tools.call;
  f.main.tools.call = async request => { prepareCalls++; return call(request); };
  f.main.plugins.load = async () => { loads++; };
  const args = input(); args.config.research = research;
  await assert.rejects(f.runtime.create(f.main, args), error => error.code === 'PLUGIN_BUDGET_EXCEEDED');
  assert.equal(prepareCalls, 0); assert.equal(loads, 0); assert.equal(f.requests.length, 0);
  const run = await f.runtime.create(f.main, input()); await f.runtime.control(f.main, run.id, 'pause');
  f.runtime.update(run.id, { config: { ...f.runtime.get(run.id).config, research: resolveResearch(f.main, research) } });
  await assert.rejects(f.runtime.task(run.id, 'supervisor', 'plan', 'oversized', { round: 0 }, new AbortController().signal), error => error.code === 'PLUGIN_BUDGET_EXCEEDED');
  assert.equal(f.requests.length, 0);
});
