import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderReport } from '../report.js';

const fixture = JSON.parse(await readFile(new URL('../examples/demo-run.json', import.meta.url), 'utf8'));

test('final report retains trial evidence, selection, lineage, reflections and all events', () => {
  const html = renderReport(fixture, { demo: true });
  assert.equal((html.match(/data-trial-row="\d+"/g) || []).length, fixture.trials.length);
  assert.equal((html.match(/data-trial-detail="\d+"/g) || []).length, fixture.trials.length);
  assert.equal((html.match(/data-event="\d+"/g) || []).length, fixture.events.length);
  assert.equal((html.match(/class="round"/g) || []).length, fixture.config.rounds);
  assert.match(html, /演示数据 · SIMULATED/);
  assert.match(html, /研究总结/);
  assert.match(html, /协作记录/);
  assert.match(html, /F-004 ← F-001/);
  assert.match(html, /冻结时间/);
  assert.match(html, /0\.036/);
  assert.match(html, /6\.10%/);
  for (const id of fixture.selection.trialIds) assert.ok(html.includes(id));
  for (const reflection of fixture.reflections) assert.ok(html.includes(reflection.summary));
  const timeline = html.match(/<ol class="events">([\s\S]*?)<\/ol>/)?.[1];
  assert.ok(timeline);
  assert.doesNotMatch(timeline, /\bhidden\b/);
  assert.deepEqual([...timeline.matchAll(/<time>([^<]+)<\/time>/g)].map(match => match[1]),
    fixture.events.map(event => event.at.replace('T', ' ').replace(/Z$/, ' UTC')));
});

test('final report has no playback controls, simulated activity or event timers', () => {
  const html = renderReport(fixture);
  assert.doesNotMatch(html, /播放|回放|协作快照|当前阶段|replay|play-events|event-cursor|event-progress|type="range"/i);
  assert.doesNotMatch(html, /setInterval\(|setTimeout\(|requestAnimationFrame\(|EventSource\(|WebSocket\(/);
  assert.match(html, /id="status-filter"/);
  assert.match(html, /id="direction-filter"/);
  assert.match(html, /data-open-trial="0"/);
});

test('all supplied text is escaped and the embedded snapshot cannot break out of script', () => {
  const attack = '</script><img src=x onerror="globalThis.pwned=1"><script>\u2028&';
  const run = structuredClone(fixture);
  run.title = attack; run.goal = attack; run.id = attack;
  run.config.directions = [attack]; run.config.agentModels.supervisor.id = attack;
  run.trials[0].id = attack; run.trials[0].hypothesis = attack;
  run.trials[0].direction = attack; run.trials[0].expression = attack;
  run.trials[0].review.reason = attack; run.events[0].message = attack;
  const html = renderReport(run);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes(attack));
  assert.match(html, /&lt;\/script&gt;&lt;img src=x onerror=&quot;/);
  assert.equal((html.match(/<script\b/g) || []).length, 2);
  const embedded = html.match(/<script type="application\/json" id="run-snapshot">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(embedded);
  assert.ok(!/[<>&\u2028\u2029]/.test(embedded));
  assert.deepEqual(JSON.parse(embedded), run);
});

test('report is offline and has no host actions or external assets', () => {
  const html = renderReport(fixture);
  assert.doesNotMatch(html, /<(?:script|img|iframe)\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link\b[^>]*\bhref\s*=/i);
  assert.doesNotMatch(html, /(?:fetch\(|XMLHttpRequest|WebSocket\(|@import|url\(\s*['"]?https?:)/i);
  assert.doesNotMatch(html, /演示数据 · SIMULATED/);
  assert.match(html, /max-width:530px/);
  assert.match(html, /prefers-reduced-motion/);
  assert.ok(Buffer.byteLength(html, 'utf8') < 128 * 1024);
});

test('empty, interrupted and unselected runs do not invent evidence', () => {
  const html = renderReport({ id: 'empty', status: 'interrupted', error: 'Task interrupted' });
  assert.match(html, /已中断/);
  assert.match(html, /Task interrupted/);
  assert.match(html, /未冻结/);
  assert.match(html, /暂无匹配的试验/);
  assert.match(html, /尚无协作事件/);
  assert.doesNotMatch(html, /data-trial-row="0"/);
  assert.doesNotMatch(html, /0\.000/);
});

test('rendering preserves original run and rejects an invalid root', () => {
  const before = JSON.stringify(fixture);
  renderReport(fixture);
  assert.equal(JSON.stringify(fixture), before);
  for (const value of [null, undefined, 'text', []]) assert.throws(() => renderReport(value), TypeError);
});

test('deterministic rejection overrides an agent acceptance, with diagnostics retained', () => {
  const run = structuredClone(fixture);
  run.trials = [run.trials[0]];
  run.trials[0].round = 0;
  run.round = 0;
  run.reflections = [];
  run.trials[0].status = 'rejected';
  run.trials[0].eligible = false;
  run.trials[0].gate = 'rankIC threshold not met';
  run.trials[0].metrics.protocol = { rankICIR: 'not-annualized' };
  run.trials[0].metrics.limitations = ['diagnostic research baseline'];
  const html = renderReport(run);
  assert.match(html, /确定性门槛未通过/);
  assert.match(html, /rankIC threshold not met/);
  assert.match(html, /not-annualized/);
  assert.match(html, /diagnostic research baseline/);
  assert.match(html, /<dt>已接纳 \/ 已淘汰<\/dt><dd>0<small>\/ 1/);
  assert.match(html, /<dt>研究轮次<\/dt><dd>1<small>/);
  assert.match(html, /<span>ROUND<\/span><strong>01/);
});

function evaluatorRun() {
  const run = structuredClone(fixture);
  run.config.evaluator = { plugin_id: 'sesame/factor-evaluator', tool: 'factor_evaluate' };
  run.trials = [run.trials[0]];
  const trial = run.trials[0];
  trial.eligible = true;
  trial.gate = 'validation threshold passed; not proof of tradability';
  trial.rationale = '完整研究依据：保留数据限制、反证和样本诊断。'.repeat(40);
  trial.evaluationReceipt = { receiptDigest: 'sha256:fixture-evaluation-receipt' };
  trial.metrics.protocol = { horizon: 1, costBps: 10 };
  trial.metrics.limitations = ['Positive rank IC does not establish profitability.'];
  run.selection = { trialIds: [trial.id], digest: 'sha256:fixture-frozen-selection', reason: '完整选择理由：候选通过冻结门槛不代表可交易，不隐藏负面证据。'.repeat(40) };
  run.data.holdoutMode = 'restricted';
  run.finalEvaluation = { holdoutStatus: 'evaluated' };
  run.holdout = { [trial.id]: { rankIC: 0, netReturn: -0.0039837604307270125, validICPeriods: 2 } };
  return run;
}

function disclosure(html, summary) {
  const match = [...html.matchAll(/<details([^>]*)><summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/g)].find(value => value[2] === summary);
  assert.ok(match, `Missing disclosure: ${summary}`);
  return { markup: match[0], attributes: match[1], content: match[3] };
}

test('evaluator calculation and frozen final receipts start folded with complete numerical evidence', () => {
  const run = evaluatorRun(), html = renderReport(run);
  const computed = disclosure(html, '选中评估能力的计算结果');
  const final = disclosure(html, '冻结后的最终评估回执');
  for (const value of [computed, final]) assert.doesNotMatch(value.attributes, /\bopen\b/);
  assert.ok(computed.content.includes('&quot;rankIC&quot;: 0.041'));
  assert.ok(computed.content.includes('&quot;costBps&quot;: 10'));
  assert.ok(computed.content.includes('Positive rank IC does not establish profitability.'));
  assert.ok(final.content.includes('&quot;netReturn&quot;: -0.0039837604307270125'));
  assert.ok(final.content.includes('&quot;validICPeriods&quot;: 2'));
});

test('long research and selection prose starts folded while outcome, candidates and deterministic gate remain visible', () => {
  const run = evaluatorRun(), html = renderReport(run);
  const rationale = disclosure(html, '研究依据与限制');
  const selection = disclosure(html, '完整选择理由');
  for (const value of [rationale, selection]) assert.doesNotMatch(value.attributes, /\bopen\b/);
  assert.ok(rationale.content.includes(run.trials[0].rationale));
  assert.ok(selection.content.includes(run.selection.reason));
  const overview = html.replace(rationale.markup, '').replace(selection.markup, '')
    .replace(disclosure(html, '选中评估能力的计算结果').markup, '').replace(disclosure(html, '冻结后的最终评估回执').markup, '');
  assert.match(overview, /<span class="status positive">已接纳<\/span>/);
  assert.ok(overview.includes(`<p class="mono">${run.trials[0].id}</p>`));
  assert.match(overview, /<strong>确定性门槛已通过：<\/strong>validation threshold passed; not proof of tradability/);
  const short = structuredClone(run);
  short.trials[0].rationale = '短研究说明。'; short.selection.reason = '短选择说明。';
  const compact = renderReport(short);
  assert.match(compact, /<p class="rationale">短研究说明。<\/p>/);
  assert.match(compact, /<p>短选择说明。<\/p>/);
  assert.doesNotMatch(compact, /<summary>研究依据与限制<\/summary>|<summary>完整选择理由<\/summary>/);
});

test('folded evaluator evidence is fully escaped and preserves the exact source snapshot without mutation', () => {
  const run = evaluatorRun(), attack = '</details><script>globalThis.pwned=1</script><img src=x onerror="pwned()">&\u2028';
  run.trials[0].rationale += attack; run.selection.reason += attack;
  run.trials[0].metrics.limitations.push(attack); run.holdout[run.trials[0].id].note = attack;
  const before = JSON.stringify(run), html = renderReport(run);
  assert.equal(JSON.stringify(run), before);
  assert.ok(!html.includes(attack)); assert.ok(!html.includes('<img src=x'));
  assert.equal((html.match(/<script\b/g) || []).length, 2);
  for (const summary of ['研究依据与限制', '完整选择理由', '选中评估能力的计算结果', '冻结后的最终评估回执']) {
    assert.match(disclosure(html, summary).content, /&lt;\/details&gt;&lt;script&gt;globalThis.pwned=1&lt;\/script&gt;/);
  }
  const embedded = html.match(/<script type="application\/json" id="run-snapshot">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(embedded); assert.ok(!/[<>&\u2028\u2029]/.test(embedded));
  assert.deepEqual(JSON.parse(embedded), run);
});

test('evaluator empty selections and unfinished or unused holdouts do not acquire final evidence', () => {
  const unfrozen = evaluatorRun(); unfrozen.selection = null;
  const unselected = renderReport(unfrozen);
  assert.match(unselected, /未记录最终选择/); assert.match(unselected, /无留出集证据/);
  assert.doesNotMatch(unselected, /<summary>冻结后的最终评估回执<\/summary>/);
  for (const ids of [[], ['F-001']]) {
    const pending = evaluatorRun(); pending.selection.trialIds = ids;
    pending.status = 'interrupted'; pending.finalEvaluation = { holdoutStatus: 'pending' };
    const html = renderReport(pending);
    assert.ok(html.includes(`<h3>${ids.length} 个最终候选</h3>`));
    assert.match(html, /最终评估尚未完成，没有留出检验结论/);
    assert.doesNotMatch(html, /<summary>冻结后的最终评估回执<\/summary>/);
  }
  const unused = evaluatorRun(); unused.data.holdoutMode = 'none';
  const html = renderReport(unused);
  assert.match(html, /本次仅使用开发集，未执行留出检验/);
  assert.doesNotMatch(html, /<summary>冻结后的最终评估回执<\/summary>/);
});
