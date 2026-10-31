// Four actual Research Agent Runs, native history calculation and actual report rendering.
// The provider is a deterministic local software fixture, never a real model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const receipts = process.env.SESAME_HISTORICAL_RESEARCH_RECEIPT_DIR;
const roles = ['scope', 'evidence', 'analysis', 'synthesis'];
const text = content => typeof content === 'string' ? content : (content ?? []).map(part => part.text ?? '').join('');
let sequence = 0;
function task(body) {
  for (const message of body.messages.filter(row => row.role === 'user').toReversed()) {
    const value = text(message.content), marker = '\n\nInput JSON:\n', at = value.lastIndexOf(marker);
    if (at >= 0) return JSON.parse(value.slice(at + marker.length));
  }
}
function replies(body) {
  const calls = new Map(body.messages.flatMap(row => row.tool_calls ?? []).map(call => [call.id, call.function.name]));
  return body.messages.filter(row => row.role === 'tool').map(row => ({ name: calls.get(row.tool_call_id), value: JSON.parse(text(row.content)) }));
}
function reply(response, model, content, call) {
  const event = (delta, reason) => JSON.stringify({ id: 'historical-research-fixture', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: reason }] });
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: `history_${++sequence}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { role: 'assistant', content };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${event(delta, null)}\n\ndata: ${event({}, call ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
}

test('Research four-stage workflow carries fixed history inputs, runs independent calibration and publishes actual measured results', { skip: !hostRoot, timeout: 120000 }, async t => {
  process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1,localhost,::1';
  const load = path => import(pathToFileURL(join(hostRoot, path)).href);
  const [{ fixture, eventually }, { createHostContextV2 }] = await Promise.all([load('tests/fixture-provider.js'), load('modules/plugins/host-v2/context.js')]);
  const sections = [{ module_id: 'M01', title: '合成校准结果与适用边界', fields: ['summary'] }];
  const brief = { case: 'custom', sections, adjustments: 'Only the computed synthetic calibration and its conditions; no market prediction or mandatory all-tests-pass conclusion.' };
  let inputRef, sourceRef, resultsRef, delivery, measured, rendered, composed, publish, fixtureCalls = 0;
  const failures = [], calls = [], observations = new Map();
  const app = await fixture({ reportRenderer: 'electron', responseHandler: (body, response) => {
    try {
      const input = task(body);
      if (!input?.role) { reply(response, body.model, 'Local fixture ready.'); return true; }
      fixtureCalls++; const role = input.role, names = body.tools.map(tool => tool.function.name);
      assert.ok(roles.includes(role)); observations.set(role, names);
      assert.deepEqual(input.research.members.map(member => member.role), roles.slice(0, roles.indexOf(role)));
      assert.deepEqual(input.research.evidence_refs, [inputRef]);
      const returned = replies(body), last = returned.at(-1);
      for (const row of returned) assert.ok(!row.value?.isError, JSON.stringify(row));
      const call = (name, args) => { assert.ok(names.includes(name), `${role} cannot call ${name}`); calls.push({ role, name }); reply(response, body.model, null, { name, arguments: args }); };
      if (role === 'scope') {
        assert.equal(names.includes('historical_evidence_from_ref'), false);
        if (!last) call('report_structure', { sections });
        else reply(response, body.model, '用户选择一个结果字段。方法由已冻结计划决定；只处理合成固定输入，不搜索市场。');
      } else if (role === 'evidence') {
        if (!last) call('host_resources_read', { ref: inputRef, part: 'manifest' });
        else { assert.equal(last.value.content.rowCount, 1); assert.deepEqual(last.value.dependencies, [sourceRef]); reply(response, body.model, '单行固定输入包与计划/原预测引用依赖齐全。来源明确为软件合成样本，不是市场证据。'); }
      } else if (role === 'analysis') {
        assert.ok(names.includes('historical_evidence_from_ref'));
        assert.equal(names.includes('report_publish'), false);
        if (!last) call('historical_evidence_from_ref', { operation: 'calibrate', input_ref: inputRef });
        else if (last.name === 'historical_evidence_from_ref') {
          delivery = last.value;
          assert.equal(delivery.summary.groups[0].fit_n, 4);
          call('host_resources_read', { ref: delivery.result_ref, part: 'content', entry: delivery.result_data.path, encoding: 'utf8' });
        } else {
          assert.equal(last.name, 'host_resources_read');
          measured = JSON.parse(last.value.content)[0];
          assert.equal(measured.groups[0].fit.n, 4); assert.equal(measured.groups[0].evaluation.n, 4);
          assert.equal(measured.current_predictions[0].calibrated_probability, .5);
          assert.ok(measured.groups[0].warnings.includes('calibration_did_not_improve_raw_brier'));
          const value = '真实计算的合成评价：原分数 Brier 0.1325，校准后 0.14453125，基线 0.25；校准变差。仅限计划定义的 calm 条件，保留反例、失效条件与后续监测；不是市场预测或所有检验通过的证明。';
          resultsRef = publish('measured-report-result', [{ section_id: 'M01', field: 'summary', status: 'provided', value,
            method_ref: 'sesame/historical-evidence#historical_evidence_calibrate@1.0.0', evidence_refs: [inputRef],
            origin: { kind: 'derived', nature: 'statistic', source: 'Actual native calculation over explicitly synthetic fixed inputs', refs: [inputRef] } }], [inputRef]);
          reply(response, body.model, value);
        }
      } else {
        assert.equal(names.includes('historical_evidence_from_ref'), false, 'Synthesis must consume measured results, not silently refit');
        assert.ok(input.research.source_refs.some(ref => ref.digest === inputRef.digest));
        if (!last) call('report_compose', { output_path: 'history-research.html', title: 'DEMO · 独立时间校准与条件边界', summary: '合成软件验收；校准变差也保留其条件和反例。', structure: { sections }, results_ref: resultsRef });
        else if (last.name === 'report_compose') { composed = last.value; call('report_publish', { ...composed.publish, operation_id: 'history-research-publication', space: 'research' }); }
        else if (last.name === 'report_publish') call('report_check', { ref: last.value.ref });
        else { rendered = last.value; assert.equal(rendered.status, 'rendered', JSON.stringify(rendered)); reply(response, body.model, '固定计算结果已发布并渲染；合成数据和条件边界保留，不宣称真实模型研究质量。'); }
      }
      return true;
    } catch (error) { failures.push(error.message); reply(response, body.model, 'Fixture assertion failed; stop.'); return true; }
  } });
  try {
    const installed = [];
    for (const name of ['historical-evidence', 'investment-research']) {
      const draft = join(app.runtime.workspaces.root('conv_main'), name + '-history-fixture');
      await cp(fileURLToPath(new URL(`../packages/${name}/`, import.meta.url)), draft, { recursive: true });
      const checked = await app.runtime.plugins.manager.test('conv_main', { path: draft }); assert.equal(checked.passed, true, JSON.stringify(checked));
      const result = await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
      assert.equal(result.runtime_status, 'ready', JSON.stringify(result.diagnostics)); installed.push({ id: result.id, digest: checked.digest });
    }
    publish = (operationId, rows, dependencies = []) => app.runtime.contractArtifacts.publish({ id: 'fixture/historical-research', version: '1.0.0', digest: 'sha256:' + 'c'.repeat(64) }, {
      operationId, manifest: { kind: 'data', schemaVersion: '1.0.0', dependencies,
        content: { format: 'json-rows', path: 'rows.json', rowCount: rows.length, columns: Object.keys(rows[0] ?? {}), provenance: { kind: 'demo', source_kind: 'synthetic', description: 'Explicit synthetic fixture; actual plugin arithmetic, deterministic provider.' } },
        blobs: [{ ...app.runtime.contractArtifacts.blob(JSON.stringify(rows)), path: 'rows.json', mediaType: 'application/json' }] } });
    sourceRef = publish('historical-source', [{ synthetic: true }]);
    const data = JSON.parse(await readFile(new URL('../packages/historical-evidence/examples/calibration.json', import.meta.url), 'utf8'));
    data.source_refs = [sourceRef]; data.plan.ref = sourceRef; for (const row of data.records) row.prediction_ref = sourceRef;
    inputRef = publish('historical-input', [data], [sourceRef]);
    const host = createHostContextV2(app.runtime, app.runtime.capabilities.hostEntry, 'conv_main');
    const accepted = await host.capabilities.invoke('sesame/investment-research#investment_research_start', {
      title: 'Synthetic history method integration', question: 'Use only the frozen synthetic calibration input; preserve conditional usefulness, counterevidence and monitoring without a universal pass gate.', subjects: ['SYNTHETIC'], as_of: data.as_of,
      model: { provider: 'fixture', id: 'fixture' }, research: { plugins: ['sesame/historical-evidence'], tools: ['sesame/historical-evidence#historical_evidence_from_ref'] }, evidence_refs: [inputRef], report_brief: brief,
    }, { operationId: 'history-research-four-stages', task: { output: { type: 'report', space: 'research', path: 'history-fixture/calibration.html' } } });
    assert.equal(accepted.type, 'run');
    const run = await eventually(() => { assert.deepEqual(failures, []); const current = app.runtime.runs.read(accepted.run.id); assert.notEqual(current.status, 'interrupted', JSON.stringify(current.error)); assert.notEqual(current.status, 'failed', JSON.stringify(current.error)); return current.status === 'completed' ? current : false; }, 90000);
    const agents = app.runtime.runs.descendants(run.id).filter(row => row.kind === 'agent');
    assert.deepEqual(agents.map(row => row.task.agentId), roles); assert.ok(agents.every(row => row.status === 'completed'));
    const { readPacket } = await import('../packages/investment-research/src/artifacts.js');
    const packet = await readPacket(host, run.output.result_ref);
    assert.ok(packet.members.find(row => row.role === 'analysis').source_refs.some(ref => ref.digest === inputRef.digest));
    assert.deepEqual(packet.report_ref, run.output.report_ref);
    const html = app.runtime.contractArtifacts.resource(run.output.report_ref, 'index.html').bytes.toString('utf8');
    assert.match(html, /0\.14453125/); assert.match(html, /校准变差/); assert.match(html, /条件/);
    assert.deepEqual(rendered.checks.map(row => row.width), [1000, 390]);
    if (receipts) {
      await mkdir(receipts, { recursive: true });
      await writeFile(join(receipts, 'four-stage-host-receipt.json'), JSON.stringify({ status: 'passed', at: new Date().toISOString(), installed, nativeAgentRuns: agents.length, fixtureCalls, realModelCalls: 0, sourceNetworkCalls: 0,
        permissions: Object.fromEntries(observations), calls, inputRef, sourceRef, resultsRef, methodResult: measured, resultRef: run.output.result_ref, reportRef: run.output.report_ref, reportRender: rendered,
        scope: 'Actual native math and actual report rendering on synthetic fixed data; local deterministic provider tests mechanics, not real model reasoning quality.' }, null, 2) + '\n');
      await writeFile(join(receipts, 'four-stage-report.html'), html);
    }
    t.diagnostic('Four real Research Agent Runs; selected fixed-ref history calculation; measured failure retained; actual Report/Electron dual viewport rendering.');
  } finally { await app.dispose(); }
});
