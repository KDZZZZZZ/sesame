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
