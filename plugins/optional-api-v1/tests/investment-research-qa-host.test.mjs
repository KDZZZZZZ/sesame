// Real installer, host Agent transport and Run/resource records; the model and all evidence are local fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const packageRoot = fileURLToPath(new URL('../packages/investment-research/', import.meta.url));
const pluginId = 'sesame/investment-research';
const capabilityId = `${pluginId}#investment_research_ask`;
const questionOne = 'What observation distinguishes cash conversion from an accounting-only profit increase?';
const answerOne = '## First clarification\nThe fixed sample reports 42 cash units against 60 profit units. This does not yet identify the timing mechanism.';
const questionTwo = `Following your answer: ${answerOne}\nDoes the second sample support the timing explanation, and what would disprove it?`;
const answerTwo = '## Follow-up clarification\nThe fixed later sample reports 58 cash units. Timing is consistent with both samples, not proven causal; persistent receivables growth would challenge it.';
const text = content => typeof content === 'string' ? content : (content ?? []).map(part => part.text ?? '').join('');

function inputOf(body) {
  for (const message of body.messages.filter(message => message.role === 'user').toReversed()) {
    const value = text(message.content), index = value.lastIndexOf('\n\nInput JSON:\n');
    if (index >= 0) return JSON.parse(value.slice(index + '\n\nInput JSON:\n'.length));
  }
  return null;
}
function returned(body, id) {
  const message = body.messages.findLast(message => message.role === 'tool' && message.tool_call_id === id);
  return message ? JSON.parse(text(message.content)) : undefined;
}
function reply(response, model, content, call) {
  const chunk = (delta, finish_reason) => JSON.stringify({ id: 'research-qa-fixture', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason }] });
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { role: 'assistant', content };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, call ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
}
async function installedFixture(responseHandler, extraPackages = []) {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { fixture } = await load('tests/fixture-provider.js');
  const { createHostContextV2 } = await load('modules/plugins/host-v2/context.js');
  const { validateCapabilityManifest } = await load('modules/plugins/capability-contract.js');
  const definition = JSON.parse(await readFile(join(packageRoot, 'capabilities.json'), 'utf8'));
  const checked = await validateCapabilityManifest(definition, { pluginId });
  assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics));
  const declared = definition.capabilities.find(item => item.id === 'investment_research_ask');
  assert.ok(declared, 'The QA capability must be explicitly registered, not an unadvertised Agent behavior');
  assert.equal(declared.kind, 'function');
  assert.equal(declared.execution, 'run');
  assert.equal(declared.resumable, true);
  const app = await fixture({ responseHandler });
  try {
    for (const name of ['investment-research', ...extraPackages]) {
      const draft = join(app.runtime.workspaces.root('conv_main'), `${name}-qa-draft`);
      await cp(fileURLToPath(new URL(`../packages/${name}/`, import.meta.url)), draft, { recursive: true });
      const verified = await app.runtime.plugins.manager.test('conv_main', { path: draft });
      assert.equal(verified.passed, true, JSON.stringify(verified));
      const installed = await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: verified.digest });
      assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
    }
    const host = createHostContextV2(app.runtime, app.runtime.capabilities.hostEntry, 'conv_main');
    const catalog = await host.capabilities.list({ pluginId });
    assert.ok(catalog.items.some(item => item.id === capabilityId));
    return { app, host };
  } catch (error) { await app.dispose(); throw error; }
}
async function settled(host, ref) {
  for (;;) {
    const result = await host.runs.wait(ref, { until: 'settled', timeoutMs: 10000 });
    if (result.reason !== 'timeout') return result.run;
  }
}

test('a report-bound custom synthesizer can ask its selected source analyst without gaining source calls', { skip: !hostRoot, timeout: 120000 }, async () => {
  const failures=[];let receivedAnswer=false;
  const {app,host}=await installedFixture((body,response)=>{
    try {
      const input=inputOf(body),names=body.tools?.map(tool=>tool.function.name)??[];
      if(!input?.role){reply(response,body.model,'Local fixture ready.');return true;}
      if(input.role==='facts') {
        assert.ok(names.includes('sources_fetch'));
        assert.equal(names.includes('investment_research_ask'),false);
        reply(response,body.model,input.qa?'Fixed source scope verified by the original analyst.':'Initial fictional source observation.');
      } else {
        assert.equal(input.role,'editor');assert.ok(names.includes('report_publish'));assert.equal(names.includes('sources_fetch'),false);
        const accepted=returned(body,'report_source_ask');
        if(!accepted){reply(response,body.model,null,{id:'report_source_ask',name:'investment_research_ask',arguments:{analyst:'facts',question:'Verify the exact source scope before writing the report.'}});return true;}
        assert.equal(accepted.type,'run');
        const waited=returned(body,'report_source_wait');
        if(!waited){reply(response,body.model,null,{id:'report_source_wait',name:'host_runs_wait',arguments:{runId:accepted.run.id,until:'settled',timeoutMs:10000}});return true;}
        assert.equal(waited.run.status,'completed',JSON.stringify(waited));assert.match(waited.run.output.markdown,/source scope verified/);receivedAnswer=true;
        // This boundary test stops before report authoring. Exact publication and
        // rendering remain covered by the report artifact contract tests.
        reply(response,body.model,null,{id:'report_qa_boundary_verified',name:'host_runs_interrupt',arguments:{reason:'Fixture stops after verifying report-bound QA permissions.'}});
      }
      return true;
    } catch(error){failures.push(error.message);reply(response,body.model,`Fixture assertion failed: ${error.message}`);return true;}
  },['web-sources']);
  try {
    const accepted=await host.capabilities.invoke(`${pluginId}#investment_research_analyze`,{
      title:'Report-bound source QA fixture',question:'Verify source reuse with the actual report-bound Agent permissions.',subjects:['FICTIONAL'],
      model:{provider:'fixture',id:'fixture'},research:{plugins:['sesame/web-sources'],tools:['sesame/web-sources#sources_fetch']},
      workflow:{stages:[[{id:'facts',role:'fundamentals'}],[{id:'editor',role:'manager'}]],synthesis:'editor'},
    },{operationId:'report-source-qa-boundary',task:{output:{type:'report',space:'research',path:'qa-boundary.html'}}});
    const done=await settled(host,accepted.run);
    assert.deepEqual(failures,[]);assert.equal(receivedAnswer,true,JSON.stringify({status:done.status,error:done.error,interrupts:done.interrupts,children:app.runtime.runs.descendants(done.id).map(run=>({kind:run.kind,status:run.status,role:run.task?.role,error:run.error}))}));assert.equal(done.status,'interrupted');
    const descendants=app.runtime.runs.descendants(done.id),qa=descendants.find(run=>run.capabilityId===capabilityId);
    assert.equal(qa.status,'completed');assert.equal(qa.output.to,'facts');
    assert.equal(descendants.filter(run=>run.kind==='agent').length,3);
    assert.equal(done.output?.report_ref,undefined);
  } finally {await app.dispose();}
});
function publishSample(app, round) {
  return app.runtime.contractArtifacts.publish({ id: 'fixture/research-qa-evidence', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` }, {
    operationId: `qa-sample-${round}`, manifest: {
      kind: 'data', schemaVersion: '1.0.0', dependencies: [],
      content: { format: 'json-rows', path: 'rows.json', rowCount: 1, columns: ['round', 'cash', 'profit'], provenance: { kind: 'demo' } },
      blobs: [{ ...app.runtime.contractArtifacts.blob(JSON.stringify([{ round, cash: round === 1 ? 42 : 58, profit: 60 }])), path: 'rows.json', mediaType: 'application/json' }],
    },
  });
}

test('bull can ask two evidence-bearing questions through actual Agent tools without adding collaboration members', { skip: !hostRoot, timeout: 120000 }, async t => {
  const observations = new Map(), failures = [], answersSeenByBull = [];
  let sources;
  const { app, host } = await installedFixture((body, response) => {
    try {
      const input = inputOf(body);
      if (!input?.role) { reply(response, body.model, 'Local fixture ready.'); return true; }
      const key = input.qa ? `${input.role}:${input.qa.question}` : input.role;
      if (!observations.has(key)) observations.set(key, input);
      const names = body.tools?.map(tool => tool.function.name) ?? [];
      assert.equal(names.includes('investment_research_ask'), ['bull', 'bear', 'risk', 'manager'].includes(input.role), `${key}: QA is granted to downstream research members, never answering analysts`);
      assert.ok(names.every(name => !/(trade|execution|manual_|trading_)/.test(name)));

      if (input.qa) {
        assert.equal(input.role, 'fundamentals');
        assert.equal(input.qa.from, 'bull');
        assert.ok(Array.isArray(input.research.members), 'The answering analyst receives the complete research packet');
        assert.equal(input.research.members.length, 4);
        const round = input.qa.question === questionOne ? 1 : 2;
        assert.equal(input.qa.question, round === 1 ? questionOne : questionTwo);
        if (round === 2) {
          assert.equal(input.research.qa.length, 1, 'A follow-up includes the preceding clarification');
          assert.equal(input.research.qa[0].markdown, answerOne);
          assert.ok(input.research.source_refs.some(ref => ref.id === sources[0].id));
        }
        const readId = `qa_source_${round}`;
        if (!returned(body, readId)) reply(response, body.model, null, {
          id: readId, name: 'host_resources_read', arguments: { ref: sources[round - 1], part: 'content', entry: 'rows.json' },
        });
        else reply(response, body.model, round === 1 ? answerOne : answerTwo);
      } else if (input.role === 'bull') {
        for (const round of [1, 2]) {
          const accepted = returned(body, `qa_ask_${round}`);
          if (!accepted) {
            if (round === 2) assert.equal(answersSeenByBull[0], answerOne, 'The second question is issued only after reading the first answer');
            reply(response, body.model, null, { id: `qa_ask_${round}`, name: 'investment_research_ask', arguments: { analyst: 'fundamentals', question: round === 1 ? questionOne : questionTwo } });
            return true;
          }
          assert.equal(accepted.type, 'run');
          assert.ok(accepted.run.id);
          const waited = returned(body, `qa_wait_${round}`);
          if (!waited) {
            reply(response, body.model, null, { id: `qa_wait_${round}`, name: 'host_runs_wait', arguments: { runId: accepted.run.id, until: 'settled', timeoutMs: 10000 } });
            return true;
          }
          assert.equal(waited.run.status, 'completed', JSON.stringify(waited));
          assert.equal(waited.run.output.from, 'bull');
          assert.equal(waited.run.output.to, 'fundamentals');
          assert.equal(waited.run.output.question, round === 1 ? questionOne : questionTwo);
          assert.equal(waited.run.output.markdown, round === 1 ? answerOne : answerTwo);
          assert.deepEqual(waited.run.output.source_refs, [sources[round - 1]]);
          answersSeenByBull[round - 1] = waited.run.output.markdown;
        }
        reply(response, body.model, '## Bull\nAfter two clarifications, improving conversion is consistent with timing, but insufficient to prove the mechanism.');
      } else {
        if (['bear', 'risk', 'manager'].includes(input.role)) {
          assert.deepEqual(input.research.qa.map(item => item.markdown), [answerOne, answerTwo]);
          assert.deepEqual(new Set(input.research.source_refs.map(ref => ref.id)), new Set(sources.map(ref => ref.id)));
        }
        reply(response, body.model, `## ${input.role}\nSynthetic research only. ${input.role === 'manager' ? 'Both clarifications and their uncertainty inform the conclusion.' : 'No new sample was acquired in this initial response.'}`);
      }
      return true;
    } catch (error) {
      failures.push(error);
      reply(response, body.model, `Fixture assertion failed: ${error.message}`);
      return true;
    }
  });
  try {
    sources = [publishSample(app, 1), publishSample(app, 2)];
    const accepted = await host.capabilities.invoke(`${pluginId}#investment_research_analyze`, {
      title: 'Synthetic causal QA', question: 'Test targeted evidence clarification; every datum is fictional.', subjects: ['FICTIONAL'],
      model: { provider: 'fixture', id: 'fixture' }, research: { plugins: [] },
    }, { operationId: 'research-qa-host-fixture', task: { output: { type: 'none' } } });
    assert.equal(accepted.type, 'run');
    const done = await settled(host, accepted.run);
    assert.deepEqual(failures.map(error => error.message), []);
    assert.equal(done.status, 'completed', JSON.stringify({ error: done.error, interrupts: done.interrupts }));
    assert.equal(done.kind, 'workflow');
    assert.equal(done.task.collaboration.agents.length, 8);

    const descendants = app.runtime.runs.descendants(done.id);
    const agents = descendants.filter(run => run.kind === 'agent');
    assert.equal(agents.length, 10, 'Eight original members plus two targeted analyst responses');
    assert.equal(agents.filter(run => run.task.agentId === 'fundamentals').length, 3);
    assert.equal(agents.filter(run => run.task.stage === 'qa').length, 2);
    assert.ok(agents.filter(run => run.task.stage === 'qa').every(run => run.task.agentId === 'fundamentals'));
    assert.ok(descendants.every(run => !run.task?.collaboration), 'The QA function and reply Runs do not create nested collaboration graphs');
    assert.equal(new Set(agents.map(run => run.task.agentId)).size, 8);

    const { readPacket } = await import('../packages/investment-research/src/artifacts.js');
    const packet = await readPacket(host, done.output.result_ref);
    assert.equal(packet.members.length, 8);
    assert.equal(packet.members.at(-1).role, 'manager');
    assert.deepEqual(packet.qa.map(item => item.markdown), [answerOne, answerTwo]);
    assert.deepEqual(packet.qa.map(item => item.question), [questionOne, questionTwo]);
    for (let index = 0; index < packet.qa.length; index++) {
      const qa = packet.qa[index];
      assert.equal(qa.from, 'bull'); assert.equal(qa.to, 'fundamentals');
      assert.deepEqual(qa.source_refs, [sources[index]]);
      const replyRun = app.runtime.runs.read(qa.run_ref.id);
      const qaRun = app.runtime.runs.read(qa.qa_run_ref.id);
      assert.equal(replyRun.kind, 'agent');
      assert.equal(replyRun.task.agentId, 'fundamentals');
      assert.equal(replyRun.task.stage, 'qa');
      assert.equal(qaRun.capabilityId, capabilityId);
      assert.equal(qaRun.status, 'completed');
      assert.equal(qaRun.output.markdown, qa.markdown);
    }
    assert.deepEqual(new Set(packet.source_refs.map(ref => ref.id)), new Set(sources.map(ref => ref.id)), 'Tool-read QA evidence survives even without ArtifactRef JSON in the answer prose');
    const resultManifest = await host.resources.read(done.output.result_ref, { part: 'manifest' });
    assert.ok(sources.every(source => resultManifest.dependencies.some(ref => ref.id === source.id)), 'The published research artifact retains QA data lineage');
    assert.deepEqual(answersSeenByBull, [answerOne, answerTwo]);
    assert.equal(observations.size, 10);
    assert.equal(done.output.report_ref, undefined);
    t.diagnostic(JSON.stringify({ transport: 'local-SSE', actualInstaller: true, originalMembers: 8, answerRuns: 2, qaEvidenceArtifacts: 2, accountOrBrokerCalls: 0 }));
  } finally { await app.dispose(); }
});

test('QA invoked outside its research team is rejected before any analyst starts', { skip: !hostRoot, timeout: 120000 }, async () => {
  const agentInputs = [];
  const { app, host } = await installedFixture((body, response) => {
    const input = inputOf(body);
    if (input?.role) agentInputs.push(input);
    reply(response, body.model, 'Local fixture ready.');
    return true;
  });
  try {
    let rejection;
    try {
      const accepted = await host.capabilities.invoke(capabilityId, { analyst: 'fundamentals', question: questionOne }, { operationId: 'outside-team-qa' });
      assert.equal(accepted.type, 'run');
      const run = await settled(host, accepted.run);
      assert.equal(run.status, 'interrupted', JSON.stringify(run));
      rejection = run.error ?? run.interrupts?.find(item => !item.resolvedAt);
      assert.deepEqual(app.runtime.runs.descendants(run.id).filter(child => child.kind === 'agent'), []);
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') throw error;
      rejection = error;
    }
    assert.ok(rejection, 'A context-free QA call must be rejected');
    assert.equal(rejection.code ?? rejection.requirements?.find(item => item.available === false)?.id, 'QA_CONTEXT_REQUIRED');
    assert.deepEqual(agentInputs, []);
    assert.deepEqual(app.store.list('plugin_agent_task'), []);
  } finally { await app.dispose(); }
});

test('risk and a source-free manager ask original analysts for new evidence and retain both answers in the final packet', { skip: !hostRoot, timeout: 120000 }, async t => {
  const failures = [], sourceRequests = [], questions = new Map(), sources = new Map(), answersSeen = new Map();
  const cases = {
    risk: { analyst: 'news', question: 'Does the synthetic policy announcement change the cash constraint?', answer: '## Risk clarification\nThe synthetic policy sample leaves the cash constraint in place; this is not an unexpected new tightening.' },
    manager: { analyst: 'fundamentals', question: 'Given the policy clarification, did the synthetic later cash observation improve?', answer: '## Manager clarification\nThe synthetic later cash observation is 58 units, against the earlier 42. This supports improvement in this sample only.' },
  };
  const server = createServer((request, response) => {
    sourceRequests.push(request.url);
    const requester = request.url === '/risk.json' ? 'risk' : request.url === '/manager.json' ? 'manager' : undefined;
    if (!requester) { response.writeHead(404); response.end('Unknown fixture'); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify([{ fictional: true, requester, cash: requester === 'risk' ? 42 : 58 }]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let app, host;
  try {
    ({ app, host } = await installedFixture((body, response) => {
      try {
        const input = inputOf(body);
        if (!input?.role) { reply(response, body.model, 'Local fixture ready.'); return true; }
        const names = body.tools?.map(tool => tool.function.name) ?? [];
        if (input.qa) {
          const requester = input.qa.from, selected = cases[requester];
          assert.ok(selected, `Unexpected QA requester: ${requester}`);
          assert.equal(input.role, selected.analyst);
          assert.equal(input.qa.question, selected.question);
          assert.equal(input.research.members.length, requester === 'risk' ? 6 : 7);
          assert.ok(names.includes('sources_fetch'), 'The original analyst retains the selected source capability');
          assert.equal(names.includes('investment_research_ask'), false, 'An answering analyst cannot recursively dispatch QA');
          if (requester === 'manager') {
            assert.equal(input.research.qa.length, 1);
            assert.equal(input.research.qa[0].from, 'risk');
            assert.equal(input.research.qa[0].markdown, cases.risk.answer);
            assert.ok(input.research.source_refs.some(ref => ref.id === sources.get('risk').id));
          }
          const fetched = returned(body, `source_${requester}`);
          if (!fetched) {
            reply(response, body.model, null, { id: `source_${requester}`, name: 'sources_fetch', arguments: { url: `${origin}/${requester}.json` } });
            return true;
          }
          assert.equal(fetched.type, 'run');
          const waited = returned(body, `source_wait_${requester}`);
          if (!waited) {
            reply(response, body.model, null, { id: `source_wait_${requester}`, name: 'host_runs_wait', arguments: { runId: fetched.run.id, until: 'settled', timeoutMs: 10000 } });
            return true;
          }
          assert.equal(waited.run.status, 'completed', JSON.stringify(waited));
          assert.equal(waited.run.output.ref?.kind, 'data');
          assert.equal(waited.run.output.rowCount, 1);
          sources.set(requester, waited.run.output.ref);
          reply(response, body.model, selected.answer);
        } else if (cases[input.role]) {
          const requester = input.role, selected = cases[requester];
          assert.ok(names.includes('investment_research_ask'));
          if (requester === 'manager') {
            assert.equal(names.includes('sources_fetch'), false, 'The manager has knowledge and read tools, not direct source-fetching permission');
            assert.ok(names.includes('plugin_read'));
            assert.ok(names.includes('host_resources_read'));
            assert.equal(input.research.qa.length, 1, 'Risk clarification reaches the next member');
            assert.equal(input.research.qa[0].markdown, cases.risk.answer);
            assert.ok(input.research.source_refs.some(ref => ref.id === sources.get('risk').id));
          }
          const accepted = returned(body, `ask_${requester}`);
          if (!accepted) {
            reply(response, body.model, null, { id: `ask_${requester}`, name: 'investment_research_ask', arguments: { analyst: selected.analyst, question: selected.question } });
            return true;
          }
          assert.equal(accepted.type, 'run');
          questions.set(requester, accepted.run.id);
          const waited = returned(body, `wait_${requester}`);
          if (!waited) {
            reply(response, body.model, null, { id: `wait_${requester}`, name: 'host_runs_wait', arguments: { runId: accepted.run.id, until: 'settled', timeoutMs: 10000 } });
            return true;
          }
          assert.equal(waited.run.status, 'completed', JSON.stringify(waited));
          assert.equal(waited.run.output.from, requester);
          assert.equal(waited.run.output.to, selected.analyst);
          assert.equal(waited.run.output.markdown, selected.answer);
          assert.ok(waited.run.output.source_refs.some(ref => ref.id === sources.get(requester).id));
          answersSeen.set(requester, waited.run.output.markdown);
          reply(response, body.model, `## ${requester}\nThe original analyst's evidence is incorporated with its stated limits.\n${selected.answer}`);
        } else reply(response, body.model, `## ${input.role}\nInitial synthetic observation; the targeted sources have not been acquired yet.`);
        return true;
      } catch (error) {
        failures.push(error.message);
        reply(response, body.model, `Fixture assertion failed: ${error.message}`);
        return true;
      }
    }, ['web-sources']));
    const accepted = await host.capabilities.invoke(`${pluginId}#investment_research_analyze`, {
      title: 'Synthetic downstream evidence QA', question: 'Test original analyst supplementation; all sources are fictional local fixtures.', subjects: ['FICTIONAL'],
      model: { provider: 'fixture', id: 'fixture' }, research: { plugins: ['sesame/web-sources'], tools: ['sesame/web-sources#sources_fetch'] },
    }, { operationId: 'research-downstream-source-qa', task: { output: { type: 'none' } } });
    assert.equal(accepted.type, 'run');
    const done = await settled(host, accepted.run);
    assert.deepEqual(failures, []);
    assert.equal(done.status, 'completed', JSON.stringify({ error: done.error, interrupts: done.interrupts }));
    assert.deepEqual(sourceRequests, ['/risk.json', '/manager.json']);
    assert.deepEqual([...answersSeen.entries()], [['risk', cases.risk.answer], ['manager', cases.manager.answer]]);
    const descendants = app.runtime.runs.descendants(done.id);
    const agents = descendants.filter(run => run.kind === 'agent');
    assert.equal(agents.length, 10);
    assert.equal(new Set(agents.map(run => run.task.agentId)).size, 8);
    assert.equal(done.task.collaboration.agents.length, 8);
    const { readPacket, readRows } = await import('../packages/investment-research/src/artifacts.js');
    const packet = await readPacket(host, done.output.result_ref);
    assert.equal(packet.members.length, 8);
    assert.deepEqual(packet.qa.map(answer => answer.from), ['risk', 'manager']);
    assert.deepEqual(packet.qa.map(answer => answer.markdown), [cases.risk.answer, cases.manager.answer]);
    for (const requester of ['risk', 'manager']) {
      assert.deepEqual(await readRows(host, sources.get(requester)), [{ fictional: true, requester, cash: requester === 'risk' ? 42 : 58 }]);
      const answer = packet.qa.find(item => item.from === requester);
      assert.equal(answer.to, cases[requester].analyst);
      assert.equal(answer.qa_run_ref.id, questions.get(requester));
      assert.ok(answer.source_refs.some(ref => ref.id === sources.get(requester).id));
      const qaAgent = app.runtime.runs.read(answer.run_ref.id);
      assert.equal(qaAgent.task.agentId, cases[requester].analyst);
      assert.equal(qaAgent.task.stage, 'qa');
      assert.equal(qaAgent.parentRunId, questions.get(requester));
      const sourceRun = descendants.find(run => run.parentRunId === qaAgent.id && run.capabilityId === 'sesame/web-sources#sources_fetch');
      assert.ok(sourceRun, 'The answering analyst, not the manager, performs the selected source fetch');
      assert.equal(sourceRun.status, 'completed');
      assert.ok(packet.source_refs.some(ref => ref.id === sources.get(requester).id));
    }
    assert.ok(packet.summary.includes(cases.manager.answer));
    const manifest = await host.resources.read(done.output.result_ref, { part: 'manifest' });
    assert.ok([...sources.values()].every(source => manifest.dependencies.some(ref => ref.id === source.id)));
    t.diagnostic(JSON.stringify({ actualInstaller: true, requesterRoles: ['risk', 'manager'], originalMembers: 8, answerRuns: 2, sourceFetchesByAnalysts: 2, directManagerSourceFetches: 0 }));
  } finally {
    await app?.dispose();
    await new Promise(resolve => server.close(resolve));
  }
});

test('suffix restart at risk retains upstream Runs and identical large manager handoffs can be published again', { skip: !hostRoot, timeout: 120000 }, async t => {
  const failures = [], originalInputs = [], suffixInputs = [], managerInputs = [];
  const longObservation = `\n${'Synthetic bounded observation, not a market fact.\n'.repeat(800)}`;
  const { readPacket, readRows } = await import('../packages/investment-research/src/artifacts.js');
  let phase = 'original';
  const { app, host } = await installedFixture(async (body, response) => {
    try {
      const input = inputOf(body);
      if (!input?.role) { reply(response, body.model, 'Local fixture ready.'); return true; }
      assert.equal(input.qa, undefined);
      const research = input.research ?? (await readRows(host, input.context_ref))[0];
      ({ original: originalInputs, risk: suffixInputs, manager: managerInputs })[phase].push({ ...input, research });
      if (phase !== 'original') assert.ok((phase === 'risk' ? ['risk', 'manager'] : ['manager']).includes(input.role), 'Only the requested suffix gets a new Agent execution');
      reply(response, body.model, `## ${input.role}\n${phase === 'original' ? 'Retained original observation' : 'Revised downstream judgment'} from the fictional fixture.${phase === 'original' && ['market', 'fundamentals', 'news', 'sentiment'].includes(input.role) ? longObservation : ''}`);
      return true;
    } catch (error) {
      failures.push(error.message);
      reply(response, body.model, `Fixture assertion failed: ${error.message}`);
      return true;
    }
  });
  try {
    const seed = publishSample(app, 1);
    const first = await host.capabilities.invoke(`${pluginId}#investment_research_analyze`, {
      title: 'Synthetic suffix research', question: 'Preserve the completed upstream work while rerunning risk and manager.', subjects: ['FICTIONAL'],
      as_of: '2026-10-19T00:00:00Z', horizon: 'Original synthetic horizon', evidence_refs: [seed],
      model: { provider: 'fixture', id: 'fixture' }, research: { plugins: [] },
    }, { operationId: 'research-suffix-original', task: { output: { type: 'none' } } });
    assert.equal(first.type, 'run');
    const originalRun = await settled(host, first.run);
    assert.equal(originalRun.status, 'completed', JSON.stringify({ error: originalRun.error, interrupts: originalRun.interrupts }));
    const original = await readPacket(host, originalRun.output.result_ref);
    const before = structuredClone(original), prefix = original.members.slice(0, 6);
    assert.equal(originalInputs.length, 8);
    phase = 'risk';
    const second = await host.capabilities.invoke(`${pluginId}#investment_research_analyze`, {
      start_from: { result_ref: originalRun.output.result_ref, role: 'risk' },
      model: { provider: 'fixture', id: 'fixture' }, research: { plugins: [] },
    }, { operationId: 'research-suffix-restart', task: { output: { type: 'none' } } });
    assert.equal(second.type, 'run');
    const done = await settled(host, second.run);
    assert.deepEqual(failures, []);
    assert.equal(done.status, 'completed', JSON.stringify({ error: done.error, interrupts: done.interrupts }));
    assert.notEqual(done.id, originalRun.id);
    assert.deepEqual(suffixInputs.map(input => input.role), ['risk', 'manager']);
    assert.deepEqual(suffixInputs[0].research.members, prefix);
    assert.equal(suffixInputs[0].research.question, original.question);
    assert.equal(suffixInputs[0].research.as_of, original.as_of);
    assert.equal(suffixInputs[0].research.horizon, original.horizon);
    const descendants = app.runtime.runs.descendants(done.id);
    const newAgents = descendants.filter(run => run.kind === 'agent');
    assert.deepEqual(newAgents.map(run => run.task.agentId).sort(), ['manager', 'risk']);
    assert.ok(newAgents.every(run => run.parentRunId === done.id && run.status === 'completed' && run.attempt === 1));
    const events = []; let cursor;
    do {
      const page = await host.runs.read(second.run, { include: ['events'], limit: 200, ...(cursor ? { cursor } : {}) });
      events.push(...page.history.items); cursor = page.history.nextCursor;
    } while (cursor);
    const handoffs = events.filter(event => event.type === 'handoff');
    assert.equal(handoffs.length, 1, 'Only new risk -> new manager emits a live handoff');
    const risk = newAgents.find(run => run.task.agentId === 'risk'), manager = newAgents.find(run => run.task.agentId === 'manager');
    assert.equal(handoffs[0].data.fromRunId, risk.id);
    assert.equal(handoffs[0].data.toRunId, manager.id);
    const packet = await readPacket(host, done.output.result_ref);
    assert.equal(packet.members.length, 8);
    assert.deepEqual(packet.members.slice(0, 6), prefix);
    assert.deepEqual(packet.evidence_refs, [seed]);
    assert.deepEqual(packet.source_refs, [seed]);
    assert.equal(packet.start_from.result_ref.id, originalRun.output.result_ref.id);
    assert.deepEqual(await readPacket(host, originalRun.output.result_ref), before, 'The original completed packet remains byte-equivalent as data');
    const manifest = await host.resources.read(done.output.result_ref, { part: 'manifest' });
    assert.ok(manifest.dependencies.some(ref => ref.id === originalRun.output.result_ref.id), 'The new result retains provenance to the old completed packet');

    const beforeManagerRestart = structuredClone(packet);
    phase = 'manager';
    const third = await host.capabilities.invoke(`${pluginId}#investment_research_analyze`, {
      start_from: { result_ref: done.output.result_ref, role: 'manager' },
      model: { provider: 'fixture', id: 'fixture' }, research: { plugins: [] },
    }, { operationId: 'research-suffix-manager-restart', task: { output: { type: 'none' } } });
    assert.equal(third.type, 'run');
    const managerDone = await settled(host, third.run);
    assert.deepEqual(failures, []);
    assert.equal(managerDone.status, 'completed', JSON.stringify({ error: managerDone.error, interrupts: managerDone.interrupts }));
    assert.equal(managerDone.attempt, 1, 'Identical handoff content must not require recovery from a resource-name conflict');
    assert.deepEqual(managerInputs.map(input => input.role), ['manager']);
    assert.deepEqual(managerInputs[0].research.members, packet.members.slice(0, 7));
    const previousManagerInput = suffixInputs.find(input => input.role === 'manager');
    assert.ok(previousManagerInput.context_ref && managerInputs[0].context_ref, 'Both manager dispatches use the actual published large-context handoff');
    assert.ok(Buffer.byteLength(JSON.stringify(previousManagerInput.research)) > 128 * 1024);
    assert.deepEqual(managerInputs[0].research, previousManagerInput.research, 'Different operations publish exactly the same handoff content');
    assert.equal(managerInputs[0].research.start_from, undefined, 'The handoff cannot reveal the old complete result through a restart reference');
    const managerChildren = app.runtime.runs.descendants(managerDone.id).filter(run => run.kind === 'agent');
    assert.equal(managerChildren.length, 1);
    assert.equal(managerChildren[0].task.agentId, 'manager');
    assert.equal(managerChildren[0].parentRunId, managerDone.id);
    assert.equal(managerChildren[0].attempt, 1);
    const managerPacket = await readPacket(host, managerDone.output.result_ref);
    assert.deepEqual(managerPacket.members.slice(0, 7), packet.members.slice(0, 7));
    assert.deepEqual(managerPacket.source_refs, [seed]);
    assert.deepEqual(await readPacket(host, done.output.result_ref), beforeManagerRestart);
    assert.deepEqual(await readPacket(host, originalRun.output.result_ref), before);
    const managerEvents = await host.runs.read(third.run, { include: ['events'], limit: 200 });
    assert.equal(managerEvents.history.items.filter(event => event.type === 'handoff').length, 0, 'A manager-only suffix has no same-workflow sender');
    t.diagnostic(JSON.stringify({ retainedOriginalMembers: 6, firstSuffix: ['risk', 'manager'], finalSuffix: ['manager'], finalRetainedMembers: 7, identicalPublishedContexts: 2, liveHandoffs: 1, crossWorkflowHandoffs: 0 }));
  } finally { await app.dispose(); }
});

for (const requesterRole of ['bull', 'manager']) {
test(`resuming interrupted ${requesterRole} QA reuses its accepted question and analyst session`, { skip: !hostRoot, timeout: 120000 }, async t => {
  const failures = [];
  const answer = '## Recovered clarification\nThe synthetic evidence gap is resolved. The original analysis and question are retained.';
  const recovery = 'synthetic missing evidence restored';
  let interruptCalls = 0, analystRecoveries = 0, requesterRecoveries = 0, acceptedQuestionId, requesterReceivedAnswer = false;
  const { app, host } = await installedFixture((body, response) => {
    try {
      const input = inputOf(body);
      if (!input?.role) { reply(response, body.model, 'Observed the interruption; await the explicit fixture recovery.'); return true; }
      const resumed = JSON.stringify(body.messages).includes('The owning Run was explicitly resumed');
      if (input.qa) {
        assert.equal(input.role, 'fundamentals');
        assert.equal(input.qa.from, requesterRole);
        assert.equal(input.qa.question, questionOne);
        if (!resumed) {
          assert.equal(interruptCalls++, 0, 'The original analyst pauses once rather than creating another question');
          reply(response, body.model, null, { id: 'qa_missing_evidence', name: 'host_runs_interrupt', arguments: { reason: 'synthetic missing evidence' } });
        } else {
          analystRecoveries++;
          assert.ok(JSON.stringify(body.messages).includes(recovery), 'Root recovery reaches the original answering analyst');
          reply(response, body.model, answer);
        }
      } else if (input.role === requesterRole) {
        if (resumed) requesterRecoveries++;
        const accepted = returned(body, 'qa_resume_ask');
        if (!accepted) {
          assert.equal(resumed, false, 'The resumed requester retains the original accepted question');
          reply(response, body.model, null, { id: 'qa_resume_ask', name: 'investment_research_ask', arguments: { analyst: 'fundamentals', question: questionOne } });
          return true;
        }
        assert.equal(accepted.type, 'run');
        acceptedQuestionId ??= accepted.run.id;
        assert.equal(accepted.run.id, acceptedQuestionId);
        const waits = body.messages.flatMap(message => message.tool_calls ?? []).filter(call => call.function.name === 'host_runs_wait');
        const waitMessage = waits.length ? body.messages.findLast(message => message.role === 'tool' && message.tool_call_id === waits.at(-1).id) : undefined;
        let waited;
        if (waitMessage) {
          const content = text(waitMessage.content);
          if (content.startsWith('{')) waited = JSON.parse(content);
          else {
            assert.equal(resumed, true);
            assert.match(content, /abort|interrupt/i, 'The interrupted wait can leave a plain-text SDK abort observation');
          }
        }
        if (waited?.run?.status === 'completed') {
          assert.equal(waited.run.id, acceptedQuestionId);
          assert.equal(waited.run.output.markdown, answer);
          requesterReceivedAnswer = true;
          reply(response, body.model, `## ${requesterRole}\nThe recovered answer resolves the original targeted question; its uncertainty remains explicit.`);
        } else {
          reply(response, body.model, null, { id: `qa_resume_wait_${waits.length + 1}`, name: 'host_runs_wait', arguments: { runId: acceptedQuestionId, until: 'settled', timeoutMs: 10000 } });
        }
      } else {
        if (requesterRole === 'bull' && ['bear', 'risk', 'manager'].includes(input.role)) {
          assert.equal(requesterReceivedAnswer, true);
          assert.equal(input.research.qa.length, 1);
          assert.equal(input.research.qa[0].markdown, answer);
        }
        reply(response, body.model, `## ${input.role}\nSynthetic observation retained through the original workflow.`);
      }
      return true;
    } catch (error) {
      failures.push(error.message);
      reply(response, body.model, `Fixture assertion failed: ${error.message}`);
      return true;
    }
  });
  try {
    const accepted = await host.capabilities.invoke(`${pluginId}#investment_research_analyze`, {
      title: 'Synthetic resumable QA', question: 'Test retained clarification through an actual workflow interruption.', subjects: ['FICTIONAL'],
      model: { provider: 'fixture', id: 'fixture' }, research: { plugins: [] },
    }, { operationId: 'research-qa-resume-fixture', task: { output: { type: 'none' } } });
    const paused = (await host.runs.wait(accepted.run, { until: 'settled', timeoutMs: 30000 })).run;
    assert.deepEqual(failures, []);
    assert.equal(paused.status, 'interrupted', JSON.stringify({ status: paused.status, error: paused.error, interrupts: paused.interrupts }));
    const pausedChildren = app.runtime.runs.descendants(paused.id);
    const requester = pausedChildren.find(run => run.kind === 'agent' && run.task.agentId === requesterRole);
    const question = pausedChildren.find(run => run.capabilityId === capabilityId);
    const analyst = pausedChildren.find(run => run.kind === 'agent' && run.task.stage === 'qa');
    assert.ok(requester?.executionSessionId);
    assert.ok(analyst?.executionSessionId);
    assert.equal(question.id, acceptedQuestionId);
    assert.equal(question.parentRunId, requester.id);
    assert.equal(analyst.parentRunId, question.id);
    assert.equal(analyst.task.agentId, 'fundamentals');
    assert.ok([requester, question, analyst].every(run => run.status === 'interrupted'));
    assert.equal(interruptCalls, 1);
    assert.equal(analystRecoveries, 0);
    assert.equal(requesterReceivedAnswer, false);
    const questionCheckpoint = structuredClone(app.store.get('run_checkpoint', question.id).state);
    assert.equal(questionCheckpoint.ref.id, analyst.id);
    await app.runtime.pump('conv_main');

    await host.runs.resume(accepted.run, {
      interruptIds: paused.interrupts.filter(item => !item.resolvedAt).map(item => item.id),
      response: recovery, operationId: 'resume-original-research-qa',
    });
    const done = (await host.runs.wait(accepted.run, { until: 'settled', timeoutMs: 30000 })).run;
    assert.deepEqual(failures, []);
    assert.equal(done.status, 'completed', JSON.stringify({ status: done.status, error: done.error, interrupts: done.interrupts,
      descendants: app.runtime.runs.descendants(done.id).map(run => ({ id: run.id, capabilityId: run.capabilityId, status: run.status, stage: run.task?.stage })) }));
    assert.equal(done.id, paused.id);
    assert.equal(done.executionSessionId, paused.executionSessionId);
    assert.equal(done.attempt, 2);
    const children = app.runtime.runs.descendants(done.id);
    assert.equal(children.filter(run => run.capabilityId === capabilityId).length, 1, 'Recovery reuses the accepted QA function');
    assert.equal(children.filter(run => run.kind === 'agent').length, 9, 'Recovery adds no replacement analyst or requester');
    assert.equal(children.filter(run => run.kind === 'agent' && run.task.agentId === 'fundamentals').length, 2);
    for (const previous of [requester, question, analyst]) {
      const current = app.runtime.runs.read(previous.id);
      assert.equal(current.status, 'completed');
      assert.equal(current.attempt, 2);
      assert.equal(current.executionSessionId, previous.executionSessionId);
    }
    assert.equal(app.store.get('run_checkpoint', question.id).state.ref.id, analyst.id);
    assert.equal(interruptCalls, 1);
    assert.equal(analystRecoveries, 1);
    assert.ok(requesterRecoveries >= 1);
    assert.equal(requesterReceivedAnswer, true);
    const { readPacket } = await import('../packages/investment-research/src/artifacts.js');
    const packet = await readPacket(host, done.output.result_ref);
    assert.equal(packet.members.length, 8);
    assert.equal(packet.members.at(-1).role, 'manager');
    assert.equal(packet.qa.length, 1);
    assert.equal(packet.qa[0].from, requesterRole);
    assert.equal(packet.qa[0].markdown, answer);
    assert.equal(packet.qa[0].qa_run_ref.id, question.id);
    assert.equal(packet.qa[0].run_ref.id, analyst.id);
    t.diagnostic(JSON.stringify({ recoveredChain: `workflow -> ${requesterRole} -> QA function -> analyst`, acceptedQuestions: 1, retainedAnalystSessions: 1, managerCompleted: true }));
  } finally { await app.dispose(); }
});
}
