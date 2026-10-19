import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { digest } from '@sesame/plugin-sdk/protocol';
import { createCapabilities } from '../packages/investment-research/index.js';
import { PACKET_TYPE, publishPacket, readPacket, readRows } from '../packages/investment-research/src/artifacts.js';
import { ASK_CALL, COLLABORATION, REPORT_CALLS, ROLES } from '../packages/investment-research/src/team.js';
import { researchQuestion } from '../packages/investment-research/src/qa.js';

const clone = value => structuredClone(value);
function fixture({ reports = false, text = role => `## ${role}\nActual fixture findings; synthetic, not market evidence.` } = {}) {
  const f = { entries: new Map(), artifacts: new Map(), resources: new Map(), jobs: new Map(), history: new Map(), operations: new Map(), requests: [], events: [], checkpoints: [], models: [{ provider: 'fixture', id: 'model', configurationDigest: 'test-only' }], output: reports ? { type: 'report', space: 'research', path: 'fixture.html' } : { type: 'none' } };
  let sequence = 0;
  f.addPlugin = (id, capabilities) => f.entries.set(id, { id, state: 'mounted', runtime_status: 'ready', agent_scope: 'all', digest: digest(id), delegatable_tools: capabilities.map(cap => cap.id), capabilities });
  f.addPlugin('sesame/plugin-manager', [{ id: 'plugin_read', effects: [] }]);
  if (reports) {
    for (const id of new Set(REPORT_CALLS.map(call => call.pluginId))) f.addPlugin(id, REPORT_CALLS.filter(call => call.pluginId === id).map(call => ({ id: call.capabilityId, effects: [] })));
  }
  f.artifact = (kind, rows, content = {}) => {
    const ref = { id: `artifact_${++sequence}`, revision: `revision_${sequence}`, digest: digest(rows), kind, schemaVersion: '1.0.0' };
    f.artifacts.set(ref.id, { ref, rows, manifest: { kind, schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', rowCount: rows.length, provenance: { kind: 'demo' }, ...content }, dependencies: [] }, receipts: [] });
    return ref;
  };
  const resources = {
    create: async input => {
      const ref = { id: `resource_${++sequence}`, kind: input.kind, version: 1 };
      f.resources.set(ref.id, { input, ref }); return ref;
    },
    publish: async (root, manifest) => {
      const child = [...f.resources.values()].find(value => value.input.parent?.id === root.id && value.input.name === manifest.content.path);
      const rows = JSON.parse(child.input.source.content), ref = f.artifact(manifest.kind, rows, manifest.content);
      f.artifacts.get(ref.id).manifest = clone(manifest); return { ref, receipt: { status: 'published' } };
    },
    read: async (ref, options) => {
      const value = f.artifacts.get(ref.id);
      assert.ok(value, `Unknown artifact ${ref.id}`);
      assert.deepEqual(ref, value.ref, 'Read the exact frozen artifact revision');
      if (options.part === 'manifest') return clone(value.manifest);
      if (options.part === 'receipts') return { items: clone(value.receipts) };
      const bytes = Buffer.from(JSON.stringify(value.rows)), offset = options.offset ?? 0, chunk = bytes.subarray(offset, offset + Math.min(options.length ?? 256 * 1024, 4096));
      return { content: options.encoding === 'base64' ? chunk.toString('base64') : chunk.toString('utf8'), ...(offset + chunk.length < bytes.length ? { nextOffset: offset + chunk.length } : {}) };
    },
  };
  f.host = {
    context: { pluginId: 'sesame/investment-research', models: f.models }, resources,
    plugins: { read: async id => { const entry = f.entries.get(id); if (!entry) throw new Error(`Missing ${id}`); return clone(entry); } },
    capabilities: {
      list: async ({ pluginId }) => ({ items: (f.entries.get(pluginId)?.capabilities ?? []).map(cap => ({ ...cap, id: `${pluginId}#${cap.id}`, localId: cap.id, pluginId, kind: cap.kind ?? 'function', consumers: ['agent', 'host'] })) }),
      invoke: async (id, request, options) => {
        assert.equal(id, 'host.agent.run', 'The workflow never directly invokes a source or broker');
        const existing = f.operations.get(options.operationId);
        if (existing) {
          assert.deepEqual(request, existing.request, 'Uncertain admission retries keep their frozen request');
          return { type: 'run', run: existing.ref };
        }
        const role = request.input.role, ref = { id: `run_${role}_${++sequence}` }, job = { ref, id: ref.id, parentRunId: 'workflow_original', role, request: clone(request), task: clone(options.task), status: 'completed', output: { result: { text: text(role) } } };
        f.operations.set(options.operationId, job); f.jobs.set(ref.id, job); f.requests.push(job);
        if (role === 'manager' && options.task.output.type === 'report') {
          const report = f.artifact('report', [], { entry: 'index.html' });
          f.artifacts.get(report.id).receipts.push(f.inspection(report, 'rendered', 1));
          job.report = { id: 'bound_report', revision: 1, ref: report };
          f.workflow.report = clone(job.report);
        }
        await f.onInvoke?.(job);
        return { type: 'run', run: ref };
      },
    },
    runs: {
      list: async ({ parentRunId, capabilityId }) => ({ items: [...f.jobs.values()].filter(job => job.parentRunId === parentRunId && job.capabilityId === capabilityId).map(clone) }),
      read: async (ref, options = {}) => {
        const run = clone(ref.id === f.workflow.id ? f.workflow : f.jobs.get(ref.id));
        if (!options.include) return { run };
        const records = f.history.get(ref.id) ?? [], offset = options.cursor ? Number(options.cursor.slice(9)) : 0, limit = options.limit ?? 100;
        return { run, history: { items: clone(records.slice(offset, offset + limit)), ...(offset + limit < records.length ? { nextCursor: `sequence:${offset + limit}` } : {}) } };
      },
      wait: async ref => { const run = f.jobs.get(ref.id); await f.onWait?.(run); return { reason: run.status === 'interrupted' ? 'interrupted' : 'settled', run: clone(run) }; },
    },
  };
  f.workflow = { id: 'workflow_original', capabilityId: 'sesame/investment-research#investment_research_analyze', task: { output: f.output } };
  f.inspection = (artifact, status, observedAt) => ({ artifact, status, observedAt, renderer: { name: 'sesame-report-inspector' } });
  f.input = overrides => ({ title: 'Synthetic research', question: 'Compare independent evidence and state limitations.', subjects: ['FICTIONAL'], research: { plugins: [] }, model: { provider: 'fixture', id: 'model' }, ...overrides });
  f.run = async (input, mode = 'analyze') => {
    const handler = createCapabilities(f.host).find(cap => cap.name === `investment_research_${mode}`);
    return handler.execute(input, new AbortController().signal, {
      run: { id: 'workflow_original' }, task: { output: f.output }, checkpointState: clone(f.state ?? null),
      checkpoint: async state => { f.state = clone(state); f.checkpoints.push(clone(state)); },
      emit: (type, value) => f.events.push({ type, value: clone(value) }),
      interrupt: ({ reason, state, requirements }) => { f.state = clone(state); throw Object.assign(new Error(reason), { code: 'RUN_INTERRUPTED', requirements }); },
    });
  };
  return f;
}

test('eight roles research without any account or report dependencies; fixed packet retains full Markdown and references', async () => {
  const f = fixture(), source = f.artifact('data', [{ x: 1, fixture: true }]);
  const result = await f.run(f.input({ evidence_refs: [source], as_of: '2026-10-18T00:00:00Z', horizon: 'One month' }));
  assert.deepEqual(f.requests.map(job => job.role), ROLES);
  assert.ok(f.requests.every(job => job.task.agentId === job.role && job.task.output.type === 'none'));
  for (const job of f.requests) assert.deepEqual(job.request.allowedCalls, ['bull', 'bear', 'risk', 'manager'].includes(job.role) ? [ASK_CALL] : []);
  const packet = await readPacket(f.host, result.result_ref);
  assert.equal(packet.members.length, 8); assert.equal(packet.as_of, '2026-10-18T00:00:00Z');
  assert.deepEqual(packet.source_refs, [source]); assert.equal(packet.horizon, 'One month');
  assert.deepEqual(packet.members.map(member => member.markdown), f.requests.map(job => job.output.result.text));
  assert.equal(result.report_ref, undefined);
  assert.equal(f.artifacts.get(result.result_ref.id).manifest.content.provenance.kind, 'demo');
  assert.equal(f.requests.find(job => job.role === 'bear').request.input.research.members.length, 5);
});

test('declared trading/process writes are excluded, explicit writes pause before any member; knowledge remains available', async () => {
  const f = fixture();
  f.addPlugin('custom/source', [{ id: 'query', effects: ['network', 'resources.publish'] }, { id: 'trade', effects: ['external-trading'] }, { id: 'command', effects: ['process.exec'] }]);
  const input = f.input({ research: { plugins: ['custom/source'], tools: ['trade'] } });
  await assert.rejects(f.run(input), error => error.code === 'RUN_INTERRUPTED' && /trading/.test(error.message));
  assert.equal(f.requests.length, 0);
  const g = fixture(); g.addPlugin('custom/source', f.entries.get('custom/source').capabilities);
  await g.run(g.input({ research: { plugins: ['custom/source'] } }));
  assert.deepEqual(g.requests[0].request.allowedCalls.map(call => call.capabilityId), ['query', 'plugin_read']);
  assert.deepEqual(g.requests.at(-1).request.allowedCalls.map(call => call.capabilityId), ['plugin_read', ASK_CALL.capabilityId], 'Synthesis asks original analysts instead of directly fetching');
  assert.ok(g.requests.every(job => job.request.plugins.includes('custom/source')));
});

test('complete tool data references survive prose-only final answers and paginated resource history', async () => {
  const f = fixture(), first = f.artifact('data', [{ source: 'original', fixture: true }]), second = f.artifact('data', [{ calculation: 42, fixture: true }]);
  f.onInvoke = job => {
    if (job.role === 'market') f.history.set(job.id, [
      ...Array.from({ length: 200 }, () => ({ type: 'artifact', data: { ref: first } })),
      { type: 'artifact', data: { ref: second } },
    ]);
  };
  const result = await f.run(f.input()), packet = await readPacket(f.host, result.result_ref);
  assert.deepEqual(packet.members.find(member => member.role === 'market').source_refs, [first, second]);
  assert.deepEqual(packet.source_refs, [first, second]);
  assert.ok(!packet.members[0].markdown.includes('sha256:'), 'Citation transport does not impose JSON copying on the Agent');
  assert.deepEqual(f.requests.find(job => job.role === 'bull').request.input.research.source_refs, [first, second]);
  assert.deepEqual(packet.members.find(member => member.role === 'news').source_refs, [], 'Other members do not inherit false source authorship');
});

test('suffix rerun retains only the completed prefix and its QA, inheriting the original research question', async () => {
  for (const role of ['risk', 'manager']) {
    const f = fixture(), seed = f.artifact('data', [{ seed: true }]), earlier = f.artifact('data', [{ earlier: true }]), later = f.artifact('data', [{ later: true }]);
    const members = ROLES.map(value => ({ role: value, markdown: `Original ${value}`, run_ref: { id: `original_${value}` }, source_refs: [] }));
    const qa = [{ from: 'bull', to: 'fundamentals', markdown: 'Earlier QA', qa_run_ref: { id: 'earlier_qa' }, run_ref: { id: 'earlier_answer' }, source_refs: [earlier] },
      { from: 'manager', to: 'fundamentals', markdown: 'Later QA must not leak backward', qa_run_ref: { id: 'later_qa' }, run_ref: { id: 'later_answer' }, source_refs: [later] }];
    const original = { schemaVersion: '1.0.0', type: PACKET_TYPE, status: 'complete', title: 'Original question', question: 'Original research question?', subjects: ['FICTIONAL'], as_of: '2026-10-18T00:00:00Z', horizon: 'Original horizon', members, qa, summary: 'Old manager', source_refs: [seed, earlier, later] };
    const resultRef = f.artifact('data', [original]), before = clone(original);
    const input = { start_from: { result_ref: resultRef, role }, research: { plugins: [] }, model: { provider: 'fixture', id: 'model' } };
    let interrupted = false;
    f.onInvoke = job => { if (!interrupted) { interrupted = true; job.status = 'interrupted'; } };
    await assert.rejects(f.run(input), { code: 'RUN_INTERRUPTED' });
    f.requests[0].status = 'completed';
    const result = await f.run(input), packet = await readPacket(f.host, result.result_ref);
    const prefix = members.slice(0, ROLES.indexOf(role));
    assert.deepEqual(f.requests.map(job => job.role), ROLES.slice(ROLES.indexOf(role)), 'Only the requested suffix executes; resume reuses its accepted first job');
    assert.deepEqual(packet.members.slice(0, prefix.length), prefix);
    assert.deepEqual(f.requests[0].request.input.research.members, prefix);
    assert.equal(f.requests[0].request.input.research.start_from, undefined, 'The original full packet is provenance of the final result, not an input containing later conclusions');
    assert.deepEqual(packet.qa, [qa[0]]);
    assert.deepEqual(packet.source_refs, [seed, earlier]);
    assert.deepEqual(packet.evidence_refs, [seed]);
    assert.deepEqual(packet.start_from, input.start_from);
    assert.equal(packet.question, original.question);
    assert.equal(packet.as_of, original.as_of);
    assert.equal(packet.horizon, original.horizon);
    assert.ok(f.requests.every(job => job.request.input.qa_context?.selection));
    assert.ok(f.events.filter(event => event.type === 'handoff').every(event => f.jobs.has(event.value.fromRunId)), 'Reused prefix Runs belong to the original workflow, not new live handoffs');
    assert.deepEqual(await readPacket(f.host, resultRef), before, 'Old report and completed packet remain immutable');
  }
});

test('identical frozen handoffs in different reruns have distinct resource roots', async () => {
  const f = fixture(), roots = new Set(), create = f.host.resources.create;
  f.host.resources.create = async (...args) => {
    const [input] = args;
    if (!input.parent) {
      assert.ok(!roots.has(input.name), 'The host rejects duplicate durable resource names across operations');
      roots.add(input.name);
    }
    return create(...args);
  };
  const packet = { type: PACKET_TYPE, schemaVersion: '1.0.0', status: 'complete', title: 'Same prefix', question: 'Same question', subjects: ['FICTIONAL'], members: [], summary: '', source_refs: [] };
  const first = await publishPacket(f.host, packet, 'first-workflow:handoff:manager');
  const second = await publishPacket(f.host, packet, 'second-workflow:handoff:manager');
  assert.deepEqual(await readPacket(f.host, first), await readPacket(f.host, second));
  assert.notEqual(first.id, second.id);
});

test('missing selected model pauses before research and resumes the original checkpoint after configuration is repaired', async () => {
  const f = fixture(), input = f.input({ model: { provider: 'fixture', id: 'missing' } });
  await assert.rejects(f.run(input), { code: 'RUN_INTERRUPTED' }); assert.equal(f.requests.length, 0);
  f.models.push({ provider: 'fixture', id: 'missing', configurationDigest: 'repaired' });
  const result = await f.run(input);
  assert.equal((await readPacket(f.host, result.result_ref)).members.length, 8);
});

test('interrupted research rejoins the original member Run, preserving completed members and the same root', async () => {
  const f = fixture(), input = f.input();
  f.onInvoke = job => { if (job.role === 'news') { job.status = 'interrupted'; job.interrupts = [{ reason: 'Source credential missing.' }]; } };
  await assert.rejects(f.run(input), { code: 'RUN_INTERRUPTED' });
  await new Promise(resolve => setImmediate(resolve));
  const original = f.requests.find(job => job.role === 'news').ref;
  const retained = clone(f.state.members);
  f.jobs.get(original.id).status = 'completed'; f.onInvoke = null;
  const result = await f.run(input), packet = await readPacket(f.host, result.result_ref);
  assert.equal(f.requests.length, 8);
  assert.deepEqual(packet.members.find(member => member.role === 'news').run_ref, original);
  for (const [role, value] of Object.entries(retained)) assert.deepEqual(packet.members.find(member => member.role === role), value);
  assert.ok([...f.operations.keys()].every(id => id.startsWith('workflow_original:')));
});

test('uncertain child acceptance retries the same request and operation ID, without a second paid Agent', async () => {
  const f = fixture(), input = f.input(); let dropped = false;
  f.onInvoke = job => { if (job.role === 'news' && !dropped) { dropped = true; throw Object.assign(new Error('Reply lost after acceptance'), { code: 'CONNECTION_LOST' }); } };
  await assert.rejects(f.run(input), { code: 'RUN_INTERRUPTED' });
  await new Promise(resolve => setImmediate(resolve));
  await f.run(input);
  assert.equal(f.requests.length, 8); assert.equal(f.requests.filter(job => job.role === 'news').length, 1);
});

test('question interruption and uncertain acceptance retain the exact analyst request and do not repeat accepted work', async () => {
  for (const failure of ['interruption', 'lost-acceptance']) {
    const f = fixture();
    await f.run(f.input());
    const bull = f.requests.find(job => job.role === 'bull'), input = { analyst: 'fundamentals', question: 'Which observation distinguishes the two cash-flow explanations?' };
    let checkpoint;
    const ask = () => researchQuestion(f.host, input, new AbortController().signal, {
      run: { id: 'question_original' }, checkpointState: clone(checkpoint),
      provenance: { parentRunId: bull.id, agent: { runId: bull.id, input: bull.request.input } },
      checkpoint: async value => { checkpoint = clone(value); },
      interrupt: ({ reason, state }) => { checkpoint = clone(state); throw Object.assign(new Error(reason), { code: 'RUN_INTERRUPTED' }); },
    });
    f.onInvoke = job => {
      assert.equal(job.request.input.qa.question, input.question);
      assert.equal(job.task.agentId, 'fundamentals');
      assert.equal(job.task.stage, 'qa');
      assert.deepEqual(job.request.allowedCalls, [], 'Answering analysts cannot recursively dispatch questions');
      if (failure === 'lost-acceptance') throw new Error('Acceptance response lost');
      job.status = 'interrupted'; job.interrupts = [{ reason: 'A required data credential is temporarily missing.' }];
    };
    await assert.rejects(ask(), { code: 'RUN_INTERRUPTED' });
    const original = f.requests.at(-1), request = clone(checkpoint.request);
    original.status = 'completed'; f.onInvoke = null;
    const answer = await ask();
    assert.equal(f.requests.length, 9, 'Resume joins the accepted analyst instead of creating a duplicate');
    assert.deepEqual(checkpoint.request, request);
    assert.equal(answer.from, 'bull'); assert.equal(answer.to, 'fundamentals');
    assert.deepEqual(answer.run_ref, original.ref);
    assert.deepEqual(await ask(), answer, 'A completed answer is retained');
    assert.equal(f.requests.length, 9);
  }
});

test('parent waits for accepted unanswered questions and passes full answers and evidence to later roles', async () => {
  const f = fixture(), source = f.artifact('data', [{ fixture: true, corroboratingObservation: 7 }]);
  f.onInvoke = job => {
    if (job.role === 'bull') f.jobs.set('question_pending', {
      id: 'question_pending', parentRunId: job.id, capabilityId: 'sesame/investment-research#investment_research_ask', status: 'running', createdAt: '2026-10-18T00:00:00Z',
      output: { from: 'bull', to: 'fundamentals', question: 'Is the cash-flow effect independent?', markdown: '## Answer\nNew corroboration with a remaining counterexample.', run_ref: { id: 'answer_original' }, source_refs: [source] },
    });
    if (['bear', 'risk', 'manager'].includes(job.role)) {
      assert.equal(job.request.input.research.qa.length, 1);
      assert.match(job.request.input.research.qa[0].markdown, /remaining counterexample/);
      assert.deepEqual(job.request.input.research.source_refs, [source]);
    }
  };
  f.onWait = job => { if (job.id === 'question_pending') job.status = 'completed'; };
  const result = await f.run(f.input()), packet = await readPacket(f.host, result.result_ref);
  assert.equal(packet.members.length, 8); assert.equal(packet.qa.length, 1);
  assert.deepEqual(packet.qa[0].qa_run_ref, { id: 'question_pending' });
  assert.deepEqual(packet.source_refs, [source]);
  assert.equal(f.requests.filter(job => job.role === 'manager').length, 1);
});

test('only manager gets reports and parent output; report artifact is adopted without replacing its bytes', async () => {
  const f = fixture({ reports: true }), result = await f.run(f.input());
  const manager = f.requests.at(-1);
  assert.deepEqual(manager.request.allowedCalls, [...REPORT_CALLS, ASK_CALL]);
  assert.deepEqual(manager.task.output, { type: 'report', target: 'parent' });
  assert.ok(f.requests.slice(0, -1).every(job => !job.request.plugins.includes('sesame/reports')));
  assert.deepEqual(result.report_ref, manager.report.ref);
  assert.equal([...f.artifacts.values()].filter(value => value.ref.kind === 'report').length, 1);
  assert.deepEqual((await readPacket(f.host, result.result_ref)).report_ref, manager.report.ref);
});

test('failed latest render check interrupts but fixing the same receipt does not restart completed manager', async () => {
  const f = fixture({ reports: true }), input = f.input();
  f.onInvoke = job => { if (job.role === 'manager') f.artifacts.get(job.report.ref.id).receipts.push(f.inspection(job.report.ref, 'failed', 2)); };
  await assert.rejects(f.run(input), error => error.code === 'RUN_INTERRUPTED' && /report_check/.test(error.message));
  const manager = f.requests.at(-1); f.artifacts.get(manager.report.ref.id).receipts.push(f.inspection(manager.report.ref, 'rendered', 3));
  const result = await f.run(input);
  assert.equal(f.requests.length, 8); assert.deepEqual(result.report_ref, manager.report.ref);
});

test('browser rendering cannot replace a missing or failed exact-revision report inspection', async () => {
  for (const checked of [false, true]) {
    const f = fixture({ reports: true }), input = f.input();
    f.onInvoke = job => {
      if (job.role !== 'manager') return;
      const artifact = f.artifacts.get(job.report.ref.id);
      artifact.receipts = checked ? [f.inspection(job.report.ref, 'failed', 2)] : [];
      artifact.receipts.push({ artifact: job.report.ref, status: 'rendered', observedAt: 3, renderer: { name: 'sesame-report' } });
      artifact.receipts.push(f.inspection({ ...job.report.ref, revision: 'another_revision' }, 'rendered', 4));
    };
    await assert.rejects(f.run(input), error => error.code === 'RUN_INTERRUPTED' && /report_check/.test(error.message));
    assert.equal(f.state.reportRef, undefined);
  }
});

test('a repaired parent report revision resumes the same workflow without a second manager or report binding', async () => {
  const f = fixture({ reports: true }), input = f.input();
  f.onInvoke = job => { if (job.role === 'manager') f.artifacts.get(job.report.ref.id).receipts.push(f.inspection(job.report.ref, 'failed', 2)); };
  await assert.rejects(f.run(input), { code: 'RUN_INTERRUPTED' });
  const manager = f.requests.at(-1), original = clone(manager.report.ref), artifact = f.artifacts.get(original.id);
  const repaired = { ...original, revision: 'repaired_revision', digest: digest('corrected report HTML') };
  artifact.ref = repaired; artifact.receipts = [f.inspection(repaired, 'rendered', 3)];
  f.workflow.report = { ...f.workflow.report, revision: 2, ref: repaired };
  const result = await f.run(input);
  assert.equal(f.requests.length, 8); assert.deepEqual(manager.report.ref, original);
  assert.equal(f.workflow.report.id, manager.report.id); assert.deepEqual(result.report_ref, repaired);
  assert.deepEqual((await readPacket(f.host, result.result_ref)).report_ref, repaired);
});

test('report-only consumes a complete original packet without source plugins, account or analyst dispatch', async () => {
  const f = fixture({ reports: true }), source = f.artifact('data', [{ nativeValue: 6.243, fixture: true }]);
  const packet = { schemaVersion: '1.0.0', type: PACKET_TYPE, status: 'complete', title: 'Retained research', question: 'Explain the corrected fixed measure.', subjects: ['FICTIONAL'], as_of: '2026-10-18T00:00:00Z',
    members: [{ role: 'market', markdown: 'Full original research with corrected measure.', run_ref: { id: 'original_market' }, source_refs: [source] }], summary: 'Original manager judgment.', source_refs: [source] };
  const ref = await publishPacket(f.host, packet, 'test-original');
  const result = await f.run({ result_ref: ref, model: { provider: 'fixture', id: 'model' } }, 'report');
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].role, 'manager'); assert.equal(f.requests[0].task.agentId, undefined);
  assert.deepEqual(f.requests[0].request.allowedCalls, REPORT_CALLS); assert.deepEqual(result.result_ref, ref);
  assert.equal(f.requests[0].request.input.qa_context, undefined);
  assert.doesNotMatch(f.requests[0].request.instructions, /investment_research_ask/);
  assert.match(f.requests[0].request.instructions, /仅重写报告/);
  assert.deepEqual(await readPacket(f.host, ref), packet, 'Presentation does not rewrite original research');
});

test('large complete handoffs use a fixed data reference, never a silently truncated summary', async () => {
  const f = fixture({ text: role => `## ${role}\n${'中文完整证据。'.repeat(12000)}` });
  const result = await f.run(f.input()), managerInput = f.requests.at(-1).request.input;
  assert.ok(managerInput.context_ref); assert.equal(managerInput.research, undefined);
  const [handoff] = await readRows(f.host, managerInput.context_ref);
  assert.equal(handoff.members.length, 7); assert.ok(handoff.members.every(member => member.markdown.endsWith('中文完整证据。')));
  const packet = await readPacket(f.host, result.result_ref);
  assert.equal(packet.members.length, 8); assert.equal(packet.members[0].markdown.length, f.requests[0].output.result.text.length);
});

test('two public workflows and one scoped question function declare collaboration without duplicate Run controls', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/investment-research/capabilities.json', import.meta.url)));
  assert.deepEqual(manifest.capabilities.map(cap => cap.id), ['investment_research_analyze', 'investment_research_report', 'investment_research_ask']);
  assert.ok(manifest.capabilities.every(cap => cap.resumable && cap.execution === 'run'));
  assert.ok(manifest.capabilities.slice(0, 2).every(cap => cap.kind === 'workflow'));
  assert.equal(manifest.capabilities[2].kind, 'function');
  assert.deepEqual(manifest.capabilities[0].collaboration, COLLABORATION);
  assert.equal(manifest.capabilities[1].collaboration, undefined);
  for (const cap of manifest.capabilities) for (const field of ['execution', 'backend', 'account', 'interval_minutes', 'report']) assert.equal(cap.inputSchema.properties[field], undefined);
});
