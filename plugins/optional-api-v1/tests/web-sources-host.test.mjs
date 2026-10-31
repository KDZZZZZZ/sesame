// Real installation, Agent transport, Runs and artifact store. All sources/model replies are local fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const packageRoot = fileURLToPath(new URL('../packages/web-sources/', import.meta.url));
const text = content => typeof content === 'string' ? content : (content ?? []).map(part => part.text ?? '').join('');
function inputOf(body) {
  for (const message of body.messages.filter(message => message.role === 'user').toReversed()) {
    const value = text(message.content), marker = '\n\nInput JSON:\n', index = value.lastIndexOf(marker);
    if (index >= 0) return JSON.parse(value.slice(index + marker.length));
  }
}
function returned(body, id) {
  const message = body.messages.findLast(message => message.role === 'tool' && message.tool_call_id === id);
  return message ? JSON.parse(text(message.content)) : undefined;
}
function reply(response, model, content, call) {
  const chunk = (delta, finish_reason) => JSON.stringify({ id: 'source-fixture', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason }] });
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { role: 'assistant', content };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, call ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
}

test('a 404 is delivered to the same Agent, which replaces the source while sibling and parent remain uninterrupted', { skip: !hostRoot, timeout: 90000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { fixture } = await load('tests/fixture-provider.js');
  const { createHostContextV2 } = await load('modules/plugins/host-v2/context.js');
  const raw = Buffer.from('<html><p>Replacement evidence: café.</p></html>', 'utf8');
  const requests = [], modelErrors = [], agentRefs = {};
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/missing') { response.writeHead(404); response.end('not found'); }
    else if (request.url === '/malformed.json') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{broken'); }
    else if (request.url === '/empty.json') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('[]'); }
    else { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(raw); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let siblingResponse, sourceResult, failureDelivered = false, parentRef, app;
  const finishSibling = () => {
    if (siblingResponse && !siblingResponse.writableEnded) reply(siblingResponse, 'fixture', 'Sibling finished independent work.');
  };
  try {
    app = await fixture({ responseHandler: (body, response) => {
      try {
        const input = inputOf(body);
        if (input?.role === 'sibling') { siblingResponse = response; if (sourceResult) finishSibling(); return true; }
        if (input?.role !== 'researcher') { reply(response, body.model, 'Fixture ready.'); return true; }
        for (const [key, path] of [['missing', '/missing'], ['replacement', '/replacement']]) {
          const accepted = returned(body, `fetch_${key}`);
          if (!accepted) {
            reply(response, body.model, null, { id: `fetch_${key}`, name: 'sources_fetch', arguments: { url: origin + path } });
            return true;
          }
          assert.equal(accepted.type, 'run');
          const waited = returned(body, `wait_${key}`);
          if (!waited) {
            reply(response, body.model, null, { id: `wait_${key}`, name: 'host_runs_wait', arguments: { runId: accepted.run.id, timeoutMs: 10000 } });
            return true;
          }
          assert.equal(waited.run.status, 'completed', JSON.stringify(waited));
          const value = waited.run.output;
          if (key === 'missing') {
            assert.deepEqual(value, { status: 'unavailable', url: origin + '/missing', error: { code: 'source_http_error', message: '来源返回 HTTP 404', http_status: 404 } });
            assert.equal(app.runtime.runs.read(parentRef.id).status, 'running');
            assert.equal(app.runtime.runs.read(agentRefs.sibling.id).status, 'running', 'A sibling remains active while the researcher consumes the failed URL result');
            failureDelivered = true;
          } else {
            assert.equal(failureDelivered, true);
            assert.equal(value.status, 'available');
            assert.equal(value.text, raw.toString('utf8'));
            sourceResult = value;
          }
        }
        finishSibling();
        reply(response, body.model, 'The first URL returned 404. Research continued with the replacement source.');
        return true;
      } catch (error) { modelErrors.push(error.message); finishSibling(); reply(response, body.model, `Fixture assertion: ${error.message}`); return true; }
    } });
    const draft = join(app.runtime.workspaces.root('conv_main'), 'web-sources-draft');
    await cp(packageRoot, draft, { recursive: true });
    const verified = await app.runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(verified.passed, true, JSON.stringify(verified));
    const installed = await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: verified.digest });
    assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
    const host = createHostContextV2(app.runtime, app.runtime.capabilities.hostEntry, 'conv_main');
    app.runtime.capabilities.registerBuiltins([{
      descriptor: { id: 'host.sourceFailureFixture', kind: 'workflow', execution: 'run', consumers: ['agent', 'host'], description: 'Synthetic source recovery workflow',
        inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, effects: ['start:agents'], binding: { type: 'native', name: 'sourceFailureFixture' },
        usage: { purpose: 'Test source result boundaries.', inputs: 'Empty input.', outputs: 'Completed member outputs.', prerequisites: [], limitations: [] } },
      execute: async (_input, execution) => {
        parentRef = execution.run;
        await Promise.all(['researcher', 'sibling'].map(async role => {
          const accepted = await app.runtime.capabilities.invoke('host.agent.run', {
            title: role, objective: 'Complete local synthetic research.', instructions: 'Use local fixtures only. A failed URL can be replaced.', input: { role },
            model: host.context.models.find(model => model.provider === 'fixture'), allowedCalls: role === 'researcher' ? [{ pluginId: 'sesame/web-sources', capabilityId: 'sources_fetch' }] : [],
            plugins: role === 'researcher' ? ['sesame/web-sources'] : [], output: { type: 'none' },
          }, { operationId: `source-fixture-${role}` }, execution.context);
          agentRefs[role] = accepted.run;
        }));
        const members = await Promise.all(Object.values(agentRefs).map(async ref => {
          const { run } = await app.runtime.runs.wait(ref.id, { signal: execution.signal, timeoutMs: 30000 });
          assert.equal(run.status, 'completed', JSON.stringify(run.error));
          return run.output;
        }));
        return { members };
      },
    }]);
    const accepted = await host.capabilities.invoke('host.sourceFailureFixture', {});
    const { run: done } = await host.runs.wait(accepted.run, { timeoutMs: 30000 });
    assert.deepEqual(modelErrors, []);
    assert.equal(done.status, 'completed', JSON.stringify({ error: done.error, interrupts: done.interrupts }));
    assert.equal(failureDelivered, true);
    assert.equal(done.output.members.length, 2);
    const allRuns = [done, ...app.runtime.runs.descendants(done.id)];
    assert.equal(allRuns.filter(run => run.kind === 'agent').length, 2);
    assert.equal(allRuns.filter(run => run.capabilityId === 'sesame/web-sources#sources_fetch').length, 2);
    for (const run of allRuns) {
      assert.equal(run.status, 'completed'); assert.equal(run.attempt, 1); assert.deepEqual(run.interrupts ?? [], []);
    }
    assert.deepEqual(requests, ['/missing', '/replacement']);
    assert.equal(sourceResult.provenance.provider, origin + '/replacement');
    assert.equal(sourceResult.provenance.data_hash, 'sha256:' + createHash('sha256').update(raw).digest('hex'));
    const frozen = await host.resources.read(sourceResult.ref, { part: 'content', entry: 'source.txt', encoding: 'base64' });
    assert.deepEqual(Buffer.from(frozen.content, 'base64'), raw);

    const source = (await host.data.sources({ providerId: 'sesame/web-sources#http' })).items[0].ref;
    const missingPage = await host.data.query({ source, input: { url: origin + '/missing' } });
    assert.equal(missingPage.metadata.status, 'unavailable'); assert.equal(missingPage.metadata.error.http_status, 404);
    assert.deepEqual(missingPage.items, []); assert.equal(missingPage.metadata.provenance, undefined);
    const malformed = await host.data.query({ source, input: { url: origin + '/malformed.json' } });
    assert.equal(malformed.metadata.status, 'unavailable'); assert.equal(malformed.metadata.error.code, 'source_content_error');
    const empty = await host.data.query({ source, input: { url: origin + '/empty.json' } });
    assert.equal(empty.metadata.status, 'available'); assert.deepEqual(empty.items, []); assert.ok(empty.metadata.provenance);

    const manifest = JSON.parse(await readFile(join(packageRoot, 'capabilities.json'), 'utf8'));
    const Ajv = createRequire(join(hostRoot, 'package.json'))('ajv');
    const ajv = new Ajv({ strict: false });
    const sourceSchema = ajv.compile(manifest.capabilities.find(cap => cap.id === 'sources_fetch').outputSchema);
    const unavailable = missingPage.metadata;
    assert.equal(sourceSchema(unavailable), true);
    assert.equal(sourceSchema({ ...unavailable, ref: sourceResult.ref }), false, 'An unavailable result cannot claim a frozen successful source');
    assert.equal(sourceSchema({ ...unavailable, provenance: sourceResult.provenance }), false);
    const pageSchema = ajv.compile(manifest.capabilities.find(cap => cap.id === 'http_query').outputSchema);
    assert.equal(pageSchema(missingPage), true);
    assert.equal(pageSchema({ ...missingPage, metadata: { ...unavailable, provenance: sourceResult.provenance } }), false);
    assert.equal(pageSchema({ ...missingPage, items: [{ fabricated: true }] }), false);
    t.diagnostic('404 delivered to the original Agent; replacement read successfully; two Agents and parent completed once with no interrupts; bytes, provenance and unavailable-page distinction verified.');
  } finally {
    finishSibling();
    await app?.dispose();
    await new Promise(resolve => server.close(resolve));
  }
});
