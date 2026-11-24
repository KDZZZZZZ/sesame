// Real Store/Runtime/API2, real report composition/publication and Electron.
// A local deterministic provider reviews explicit precomputed software fixtures;
// it does not fetch market data, run a paid model or claim independent research.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const outputDirectory = process.env.SESAME_INVESTMENT_REPORT_RECEIPT_DIR;
const pluginId = 'sesame/investment-research';
const roles = ['scope', 'evidence', 'analysis', 'synthesis'];
const reportPath = 'research-fixture/four-stage-research.html';
const brief = { objective: 'Describe only the supplied fictional observations', questions: ['How do the supplied values compare?'], method_ids: ['comparison'], delivery: 'Keep the observation chart and requested scope note. Omit forecasts, confidence and new source fetching.' };
const text = content => typeof content === 'string' ? content : (content ?? []).map(part => part.text ?? '').join('');
let sequence = 0;
function task(body) {
  for (const message of body.messages.filter(row => row.role === 'user').toReversed()) {
    const value = text(message.content), marker = '\n\nInput JSON:\n', at = value.lastIndexOf(marker);
    if (at >= 0) return JSON.parse(value.slice(at + marker.length));
  }
}
function replies(body) {
  const calls = new Map(body.messages.flatMap(row => row.tool_calls ?? []).map(call => [call.id, { name: call.function.name, args: JSON.parse(call.function.arguments) }]));
  return body.messages.filter(row => row.role === 'tool').map(row => {
    const call = calls.get(row.tool_call_id), content = text(row.content);
    try { return { ...call, value: JSON.parse(content) }; }
    catch { throw new Error(`${call?.name ?? 'unknown tool'} returned non-JSON: ${content.slice(0, 1800)}`); }
  });
}
function respond(response, model, content, call) {
  const event = (delta, reason) => JSON.stringify({ id: 'research-four-stage-fixture', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: reason }] });
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: `research_${++sequence}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { role: 'assistant', content };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${event(delta, null)}\n\ndata: ${event({}, call ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
}

test('installed Research entry separates four actual Agent stages and publishes the user-adjusted fixed result into its parent Research binding', { skip: !hostRoot, timeout: 120000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)).href);
  const executable = (await readFile(join(hostRoot, 'node_modules/electron/path.txt'), 'utf8')).trim();
  assert.ok((await stat(join(hostRoot, 'node_modules/electron/dist', executable))).isFile(), 'Use existing Electron; never download during this test');
  process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1,localhost,::1';
  const { fixture, eventually } = await load('tests/fixture-provider.js');
  const { createHostContextV2 } = await load('modules/plugins/host-v2/context.js');
  const observations = new Map(), failures = [], calls = []; let rawRef, resultsRef, fixtureCalls = 0, published, rendered, bindingRead;
  const rawRows = [100, 101, 99, 103, 104, 105].map((value, index) => ({ time: `2026-01-0${index + 1}`, value, unit: 'USD', source: 'explicit synthetic fixture' }));
  const app = await fixture({ reportRenderer: 'electron', responseHandler: (body, response) => {
    try {
      const input = task(body); if (!input?.role) { respond(response, body.model, 'Local fixture ready.'); return true; }
      fixtureCalls++; const role = input.role; assert.ok(roles.includes(role));
      const names = body.tools.map(item => item.function.name).sort();
      if (!observations.has(role)) observations.set(role, { input, tools: names });
      else assert.deepEqual(names, observations.get(role).tools);
      assert.deepEqual(input.research.report_brief, brief);
      assert.deepEqual(input.research.members.map(item => item.role), roles.slice(0, roles.indexOf(role)));
      assert.ok(names.includes('host_resources_read'));
      assert.equal(names.some(name => /^(?:manual_|trading_|portfolio_|mt5_|host_agent_run)/.test(name)), false);
      if (role === 'scope') { assert.deepEqual(names.filter(name => !name.startsWith('host_')), ['plugin_read', 'research_methods', 'research_read']); assert.equal(names.includes('host_reports_describe'), false); assert.equal(names.includes('host_reports_publish'), false); }
      if (role === 'evidence') { assert.ok(names.includes('sources_fetch') && names.includes('data_read')); assert.equal(names.includes('components_show'), false); }
      if (role === 'analysis') { assert.ok(names.includes('data_read') && names.includes('investment_research_ask')); assert.ok(names.includes('sources_fetch')); assert.equal(names.includes('components_show'), false); }
      if (role === 'synthesis') { assert.ok(names.includes('host_reports_describe') && names.includes('host_reports_publish') && names.includes('components_describe') && names.includes('components_show') && names.includes('report_check')); assert.equal(names.includes('sources_fetch'), false); }
      const returned = replies(body);
      for (const result of returned) assert.ok(!result.value?.isError, JSON.stringify({ role, name: result.name, result: result.value }));
      const call = (name, args) => { assert.ok(names.includes(name), `${role} must actually own ${name}`); calls.push({ role, name, args }); respond(response, body.model, null, { name, arguments: args }); };
      if (role === 'scope') {
        if (returned.length === 0) call('research_methods', {query:'comparison',limit:1});
        else if (returned.length === 1) { assert.equal(returned[0].value.items[0].id, 'comparison'); call('research_read', {ids:['comparison']}); }
        else { assert.ok(returned[1].value.items[0].content.length > 100); respond(response, body.model, '已按实际比较问题读取 Research 方法。仅说明固定观察与用户需要的边界，保留观察图，不追加预测或业务模板栏目。'); }
      } else if (role === 'evidence') {
        if (returned.length === 0) call('data_read', { ref: rawRef });
        else if (returned.length === 1) { assert.deepEqual(returned[0].value.ref, rawRef); assert.equal(returned[0].value.rowCount, rawRows.length); call('data_read', { ref: resultsRef }); }
        else { assert.deepEqual(returned[1].value.ref, resultsRef); assert.equal(returned[1].value.rowCount, 3); respond(response, body.model, '固定证据已读取：6 条 USD 合成观察及预制研究结果。原始观察期是 2026-01-01 至 2026-01-06，软件 fixture 获取记录为 2026-10-28；不能冒充当时已可得。没有执行网络请求，也未检索历史同类样本。'); }
      } else if (role === 'analysis') {
        const evidence = input.research.members.find(item => item.role === 'evidence');
        assert.ok(evidence.source_refs.some(ref => ref.digest === rawRef.digest) && evidence.source_refs.some(ref => ref.digest === resultsRef.digest));
        if (returned.length === 0) call('data_read', { ref: resultsRef });
        else if (returned.length === 1) { assert.deepEqual(returned[0].value.sample.find(row => row.field === 'summary').history, { status: 'pending', note: '同类历史检索未运行；这不是零匹配，也不提供预测概率。' }); call('host_resources_read', { ref: rawRef, part: 'content', entry: 'rows.json' }); }
        else { assert.deepEqual(JSON.parse(returned[1].value.content), rawRows); respond(response, body.model, '合成序列末值高于首值，仅支持此观察区间的描述；不能外推未来方向。解释保留实际观察、一步推理和历史 pending。按用户要求保留自定义观察图与边界说明，删除预制 trend 字段。该结论使用预制 fixture 结果，不宣称执行新分析算法。'); }
      } else {
        assert.deepEqual(input.research.source_refs.map(ref => ref.digest).sort(), [rawRef.digest, resultsRef.digest].sort());
        const last = returned.at(-1);
        if (!last) call('host_reports_describe', {});
        else if (last.name === 'host_reports_describe') {
          assert.equal(last.value.provider.pluginId, 'sesame/reports');
          assert.equal(last.value.inputSchema.type, 'object');
          call('components_show', { target:'report', operation_id:'four-stage-research-publication', title:'DEMO · 用户调整后的 Research', summary:'固定合成观察的有限解释。', provenance_kind:'demo',
            lead:'合成观察的末值高于初值。', highlights:[{label:'初值',value:'100 USD'},{label:'末值',value:'105 USD'}],
            data:[{id:'observations',ref:rawRef,usage:'Fixed fictional observations for the line chart'},{id:'research-results',ref:resultsRef,usage:'Retained precomputed fixture evidence'}], references:[rawRef,resultsRef],
            content:{kind:'document',sections:[{title:'固定观察区间末值较高',blocks:[
              {type:'markdown',text:'合成观察从 100 USD 变为 105 USD，仅描述给定区间。'},
              {type:'chart',kind:'line',title:'合成观察 · USD',data_id:'observations',options:{x:'time',y:'value',unit:'USD'}},
              {type:'paragraph',text:'用户指定：只展示固定观察。同类历史检索未运行；不提供预测概率。'}
            ]}]} });
        }
        else if (last.name === 'components_show') { published = last.value; call('report_check', {ref:published.ref}); }
        else if (last.name === 'report_check') { rendered = last.value; assert.equal(rendered.status, 'rendered', JSON.stringify(rendered)); call('host_runs_read', { runId: input.qa_context.workflow_ref.id }); }
        else { assert.equal(last.name, 'host_runs_read'); bindingRead = last.value.run; assert.deepEqual(bindingRead.report.ref, rendered.artifact); assert.equal(bindingRead.task.output.space, 'research'); assert.equal(bindingRead.task.output.path, reportPath); respond(response, body.model, 'Research 报告已发布并实际渲染，绑定 research-fixture/four-stage-research.html。用户要求的观察图与正文已保留，未增加预测。数据为合成 fixture，历史比较仍 pending。'); }
      }
      return true;
    } catch (error) { failures.push(error.message); respond(response, body.model, 'Fixture assertion failed; stop.'); return true; }
  } });
  try {
    const installed = [];
    for (const [name, base] of [['reports', '../../api-v1/packages/'], ['research', '../../api-v1/packages/'], ['web-sources', '../packages/'], ['investment-research', '../packages/'], ['trading-decision', '../packages/']]) {
      const draft = join(app.runtime.workspaces.root('conv_main'), name + '-four-stage-draft');
      await cp(fileURLToPath(new URL(base + name + '/', import.meta.url)), draft, { recursive: true });
      const checked = await app.runtime.plugins.manager.test('conv_main', { path: draft }); assert.equal(checked.passed, true, JSON.stringify(checked));
      const existing = app.runtime.plugins.entries.get('sesame/' + name);
      if (existing) assert.equal(existing.digest, checked.digest, 'The fixture bundled package must already match the current source; rebuild the host instead of replacing a bundled version');
      else { const result = await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest }); assert.equal(result.runtime_status, 'ready', JSON.stringify(result.diagnostics)); }
      const entry = app.runtime.plugins.entry('sesame/' + name); installed.push({ id: entry.id, version: entry.version, digest: entry.digest });
    }
    const host = createHostContextV2(app.runtime, app.runtime.capabilities.hostEntry, 'conv_main');
    const publishFixture = (operationId, rows, dependencies = []) => app.runtime.contractArtifacts.publish({ id: 'fixture/precomputed-research', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}` }, {
      operationId, manifest: { kind: 'data', schemaVersion: '1.0.0', dependencies,
        content: { format: 'json-rows', path: 'rows.json', rowCount: rows.length, columns: [...new Set(rows.flatMap(Object.keys))], provenance: { kind: 'demo', source_kind: 'synthetic', retrieved_at: '2026-10-28T12:00:00Z', description: 'Precomputed software fixture, not plugin computation or live observations.', references: dependencies } },
        blobs: [{ ...app.runtime.contractArtifacts.blob(JSON.stringify(rows)), path: 'rows.json', mediaType: 'application/json' }],
      },
    });
    rawRef = publishFixture('research-raw-fixture', rawRows);
    const conclusion = '合成观察区间的末值较首值高；不构成未来方向预测。';
    const resultRows = [
      { field:'summary', value:conclusion, evidence_refs:[rawRef], history:{status:'pending',note:'同类历史检索未运行；这不是零匹配，也不提供预测概率。'} },
      { field:'user_note', value:'用户指定：只展示固定观察，不报告预测概率。' },
      { field:'discarded', value:'REMOVED_TREND_MUST_NOT_APPEAR' },
    ];
    resultsRef = publishFixture('research-results-fixture', resultRows, [rawRef]);
    await host.plugins.setEnabled(pluginId, true, { scope: 'session' });
    const directTool = app.runtime.plugins.definitions({ conversationId: 'conv_main' }).find(item => item.name === 'investment_research_start');
    const accepted = (await directTool.execute('four-stage-research-fixture', { ...{ title: 'Four-stage Research integration fixture', question: 'Review only the fixed synthetic observations and existing result rows; honor the user questions and delivery and do not fetch any source.', subjects: ['SYNTHETIC'], as_of: '2026-10-28T12:00:00Z', model: { provider: 'fixture', id: 'fixture' }, research: { plugins: ['sesame/web-sources', 'sesame/data-access', 'sesame/plugin-manager'], tools: ['sesame/web-sources#sources_fetch', 'sesame/data-access#data_read', 'sesame/plugin-manager#plugin_read'] }, evidence_refs: [rawRef, resultsRef], report_brief: brief }, _task: { output: { type: 'report', space: 'research', path: reportPath } } })).details;
    assert.equal(accepted.type, 'run');
    const done = await eventually(() => { assert.deepEqual(failures, []); const run = app.runtime.runs.read(accepted.run.id); assert.notEqual(run.status, 'interrupted', JSON.stringify({ error: run.error, interrupts: run.interrupts })); return run.status === 'completed' ? run : false; }, 90000);
    const children = app.runtime.runs.descendants(done.id).filter(run => run.kind === 'agent');
    assert.deepEqual(children.map(run => run.task.agentId), roles); assert.deepEqual([...observations.keys()], roles);
    assert.deepEqual(done.task.collaboration.agents.map(member => member.id), roles);
    assert.ok(children.every(run => run.parentRunId === done.id && run.status === 'completed'));
    assert.equal(children.filter(run => run.task.output.type === 'report').length, 1);
    assert.deepEqual(children.at(-1).task.output, { type: 'report', target: 'parent' });
    const { readPacket } = await import('../packages/investment-research/src/artifacts.js');
    const packet = await readPacket(host, done.output.result_ref);
    assert.deepEqual(packet.members.map(member => member.role), roles); assert.deepEqual(packet.report_brief, brief);
    assert.deepEqual(packet.source_refs.map(ref => ref.digest).sort(), [rawRef.digest, resultsRef.digest].sort());
    assert.deepEqual(packet.report_ref, done.output.report_ref); assert.deepEqual(done.report.ref, done.output.report_ref);
    const evidence = packet.members.find(member => member.role === 'evidence');
    assert.deepEqual(evidence.source_refs.map(ref => ref.digest).sort(), [rawRef.digest, resultsRef.digest].sort());
    assert.equal(evidence.markdown.includes('sha256:'), false, 'Recorded resource handoff must survive without prose Ref JSON');
    const libraryFile = app.runtime.reportLibrary.find('research', reportPath);
    assert.equal(libraryFile.reportId, done.report.id);
    const artifact = app.runtime.contractArtifacts.read(done.output.report_ref);
    const html = app.runtime.contractArtifacts.resource(done.output.report_ref, 'index.html').bytes.toString('utf8');
    const disk = await readFile(join(app.runtime.reportLibrary.rootOf('research'), reportPath), 'utf8');
    assert.equal(disk, html); assert.equal(artifact.manifest.content.provenance.kind, 'demo');
    assert.ok(artifact.manifest.dependencies.some(ref => ref.digest === rawRef.digest));
    assert.deepEqual(app.runtime.contractArtifacts.reportData(done.output.report_ref, 'research-results').rows, resultRows);
    assert.deepEqual(rendered.checks.map(check => check.width), [1000, 390]);
    assert.match(html, /固定观察区间末值较高/); assert.match(html, /合成观察/);
    assert.equal(published.ref.digest, done.output.report_ref.digest);
    assert.doesNotMatch(html, /REMOVED_TREND_MUST_NOT_APPEAR|data-field="trend"|data-origin=/);
    assert.match(html, /同类历史检索未运行/); assert.match(html, /USD/);
    assert.equal(calls.some(call => ['sources_fetch', 'sources_search', 'http_query'].includes(call.name)), false);
    const fixedAdapterChecks = [];
    for (const name of ['trading-decision']) {
      const adapterHost = createHostContextV2(app.runtime, app.runtime.plugins.entry('sesame/' + name), 'conv_main');
      const { publishWorkflowReport } = await import('../packages/' + name + '/report-publication.js');
      const evidenceBytes = JSON.stringify({ fixture: true, source: rawRef, noNewAnalysis: true });
      let retained;
      const published = await publishWorkflowReport(adapterHost, { operationId: 'fixed-provider-' + name,
        title: 'DEMO · Fixed adapter', summary: 'Real host publication of explicit synthetic content.',
        lead: 'The adapter published the supplied synthetic observation.', highlights: [{ label: 'Observations', value: 1 }],
        content: { kind: 'document', sections: [{ title: '判断', blocks: [{ type: 'paragraph', text: 'Only the supplied synthetic observation is described.' }] }] },
        attachments: [{ path: 'run.json', mediaType: 'application/json', content: evidenceBytes }],
        references: [rawRef], onPublication: value => { retained = value; } });
      assert.deepEqual(retained.ref, published.ref); assert.equal(published.renderStatus, 'rendered');
      const artifact = app.runtime.contractArtifacts.read(published.ref);
      assert.equal(artifact.manifest.content.provenance.kind, 'demo');
      assert.ok(artifact.manifest.dependencies.some(ref => ref.digest === rawRef.digest));
      assert.equal(app.runtime.contractArtifacts.resource(published.ref, 'run.json').bytes.toString('utf8'), evidenceBytes);
      const request = JSON.parse(app.runtime.contractArtifacts.resource(published.ref, 'sesame-report-input.json').bytes.toString('utf8'));
      assert.equal(Object.hasOwn(request.input, 'style'), false, 'Default adapter does not send removed theme/preset controls');
      fixedAdapterChecks.push({ pluginId: 'sesame/' + name, reportRef: published.ref, renderStatus: published.renderStatus, exactEvidenceBytes: true, defaultStyleOmitted: true });
    }
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true });
      const save = (name, value) => writeFile(join(outputDirectory, name), JSON.stringify(value, null, 2) + '\n');
      await writeFile(join(outputDirectory, 'four-stage-research-report.html'), html);
      await save('host-receipt.json', { status: 'passed', checkedAt: new Date().toISOString(), installed, fixtureCalls, fixedAdapterChecks, realModelCalls: 0, sourceNetworkCalls: 0, nativeAgentRuns: children.length, roles, permissions: Object.fromEntries([...observations].map(([role, observation]) => [role, observation.tools])), toolCalls: calls.map(({ role, name }) => ({ role, name })), reportBrief: brief, resultRef: done.output.result_ref, reportRef: done.output.report_ref, reportBinding: { space: 'research', path: reportPath, reportId: done.report.id, fileId: libraryFile.id, exactSourceBytes: true }, evidenceRefs: [rawRef, resultsRef], publication: published, render: rendered, limits: ['Inputs and method-result rows were explicitly precomputed synthetic fixtures, not live sources or new algorithm execution.', 'Local deterministic provider verifies mechanics, not actual model reasoning quality.', 'History remains pending; no matching search or predictive probability is invented.', 'Only the isolated Store and workspace were used. PDF/PNG export was not tested.'] });
      await save('research-packet.json', packet); await save('report-manifest.json', artifact.manifest);
    }
    t.diagnostic('Four actual native Agent Runs with separate permissions; Research method discovery/read; exact evidence handoff; task-specific visual content; Report/Electron Research binding and fixed revision verified.');
  } finally { await app.dispose(); }
});
