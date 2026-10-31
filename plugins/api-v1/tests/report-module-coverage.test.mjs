import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveStructure, bindResults } from '../packages/reports/report-structure.js';
import { renderComposedReport } from '../packages/reports/report-compose.js';

const fixture = JSON.parse(readFileSync(new URL('../packages/reports/examples/module-visual-fixtures.json', import.meta.url)));
const row = (module, field) => fixture.rows.find(item => item.section_id === module && item.field === field);
const value = (module, field) => row(module, field).value;
const render = (structure, rows = fixture.rows) => renderComposedReport({ title: 'Coverage demo', structure, bound: bindResults(structure, rows), data: [], references: [], demo: true });

test('calendar, strategy backtest and portfolio construction have distinct optional fields and usable examples', () => {
  const representative = { M17: ['events','economic_releases','earnings','dividends','splits','meetings'], M18: ['simulation','window','metrics','benchmark','costs','validation'], M19: ['target_weights','changes','weighting_rules','rebalance','action_status'] };
  for (const [id, names] of Object.entries(representative)) {
    const structure = resolveStructure({ template_id: id });
    const section = structure.sections[0];
    assert.ok(names.every(name => section.fields.some(field => field.key === name)));
    assert.ok(section.fields.every(field => !field.required));
    assert.deepEqual(section.method_refs, []);
    assert.ok(bindResults(structure, fixture.rows).sections[0].fields.every(field => field.result.status === 'provided'), `${id}: every suggested field has a concrete demo result`);
  }
  for (const module of resolveStructure().modules) {
    for (const key of ['instrument_context','data_times','source_scales']) assert.ok(row(module.id,key));
  }
});

test('custom task fields replace the new defaults and accept an independently chosen method', () => {
  for (const demo of fixture.custom_examples) {
    const resolved = resolveStructure(demo.structure);
    for (const [i,section] of demo.structure.sections.entries()) assert.deepEqual(resolved.sections[i].fields.map(field => field.key), section.fields.map(field => typeof field === 'string' ? field : field.key));
    assert.equal(bindResults(resolved, fixture.rows).completeness.status, 'complete');
  }
  const selected = resolveStructure({template_id:'R11',sections:[{module_id:'M19',method_refs:['user/own-allocation-theory@7'],fields:['target_weights']}]});
  const supplied = {...row('M19','target_weights'),method_ref:'user/own-allocation-theory@7'};
  assert.equal(bindResults(selected,[supplied]).completeness.status,'complete');
  assert.doesNotMatch(render(selected,[supplied]), /建议权重调整|再平衡安排|策略与基准净值/);
  assert.deepEqual(resolveStructure({template_id:'R09',sections:[]}).sections,[]);
});

test('valuation, model target, analyst target and sentiment evidence volume keep different meanings', () => {
  assert.notEqual(value('M04','valuation')['公允价值'],value('M04','model_target')['目标价']);
  assert.notEqual(value('M04','model_target')['目标价'],value('M05','target_prices')['均值']);
  assert.equal(value('M05','ratings_chart').rows.reduce((n, r) => n + r.count,0),value('M05','analyst_count'));
  const selected = resolveStructure({sections:[{module_id:'M08',fields:['evidence_volume','subjectivity','fear_index']}]});
  assert.ok(selected.sections[0].fields.every(field => field.type === 'object'));
  assert.equal(bindResults(selected,fixture.rows).completeness.status,'complete');
  const priceGrid = value('M04','sensitivity_chart').rows;
  assert.equal(priceGrid.find(r => r.growth === 3 && r.discount === 8).valuation,120);
});

test('calendar schedules distinguish known future times from unknown future results', () => {
  const events = value('M17','timeline_chart').rows, counts = value('M17','calendar_chart').rows;
  assert.equal(events.length,counts.reduce((n,r) => n+r.count,0));
  assert.equal(counts.find(r => r.date === '2026-10-07').count,2);
  assert.equal(counts.find(r => r.date === '2026-10-11').count,0);
  assert.equal(value('M17','economic_releases').find(r => r['事件'] === '利率决议')['实际'],null);
  assert.equal(value('M17','earnings')[0]['EPS实际'],null);
  const cutoff=Date.parse('2026-10-05T13:00:00Z');
  assert.ok(events.filter(r=>Date.parse(r.time)>cutoff).every(r=>r.state!=='已公布'));
  assert.equal(value('M17','timeline_chart').options.timezone,'America/New_York');
});

test('strategy performance and drawdown summaries reconcile to the same frozen paths', () => {
  const curve=value('M18','equity_chart').rows, drawdowns=value('M18','drawdown_chart').rows;
  assert.deepEqual(curve,drawdowns);
  assert.equal(curve[0].strategy,1);assert.equal(curve[0].benchmark,1);
  let peak=1;
  for(const point of curve){peak=Math.max(peak,point.strategy);assert.ok(Math.abs(point.strategy_drawdown-(point.strategy/peak-1)*100)<.02);}
  const metrics=value('M18','metrics');
  assert.ok(Math.abs(metrics.find(r=>r['指标']==='累计净收益')['数值']-(curve.at(-1).strategy-1)*100)<.0001);
  assert.equal(metrics.find(r=>r['指标']==='最大月度观测回撤')['数值'],Math.abs(Math.min(...curve.map(r=>r.strategy_drawdown))));
  assert.ok(value('M18','costs')['十二个月金额']>0);
});

test('strategy visual candidates retain complete trial selection, failure state and cost reconciliation', () => {
  const trials=value('M18','parameter_trials'), grid=value('M18','market_matrix_chart').rows;
  assert.equal(trials.length,25);assert.equal(new Set(trials.map(row=>row.trial_id)).size,trials.length);
  for (const winner of grid.filter(row=>row.selected)) {
    const peers=trials.filter(row=>row.symbol===winner.symbol&&row.timeframe===winner.timeframe&&row.status==='completed');
    assert.equal(winner.net_return,Math.max(...peers.map(row=>row.net_return)));
    assert.equal(peers.filter(row=>row.selected).length,1);
  }
  assert.equal(grid.find(row=>row.status==='failed').net_return,null);
  const sensitivity=value('M18','parameter_sensitivity_chart').rows;
  assert.equal(new Set(sensitivity.map(row=>row.threshold)).size,1);
  assert.ok(sensitivity.every(row=>trials.some(trial=>trial.trial_id===row.trial_id)));
  const bridge=value('M18','pnl_chart').rows;
  assert.ok(Math.abs(bridge[0].amount+bridge[1].amount-bridge[2].amount)<.0001);
  assert.ok(Math.abs(bridge[2].amount-(value('M18','equity_chart').rows.at(-1).strategy-1)*100000)<.001);
  const periods=value('M18','validation_chart').rows;
  assert.equal(periods[0].end,periods[1].start);assert.equal(periods.reduce((n,row)=>n+row.months,0),12);
  assert.match(value('M18','funnel_chart').source_note,/独立虚构/);
});

test('weight changes and stop sizing reconcile without claiming an executed trade', () => {
  const weights=value('M19','weights_chart').rows,changes=value('M19','changes_chart').rows;
  assert.equal(weights.reduce((n,r)=>n+r.current,0),100);
  assert.equal(weights.reduce((n,r)=>n+r.target,0),100);
  for(const weight of weights)assert.equal(changes.find(r=>r.asset===weight.asset).change,weight.target-weight.current);
  assert.equal(changes.reduce((n,r)=>n+r.change,0),0);
  assert.match(value('M19','action_status'),/未安排或执行/);
  for(const result of value('M12','stop_chart').rows)assert.equal(result.distance*result.quantity,result.risk_cash);
});

test('option probability uses its own realized net-payoff cases, not the directional cohort or sentiment score', () => {
  const probability=row('M10','profit_probability'),cases=fixture.history_rows.filter(r=>r.fixture_kind==='option_expiry');
  assert.equal(cases.length,6);
  for(const result of cases)assert.equal(result.net_payoff,Math.min(15,Math.max(0,result.terminal-100))-4);
  assert.equal(probability.value,cases.filter(r=>r.net_payoff>0).length/cases.length);
  assert.equal(probability.historical_basis.sample.resolved,cases.length);
  assert.equal(probability.historical_basis.target,'到期净损益大于零');
  const selected=resolveStructure({sections:[{module_id:'M10',fields:['profit_probability']}]});
  assert.equal(bindResults(selected,[probability]).completeness.status,'complete');
  const missing=structuredClone(probability);delete missing.historical_basis;
  assert.throws(()=>bindResults(selected,[missing]),/historical_basis/);
  const payoff=value('M10','payoff_chart').rows;
  assert.equal(Math.min(...payoff.map(r=>r.net_payoff)),-4);assert.equal(Math.max(...payoff.map(r=>r.net_payoff)),11);
});

test('business record tables preserve zero, false, missing values and hostile text without executing it', () => {
  const selected=resolveStructure({sections:[{id:'records',title:'User records',fields:[{key:'rows',label:'Schedule',type:'array',meaning:'User-defined records'}]}]});
  const rows=[{section_id:'records',field:'rows',value:[{label:'<script>alert(1)</script>',count:0,actual:null,confirmed:false}]}];
  const html=render(selected,rows);
  assert.match(html,/module-record-table/);assert.match(html,/scope="col"/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>alert/);
  assert.match(html,/<td>0<\/td>/);assert.match(html,/<td>否<\/td>/);assert.match(html,/<td><span>—<\/span><\/td>/);
});
