import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyHTML, writeDailyReport } from '../packages/manual-trading/reports.js';
import { resourceFixture } from '../../api-v1/tests/mt5-resource-fixture.js';

function fixture() {
 const host={context:{pluginId:'sesame/manual-trading',pluginVersion:'test',pluginRevision:'sha256:fixture'}}, resources=resourceFixture(host);
 const run={id:'run',planId:'plan',plan:{id:'plan',title:'Observed account fixture',account:{accountId:'fixture'}},status:'failed',createdAt:1,completedAt:2,tasks:[],reports:[],error:{code:'OBSERVED',message:'Observed failure'}};
 return {host,run,...resources};
}
test('a failed publication retries the same frozen evidence after later checkpoint changes',async()=>{
 const f=fixture(),create=f.host.resources.create;let failed=false;
 f.host.resources.create=async(input,options)=>{if(input.name==='report.html'&&!failed){failed=true;throw new Error('Fixture write interrupted');}return create(input,options);};
 const onSnapshot=value=>{f.run.reportSnapshot=value;};
 await assert.rejects(writeDailyReport(f.host,f.run,{onSnapshot}),/Fixture write interrupted/);
 const frozen=structuredClone(f.run.reportSnapshot);f.run.error.message='Later diagnostic';
 const report=await writeDailyReport(f.host,f.run,{onSnapshot});
 const content=JSON.parse((await f.host.resources.read(report.ref,{part:'content',entry:'run.json'})).content);
 assert.deepEqual(content,frozen);assert.equal(f.artifacts.size,1);assert.equal(f.managed.size,3);
});
test('one report artifact contains escaped HTML and immutable evidence without recursive bookkeeping',async()=>{
 const f=fixture();f.run.reports=[{role:'manager',status:'completed',text:'<script>unsafe()</script>'}];f.run.workflow={id:'controller'};f.run.consumedOutputs=['source:target'];
 const report=await writeDailyReport(f.host,f.run);const manifest=await f.host.resources.read(report.ref,{part:'manifest'});
 assert.equal(manifest.kind,'report');assert.deepEqual(manifest.blobs.map(blob=>blob.path),['run.json','report.html']);
 const snapshot=JSON.parse((await f.host.resources.read(report.ref,{part:'content',entry:'run.json'})).content);
 assert.equal(snapshot.workflow,undefined);assert.equal(snapshot.reportSnapshot,undefined);assert.equal(snapshot.consumedOutputs,undefined);
 const html=(await f.host.resources.read(report.ref,{part:'content',entry:'report.html'})).content;assert.ok(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));
 f.run.report=report;f.host.resources.create=()=>assert.fail('Reading a delivered report must not create files');f.host.resources.publish=()=>assert.fail('Reading a delivered report must not republish');
 assert.deepEqual(await writeDailyReport(f.host,f.run),report);
});

test('the final report renders the manager summary once and keeps member reports only in frozen evidence', async () => {
  const f = fixture();
  f.run.plan.purpose = 'analysis';
  f.run.status = 'completed';
  f.run.summary = [
    '# XAUUSD 研究结论',
    '',
    '## 观察条件',
    '',
    '**等待确认**，保留 `H1` 的观察窗口。',
    '',
    '> 已核验资料，仍需等待下一根收盘。',
    '',
    '- 条件一',
    '  - 子条件',
    '- 条件二',
    '',
    '| 周期 | 事实 |',
    '| --- | --- |',
    '| H1 | **尚未确认** |',
    '',
    '[官方来源](https://example.org/evidence?x=1&y=2 "日程")',
    '',
    '```js',
    'const boundary = "<sample>";',
    '```',
  ].join('\n');
  f.run.reports = [
    { role: 'market', status: 'completed', text: '### 市场证据\n\n**两项观察**\n\n1. 保留来源\n2. 等待条件' },
    { role: 'manager', status: 'completed', text: f.run.summary },
  ];
  f.run.snapshot = { summary: { privateAccountSnapshot: 123 }, positions: [{ symbol: 'POSITION_ONLY_IN_EVIDENCE' }] };
  f.run.evidence = [{ datasetId: 'source-1', capturedAt: '2026-10-17T00:00:00Z', digest: 'sha256:fixed', dataset: { rows: [{ value: 1 }] } }];
  const expected = structuredClone(f.run);
  const report = await writeDailyReport(f.host, f.run);
  const html = (await f.host.resources.read(report.ref, { part: 'content', entry: 'report.html' })).content;
  assert.match(html, /<h1>XAUUSD 研究结论<\/h1>/);
  assert.match(html, /<h2>观察条件<\/h2>/);
  assert.match(html, /<strong>等待确认<\/strong>/);
  assert.match(html, /<code>H1<\/code>/);
  assert.match(html, /<blockquote>\s*<p>已核验资料/);
  assert.match(html, /<li>条件一\s*<ul>\s*<li>子条件<\/li>/);
  assert.match(html, /<th>周期<\/th>/);
  assert.match(html, /<td><strong>尚未确认<\/strong><\/td>/);
  assert.match(html, /href="https:\/\/example\.org\/evidence\?x=1&amp;y=2"/);
  assert.match(html, /<pre><code class="language-js">const boundary = &quot;&lt;sample&gt;&quot;;/);
  assert.equal((html.match(/<h1>XAUUSD 研究结论<\/h1>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /市场证据|两项观察|团队报告与分歧|账户与原始持仓|privateAccountSnapshot|POSITION_ONLY_IN_EVIDENCE|研究证据索引|运行状态/);
  assert.doesNotMatch(html, /<pre>#/);
  assert.equal((await f.host.resources.read(report.ref, { part: 'content', entry: 'analysis.md' })).content, expected.summary);
  assert.deepEqual(JSON.parse((await f.host.resources.read(report.ref, { part: 'content', entry: 'run.json' })).content), expected);
  assert.deepEqual(f.run, expected, 'Rendering must never rewrite the source evidence or Markdown');
});

test('agent-authored report Markdown cannot execute HTML or load unbundled resources', () => {
  const f = fixture();
  f.run.plan.purpose = 'analysis';
  f.run.summary = '<script>unsafe()</script>\n\n<img src="x" onerror="unsafe()">\n\n[unsafe](javascript:alert%281%29)\n\n![remote](https://example.org/tracker.png)\n\n[safe](https://example.org/source)\n\n<iframe src="https://example.org"></iframe>';
  f.run.reports = [{ role: 'news', text: '<iframe src="https://example.org"></iframe>\n\n[credentials](https://user:password@example.org/private)' }];
  const html = dailyHTML(f.run);
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.match(html, /&lt;iframe/);
  assert.match(html, /href="https:\/\/example\.org\/source"/);
  assert.doesNotMatch(html, /<(?:script|img|iframe)\b/i);
  assert.doesNotMatch(html, /href="(?:javascript:|https:\/\/user:password@)/i);
});

test('trading reports use the last completed manager summary without appending execution or account records', async () => {
  const f = fixture();
  f.run.reports = [
    { role: 'manager', status: 'completed', text: 'Earlier manager result' },
    { role: 'manager', status: 'completed', text: '# 最终经理总结\n\n保留 **当前仓位**。' },
    { role: 'executor', status: 'completed', text: 'EXECUTION_RECEIPT' },
    { role: 'manager', status: 'interrupted', text: 'INCOMPLETE_MANAGER_RESULT' },
  ];
  f.run.decision = { rationale: 'INTERNAL_TARGET_REASON', targets: [{ symbol: 'RAW_TARGET' }] };
  f.run.execution = { status: 'unchanged', privateReceipt: 'RAW_EXECUTION' };
  const expected = structuredClone(f.run);
  const report = await writeDailyReport(f.host, f.run);
  const html = (await f.host.resources.read(report.ref, { part: 'content', entry: 'report.html' })).content;
  assert.match(html, /<h1>最终经理总结<\/h1>/);
  assert.match(html, /<strong>当前仓位<\/strong>/);
  assert.doesNotMatch(html, /Earlier manager result|EXECUTION_RECEIPT|INCOMPLETE_MANAGER_RESULT|INTERNAL_TARGET_REASON|RAW_TARGET|RAW_EXECUTION/);
  assert.deepEqual(JSON.parse((await f.host.resources.read(report.ref, { part: 'content', entry: 'run.json' })).content), expected);
});

test('without a completed manager summary the report does not substitute another role or diagnostic', () => {
  const f = fixture();
  f.run.reports = [{ role: 'market', status: 'completed', text: 'ANALYST_RESULT' }, { role: 'manager', status: 'interrupted', text: 'PARTIAL_MANAGER' }];
  f.run.error = { message: 'INTERNAL_DIAGNOSTIC' };
  const html = dailyHTML(f.run);
  assert.match(html, /经理尚未形成最终总结/);
  assert.doesNotMatch(html, /ANALYST_RESULT|PARTIAL_MANAGER|INTERNAL_DIAGNOSTIC/);
});
