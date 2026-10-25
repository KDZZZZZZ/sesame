// Actual installer, native workflow, Agent transport and artifact store; all research is a local synthetic fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const packageRoot = fileURLToPath(new URL('../packages/investment-research/', import.meta.url));
const text = content => typeof content === 'string' ? content : (content ?? []).map(part => part.text ?? '').join('');
function inputOf(body) {
  for (const message of body.messages.filter(message => message.role === 'user').toReversed()) {
    const value = text(message.content), index = value.lastIndexOf('\n\nInput JSON:\n');
    if (index >= 0) return JSON.parse(value.slice(index + '\n\nInput JSON:\n'.length));
  }
  return null;
}
function reply(response, model, content, call) {
  const chunk = (delta, finish_reason) => JSON.stringify({ id: 'research-host-fixture', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason }] });
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: 'read_market_evidence', type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { role: 'assistant', content };
  response.end(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, call ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
}

test('new package passes actual registration, executes a native eight-Agent workflow without an account, and publishes reusable data', { skip: !hostRoot, timeout: 120000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { fixture } = await load('tests/fixture-provider.js');
  const { createHostContextV2 } = await load('modules/plugins/host-v2/context.js');
  const { validateCapabilityManifest } = await load('modules/plugins/capability-contract.js');
  const definition = JSON.parse(await readFile(join(packageRoot, 'capabilities.json'), 'utf8'));
  const checked = await validateCapabilityManifest(definition, { pluginId: 'sesame/investment-research' });
  assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics));
  const observations = [], failures = []; let sourceRef;
  const app = await fixture({ responseHandler: (body, response) => {
    try {
      const input = inputOf(body);
      if (input?.role) {
        if (!observations.some(item => item.role === input.role)) observations.push(input);
        const names = body.tools?.map(tool => tool.function.name) ?? [];
        assert.ok(names.every(name => !/(trade|execution|manual_|trading_)/.test(name)));
        if (input.role === 'market' && !body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'read_market_evidence')) {
          assert.ok(names.includes('host_resources_read'));
          reply(response, body.model, null, { name: 'host_resources_read', arguments: { ref: sourceRef, part: 'content', entry: 'rows.json' } });
        } else reply(response, body.model, `## ${input.role}\nSynthetic fixture observation: 42 test units. No account or broker queried.\nScope: test collaboration only; prose deliberately contains no ArtifactRef JSON.`);
      } else reply(response, body.model, 'Local fixture ready.');
      return true;
    } catch (error) {
      failures.push(error); response.writeHead(500); response.end(error.message); return true;
    }
  } });
  try {
    const draft = join(app.runtime.workspaces.root('conv_main'), 'investment-research-draft');
    await cp(packageRoot, draft, { recursive: true });
    const verified = await app.runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(verified.passed, true, JSON.stringify(verified));
    const installed = await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: verified.digest });
    assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
    const host = createHostContextV2(app.runtime, app.runtime.capabilities.hostEntry, 'conv_main');
    sourceRef = app.runtime.contractArtifacts.publish({ id: 'fixture/research-evidence', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` }, {
      operationId: 'synthetic-research-source', manifest: { kind: 'data', schemaVersion: '1.0.0', dependencies: [],
        content: { format: 'json-rows', path: 'rows.json', rowCount: 1, columns: ['fixture', 'value'], provenance: { kind: 'demo' } },
        blobs: [{ ...app.runtime.contractArtifacts.blob('[{"fixture":true,"value":42}]'), path: 'rows.json', mediaType: 'application/json' }],
      },
    });
    const declared = await host.capabilities.list({ pluginId: 'sesame/investment-research' });
    assert.equal(declared.items.length, 3);
    const accepted = await host.capabilities.invoke('sesame/investment-research#investment_research_analyze', {
      title: 'Synthetic independent research', question: 'Test evidence handoff; all content is fictional.', subjects: ['FICTIONAL'],
      model: { provider: 'fixture', id: 'fixture' }, research: { plugins: [] },
    }, { operationId: 'research-host-fixture', task: { output: { type: 'none' } } });
    assert.equal(accepted.type, 'run');
    let done;
    for (;;) {
      const result = await host.runs.wait(accepted.run, { until: 'settled', timeoutMs: 30000 });
      if (result.reason === 'timeout') continue;
      assert.equal(result.run.status, 'completed', JSON.stringify({ error: result.run.error, interrupts: result.run.interrupts }));
      done = result.run; break;
    }
    assert.equal(done.kind, 'workflow'); assert.equal(done.task.collaboration.agents.length, 8);
    const children = app.runtime.runs.descendants(done.id).filter(run => run.kind === 'agent');
    assert.equal(children.length, 8); assert.ok(children.every(run => run.parentRunId === done.id && run.task.agentId));
    const { readPacket } = await import('../packages/investment-research/src/artifacts.js');
    const packet = await readPacket(host, done.output.result_ref);
    assert.equal(packet.members.length, 8); assert.equal(packet.members.at(-1).role, 'manager');
    assert.deepEqual(packet.source_refs, [sourceRef]);
    assert.deepEqual(packet.members.find(member => member.role === 'market').source_refs, [sourceRef]);
    assert.deepEqual(packet.members.find(member => member.role === 'news').source_refs, []);
    assert.ok(packet.members.every(member => !member.markdown.includes('sha256:')), 'Real tool evidence survives even when final Markdown contains no reference JSON');
    assert.equal(done.output.report_ref, undefined); assert.equal(observations.length, 8); assert.deepEqual(failures, []);
    assert.equal(observations.at(-1).research.members.length, 7);
    const custom = await host.capabilities.invoke('sesame/investment-research#investment_research_analyze', {
      title: 'Custom installed research', question: 'Use the selected fictional facts and one independent challenge.', subjects: ['FICTIONAL'],
      model: { provider: 'fixture', id: 'fixture' }, research: { plugins: [] }, evidence_refs: [sourceRef],
      workflow: { stages: [[{id:'facts',role:'fundamentals'}],[{id:'challenge',role:'custom',instructions:'Check the strongest alternative explanation.'}],[{id:'editor',role:'manager'}]],synthesis:'editor' },
    }, { operationId:'custom-research-host-fixture',task:{output:{type:'none'}} });
    const customDone=(await host.runs.wait(custom.run,{until:'settled',timeoutMs:30000})).run;
    assert.equal(customDone.status,'completed',JSON.stringify({error:customDone.error,interrupts:customDone.interrupts}));
    assert.deepEqual(customDone.task.collaboration.agents.map(member=>member.id),['facts','challenge','editor']);
    assert.deepEqual(app.runtime.runs.descendants(customDone.id).filter(run=>run.kind==='agent').map(run=>run.task.agentId),['facts','challenge','editor']);
    const customPacket=await readPacket(host,customDone.output.result_ref);
    assert.equal(customPacket.workflow.synthesis,'editor');assert.equal(customPacket.members.length,3);
    assert.deepEqual(Object.keys(observations.find(member=>member.role==='editor').qa_context.members),['facts','challenge']);
    const suffix=await host.capabilities.invoke('sesame/investment-research#investment_research_analyze',{
      start_from:{result_ref:customDone.output.result_ref,role:'editor'},model:{provider:'fixture',id:'fixture'},research:{plugins:[]},
    },{operationId:'custom-research-no-horizon-suffix',task:{output:{type:'none'}}});
    const suffixDone=(await host.runs.wait(suffix.run,{until:'settled',timeoutMs:30000})).run;
    assert.equal(suffixDone.status,'completed',JSON.stringify({error:suffixDone.error,interrupts:suffixDone.interrupts}));
    const suffixPacket=await readPacket(host,suffixDone.output.result_ref);
    assert.equal(Object.hasOwn(suffixPacket,'horizon'),false);
    assert.deepEqual(suffixPacket.members.slice(0,2),customPacket.members.slice(0,2));
    assert.deepEqual(app.runtime.runs.descendants(suffixDone.id).filter(run=>run.kind==='agent').map(run=>run.task.agentId),['editor']);
    assert.deepEqual(failures,[]);
    t.diagnostic(JSON.stringify({ installation: 'actual-package-manager', kind: done.kind, models: 'local-SSE-fixture', agents: children.length, resultArtifact: packet.type, accountRequired: false, brokerCalls: 0 }));
  } finally { await app.dispose(); }
});
