// Reproducible FICTIONAL display fixtures, not a market estimator or forecast.
// Only this demo generator computes counts/intervals; report_compose never does.
import { readFileSync, writeFileSync } from 'node:fs';
import { domainFixtures } from './module-domain-fixtures.mjs';
import { technicalFixtures, directionalKnowledgeBasis } from './module-technical-fixtures.mjs';
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('templates/module-catalog.json', root)));
const reference = { id: 'history', revision: 'r1', digest: `sha256:${'a'.repeat(64)}`, kind: 'data', schemaVersion: '1.0.0' };
const domain = domainFixtures(reference);
const round = value => Number(value.toFixed(4));
const date = (year, month, day) => new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
const definitions = [
  { breakout: true, event: true, counts: [26, 8, 6] },
  { breakout: true, event: false, counts: [18, 12, 10] },
  { breakout: false, event: true, counts: [14, 16, 10] },
  { breakout: false, event: false, counts: [14, 16, 10] },
];
const history = definitions.flatMap((group, g) => Array.from({ length: 40 }, (_, i) => {
  const outcome = i < group.counts[0] ? '上涨' : i < group.counts[0] + group.counts[1] ? '震荡' : '下跌';
  return { case_id: `demo-${g * 40 + i + 1}`, scenario: '虚构历史情景', breakout: group.breakout, event: group.event,
    instrument: 'DEMO', started_at: new Date(Date.UTC(2026, 3, i * 4 + g + 1)).toISOString(), settled_at: new Date(Date.UTC(2026, 3, i * 4 + g + 1, 5)).toISOString(),
    horizon: '未来五个 H1 时段', outcome, return_pct: outcome === '上涨' ? round(.6 + i % 7 * .35) : outcome === '下跌' ? round(-.8 - i % 5 * .4) : (i % 2 ? .1 : -.1) };
}));
const subsets = { all: history, breakout: history.filter(row => row.breakout), event: history.filter(row => row.event), joint: history.filter(row => row.breakout && row.event) };
const outcomeCounts = rows => ['上涨', '震荡', '下跌'].map(label => ({ label, count: rows.filter(row => row.outcome === label).length }));
const target = '演示资产的期末方向', horizon = '未来五个 H1 时段';
function basis(which) {
  const rows = subsets[which];
  return { scenario: { breakout: '区间突破特征成立', event: '事件特征成立', joint: '区间突破与事件特征同时成立', all: '全部演示观察' }[which],
    matching_method_ref: `demo/boolean-cohort@1#${which}`, target, horizon,
    window: { start: rows.map(row => row.started_at).sort()[0], end: rows.map(row => row.settled_at).sort().at(-1), as_of: '2026-10-01' },
    sampling: { policy: 'same_instrument_recent_first', subject: 'DEMO', recent_window: { start: '2026-04-01', end: '2026-09-30' }, primary_search: { status: 'matched', eligible_count: rows.length, ref: reference }, selected_scope: 'same_instrument_recent', instruments: ['DEMO'] },
    sample: { matched: rows.length, resolved: rows.length, pending: 0, excluded: 0, effective: rows.length },
    outcomes: outcomeCounts(rows), refs: [reference],
    baseline: { status: 'provided', description: '相同目标和期限的全部 160 次虚构观察，上涨 72 次（45%）。', ref: reference },
    dependence: '每天一个五小时事件，观察窗不重叠；单特征样本有交集，联合情景单独统计。',
    uncertainty: 'Wilson 95% 区间，采用样本独立假设；未校正条件筛选偏差。',
    limitations: ['未按市况分组检查结果稳定性。'] };
}
function confidence(which) {
  const rows = subsets[which], n = rows.length, p = rows.filter(row => row.outcome === '上涨').length / n, z = 1.959963984540054;
  const center = (p + z*z/(2*n))/(1+z*z/n), half = z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n);
  return { definition: '同类情景后上涨的历史比例', estimate: p,
    interval: { lower: round(center-half), upper: round(center+half), level: .95, method_ref: 'demo/wilson-interval@1' } };
}
const validation = { status: 'historical_exploration', note: '样本外验证：未进行。' };
function reasoning(which) {
  const matched=subsets[which], up=matched.filter(row=>row.outcome==='上涨').length;
  return {
    observations:[`${basis(which).scenario}：${matched.length} 次已结算样本中，${up} 次上涨。`,'同期限的全部 160 次观察中，72 次上涨。'],
    steps:[which==='joint'?'按两项条件同时成立筛选，联合结果单独统计。':'只按这项特征筛选，保留其他条件的差异。','比较条件频率与 45% 基准，并检查失败案例和样本重叠。'],
    conclusion:which==='joint'?'联合条件对应较高的历史上涨比例；后续观察其能否延续。':'单项特征的历史优势较弱，不能与其他信号重复计票。',
    history:{status:'linked',note:'DEMO 同品种近期样本；未来五个 H1 时段的期末方向。'},
  };
}
const candles = Array.from({ length: 48 }, (_, i) => {
  const open = 100+i*.18+Math.sin(i*.5)*1.8, close = open+Math.sin(i*.9)*.9;
  return { time: date(2026, 7, i+1), open: open.toFixed(2), high: (Math.max(open,close)+.7).toFixed(2), low: (Math.min(open,close)-.6).toFixed(2), close: close.toFixed(2) };
});
const technical = technicalFixtures(candles, { scenarioValues: domain.values });
const scenario = [
  { id: 'start', parentId: null, label: '突破条件已确认？', condition: '', detail: '以指定方法的固定结果为准' },
  { id: 'yes', parentId: 'start', label: '事件条件同时成立？', condition: '已确认', detail: '两项条件联合样本单独统计' },
  { id: 'wait', parentId: 'start', label: '继续观察区间', condition: '待确认', detail: '观察演示支撑位置' },
  { id: 'joint', parentId: 'yes', label: '观察上方价格路径', condition: '成立', detail: '联合情景历史结果见证据模块' },
  { id: 'only', parentId: 'yes', label: '保留单特征情景', condition: '未成立', detail: '不套用联合样本概率' },
];
const combinedScenario = [
  { id: 'valid', parentId: null, label: '价格仍在 101 之上？', condition: '', detail: '本次综合情景的失效位置' },
  { id: 'invalid', parentId: 'valid', label: '失效情景', condition: '否', detail: '重新评估下方价格路径' },
  { id: 'breakout', parentId: 'valid', label: '突破 110 已确认？', condition: '是', detail: '结合价格与事件的已有研究结果' },
  { id: 'range', parentId: 'breakout', label: '区间情景', condition: '尚未确认', detail: '观察 101–110 区域' },
  { id: 'event', parentId: 'breakout', label: '事件条件成立？', condition: '已确认', detail: '使用同品种近期的对应历史样本' },
  { id: 'joint', parentId: 'event', label: '联合上行情景', condition: '成立', detail: '观察区间上方的价格路径' },
  { id: 'single', parentId: 'event', label: '价格突破情景', condition: '未成立', detail: '跟踪价格突破的持续性' },
  { id: 'pending', parentId: 'event', label: '等待事件确认', condition: '结果未知', detail: '观察事件公布结果' },
];
const sampleRows = {
  'M01.price_chart': candles, 'M02.price_chart': candles, 'M06.event_price_chart': candles,
  'M01.relative_chart': [{ asset: '演示资产', return_pct: 8.2 }, { asset: '参照甲', return_pct: 4.1 }, { asset: '参照乙', return_pct: -2.4 }],
  'M02.scenario_chart': scenario, 'M15.action_chart': combinedScenario,
  'M03.growth_chart': [80,94,110,125].map((revenue,i)=>({period:`202${i+2}`,revenue,operating_cash_flow:[16,20,23,29][i]})),
  'M03.cash_bridge_chart': [{component:'经营现金流',amount:29,role:'start'},{component:'资本开支',amount:-8,role:'delta'},{component:'自由现金流',amount:21,role:'end'}],
  'M04.sensitivity_chart': [2,3,4].flatMap(growth=>[7,8,9].map(discount=>({growth,discount,valuation:round(120+(growth-3)*8-(discount-8)*3)}))),
  'M04.peer_chart': [{company:'目标公司',multiple:17},{company:'可比甲',multiple:21},{company:'可比乙',multiple:15}],
  'M05.revision_chart': [{metric:'当期每股收益',previous:2.4,current:2.7},{metric:'下期每股收益',previous:2.8,current:3.2}],
  'M05.dispersion_chart': Array.from({length:8},(_,i)=>({analyst:`覆盖${i+1}`,dispersion:round(.1+i*.04),estimate:round(2.4+i*.13)})),
  'M06.reaction_chart': Array.from({length:11},(_,i)=>({offset:i-5,current:round((i-5)*.12+Math.sin(i)*.13),comparable:round((i-5)*.08)})),
  'M07.attention_chart': Array.from({length:10},(_,i)=>({date:date(2026,8,i+1),count:[4,6,5,8,15,23,16,11,9,7][i]})),
  'M07.themes_chart': [{theme:'宏观发布',count:24},{theme:'企业经营',count:18},{theme:'资金流动',count:12}],
  'M08.sentiment_chart': Array.from({length:12},(_,i)=>({date:date(2026,8,i+1),sentiment:round(40+i*2+Math.sin(i)*6),baseline:50})),
  'M08.crowding_chart': subsets.breakout.slice(0,30).map((row,i)=>({case_id:row.case_id,crowding:round(.2+i*.02),return_pct:row.return_pct})),
  'M09.term_chart': [7,30,60,90,180].map((days,i)=>({days,implied:[25,23,22,21,20][i],realized:[18,19,19.5,20,20.2][i]})),
  'M09.skew_chart': [80,90,100,110,120].map((strike,i)=>({strike,iv:[30,26,23,24,26][i]})),
  'M10.payoff_chart': Array.from({length:13},(_,i)=>({underlying:80+i*5,net_payoff:Math.min(15,Math.max(0,80+i*5-100))-4})),
  'M10.cost_chart': [{component:'支付权利金',amount:-3.4,role:'start'},{component:'手续费',amount:-.4,role:'delta'},{component:'其他已登记成本',amount:-.2,role:'delta'},{component:'净支出',amount:-4,role:'end'}],
  'M11.ranking_chart': [{candidate:'候选甲',score:72},{candidate:'候选乙',score:64},{candidate:'候选丙',score:58}],
  'M11.tradeoff_chart': [{candidate:'候选甲',risk:8,return_pct:6},{candidate:'候选乙',risk:12,return_pct:8},{candidate:'候选丙',risk:6,return_pct:3}],
  'M12.exposure_chart': [{id:'root',parentId:null,label:'总敞口',value:100,side:'long'},{id:'a',parentId:'root',label:'权益',value:55,side:'long'},{id:'b',parentId:'root',label:'债券',value:30,side:'long'},{id:'c',parentId:'root',label:'商品',value:15,side:'long'}],
  'M12.dependence_chart': ['权益','债券','商品'].flatMap((asset_x,x)=>['权益','债券','商品'].map((asset_y,y)=>({asset_x,asset_y,dependence:[[1,-.2,.35],[-.2,1,.1],[.35,.1,1]][x][y]}))),
  'M13.outcome_chart': [-4,-2,0,2].map(lower=>({lower,upper:lower+2,count:subsets.joint.filter(row=>row.return_pct>=lower&&row.return_pct<lower+2).length})),
  'M13.baseline_chart': outcomeCounts(subsets.joint).map((row,i)=>({outcome:row.label,baseline:outcomeCounts(history)[i].count/history.length,conditional:row.count/subsets.joint.length})),
  'M13.cases_chart': subsets.joint.map(row=>({...row,scenario:'联合情景'})),
  'M14.outlook_chart': outcomeCounts(subsets.joint).map(row=>({outcome:row.label,probability:row.count/subsets.joint.length})),
  'M14.evidence_chart': ['breakout','event','joint'].map(which=>({claim:basis(which).scenario,baseline:confidence('all').estimate,conditional:confidence(which).estimate,n:subsets[which].length,baseline_n:history.length})),
  'M15.monitor_chart': [{indicator:'价格观察线',current:108.2,threshold:110},{indicator:'区间失效线',current:108.2,threshold:101}],
};
// Settled forecasts, frozen before their outcomes, form the demo calibration input.
const forecasts = history.map((row,i)=>({...row,predicted:[.2,.4,.6,.8][i%4],actual:row.outcome==='上涨'?1:0}));
sampleRows['M16.calibration_chart']=[.2,.4,.6,.8].map(predicted=>{const rows=forecasts.filter(row=>row.predicted===predicted);return {predicted,observed:rows.reduce((sum,row)=>sum+row.actual,0)/rows.length,reference:predicted,n:rows.length};});
sampleRows['M16.evaluation_chart']=[0,1,2,3].map(group=>{const rows=forecasts.slice(group*40,(group+1)*40);return {period:`批次${group+1}`,baseline:round(rows.reduce((s,r)=>s+(.45-r.actual)**2,0)/rows.length),model:round(rows.reduce((s,r)=>s+(r.predicted-r.actual)**2,0)/rows.length)};});
const findings = {
 'M01.price_chart': `末次收盘 ${candles.at(-1).close}，高于首期开盘 ${candles[0].open}；期间存在多轮回撤。`,
 'M01.relative_chart': '同区间演示资产上涨 8.2%，参照甲上涨 4.1%，参照乙下跌 2.4%。',
 'M02.price_chart': `价格从近期高点回落至 ${candles.at(-1).close}，关键区域附近的后续变化值得观察。`,
 'M02.scenario_chart': '突破与事件两项条件分别确认；联合情景与单特征情景使用不同的历史样本。',
 'M03.growth_chart': '四个财期收入由 80 增至 125，经营现金流由 16 增至 29。',
 'M03.cash_bridge_chart': '经营现金流 29，扣除资本开支 8 后，自由现金流为 21。',
 'M04.sensitivity_chart': '基准假设估值为 120，九组假设对应 109–131；增长与折现假设共同影响估值。',
 'M04.peer_chart': '目标公司倍数为 17，可比甲为 21，可比乙为 15。',
 'M05.revision_chart': '当期与下期每股收益预期分别从 2.4、2.8 上调至 2.7、3.2。',
 'M05.dispersion_chart': '八个覆盖样本的估计值分布在 2.4–3.31，点开可检查各条原始记录。',
 'M06.event_price_chart': '保留事件观察窗口中的完整价格路径，区分短时冲击与后续回落。',
 'M06.reaction_chart': `事件后第 5 时段，本次累计变化为 ${sampleRows['M06.reaction_chart'].at(-1).current}%，参照路径为 0.4%。`,
 'M07.attention_chart': '消息量由起始的 4 条升至峰值 23 条，随后降至 7 条。',
 'M07.themes_chart': '宏观发布主题 24 条，企业经营 18 条，资金流动 12 条。',
 'M08.sentiment_chart': '情绪序列从参照线下方移至上方，期间仍有明显波动。',
 'M08.crowding_chart': '相近拥挤水平也对应不同的后续收益；单个点不能证明稳定关系。',
 'M09.term_chart': '7 天隐含波动为 25%，180 天为 20%；短期限溢价更明显。',
 'M09.skew_chart': '平值附近隐含波动最低，两侧行权价的隐含波动更高。',
 'M10.payoff_chart': '包含成本后，最大损失为 4、最大收益为 11，盈亏平衡价格为 104。',
 'M10.cost_chart': '权利金支出 3.4 与费用 0.6 合计支出 4，与损益曲线口径一致。',
 'M11.ranking_chart': '按已给定评分，候选甲 72，候选乙 64，候选丙 58。',
 'M11.tradeoff_chart': '候选乙历史收益最高，同时风险指标也最高；候选丙两者均最低。',
 'M12.exposure_chart': '权益占总敞口 55%，债券 30%，商品 15%。',
 'M12.dependence_chart': '权益与商品依赖度为 0.35；权益与债券为 −0.2。',
 'M13.outcome_chart': '40 次联合情景中，26 次上涨、8 次震荡、6 次下跌；分布仍包含负收益。',
 'M13.baseline_chart': '联合情景上涨频率为 65%，全部观察的基准为 45%；这是历史描述统计。',
 'M13.cases_chart': '每个点对应一次已结算联合情景；可以逐次检查正收益、震荡与下跌记录。',
 'M14.outlook_chart': '联合情景的历史结果为上涨 65%、震荡 20%、下跌 15%。',
 'M14.evidence_chart': '突破特征支持率 55%，事件特征 50%，联合情景 65%；联合结果来自单独统计。',
 'M15.action_chart': '先检查失效位置，再按突破与事件条件区分区间、单特征和联合情景。',
 'M15.monitor_chart': '当前观测 108.2，低于上方观察线 110，高于区间失效线 101。',
 'M16.calibration_chart': '各概率组的实际上涨频率接近，预测概率的高低区分度有限。',
 'M16.evaluation_chart': '四个批次中，示例方法的 Brier 分数均高于基准；该指标越低越好。',
};
Object.assign(sampleRows, domain.charts);
Object.assign(findings, domain.findings);
Object.assign(sampleRows, technical.charts);
Object.assign(findings, technical.findings);
// The event chart and its numeric summary share the same actual time window.
sampleRows['M06.reaction_chart'] = Array.from({length:11},(_,i)=>({offset:(i-5)*5,current:round((i-5)*.1+(Math.sin(i)-Math.sin(5))*.13),comparable:round((i-5)*.08)}));
sampleRows['M06.event_price_chart'] = sampleRows['M06.reaction_chart'].map((row,i)=>{
 const close=100*(1+row.current/100),open=i?100*(1+sampleRows['M06.reaction_chart'][i-1].current/100):close-.1;
 return {time:new Date(Date.parse('2026-10-05T12:30:00Z')+row.offset*60000).toISOString(),open:open.toFixed(4),high:(Math.max(open,close)+.1).toFixed(4),low:(Math.min(open,close)-.1).toFixed(4),close:close.toFixed(4)};
});
const eventResult=sampleRows['M06.reaction_chart'].at(-1).current;
findings['M06.reaction_chart']=`公布后 25 分钟，本次累计变化 ${eventResult}%，参照路径为 0.4%。`;
domain.chartSources['M06.reaction_chart']='虚构事件 · 横轴为相对公布时点的分钟数 · 纵轴为相对公布时点价格的变化（%）。';
domain.chartSources['M06.event_price_chart']='虚构事件窗口 · 2026-10-05 12:05–12:55 UTC · 5 分钟 K 线 · USD。';
domain.values['M06.reaction_windows']=[{窗口:'公布后 25 分钟',净变化:`${eventResult}%`,状态:'已结束',参考价:'100 USD',结束:'2026-10-05T12:55:00Z'}];
const rows=[];
for(const module of catalog.modules){
  const firstChart=module.fields.find(field=>field.type==='chart');
  rows.push({section_id:module.id,field:'summary',value:findings[`${module.id}.${firstChart.key}`],method_ref:'demo/fixture-research@1'});
  for(const field of module.fields.filter(field=>field.type==='chart')){
    const key=`${module.id}.${field.key}`;
    if(!sampleRows[key]) throw new Error(`Missing visual fixture: ${key}`);
    const options={...(field.chart.kind==='candlestick'?{unit:'USD'}:{}),...domain.chartOptions[key],...technical.chartOptions[key]};
    if(field.chart.kind==='histogram') Object.assign(options,{sampleCount:subsets.joint.length,method:'演示：等宽 2 个百分点分箱，左闭右开，末箱右闭',unit:'%'});
    if(['M13.baseline_chart','M14.evidence_chart'].includes(key)) options.unit='概率（0–1）';
    const sourceNote=technical.chartSources[key] ?? domain.chartSources[key] ?? (field.chart.kind==='candlestick'?`虚构 DEMO · 日线 · 2026-08-01 至 2026-09-17 · UTC / ${options.unit} · 日期保留原标签。`:field.chart.evidence_role!=='descriptive'?'DEMO 同品种近期虚构事件 · 未来五个 H1 时段 · 结果截点 2026-10-01。':'虚构演示数据；同图序列采用一致的范围与单位，原始值可展开查看。');
    const row={section_id:module.id,field:field.key,value:{rows:sampleRows[key],source_note:sourceNote,takeaway:findings[key],options},method_ref:'demo/fixture-research@1'};
    if(field.chart.evidence_role!=='descriptive') Object.assign(row,{historical_basis:basis(module.id==='M16'||key==='M14.evidence_chart'?'all':'joint'),validation});
    if(key==='M14.evidence_chart') row.value.source_note='突破样本 80 次、事件样本 80 次、联合情景 40 次；共同基准 160 次。样本有交集，不能相加或平均置信度。全部为虚构演示。';
    rows.push(row);
  }
}
rows.push({section_id:'M14',field:'confidence',value:confidence('joint'),method_ref:'demo/conditional-frequency@1',validation,historical_basis:basis('joint')});
rows.push({section_id:'M14',field:'inference_evidence',method_ref:'demo/conditional-frequency@1',value:['breakout','event','joint'].map(which=>({id:which,claim:basis(which).scenario,method_ref:`demo/conditional-frequency@1#${which}`,confidence:confidence(which),historical_basis:basis(which),knowledge_basis:directionalKnowledgeBasis(which),validation,origin:{kind:'inferred',nature:'prediction',note:'虚构示例的研究推断；不是实际市场预测。'},reasoning:reasoning(which)}))});
rows.push({...structuredClone(rows.at(-1)), section_id:'M13'});
rows.push(...domain.specialRows);
for (const [key,value] of Object.entries({...domain.values,...technical.values})) {
  const [section_id, field] = key.split('.');
  if (!catalog.modules.find(module => module.id === section_id)?.fields.some(item => item.key === field)) throw new Error(`Unknown domain fixture ${key}`);
  rows.push({section_id,field,value,method_ref:'demo/fixture-research@1'});
}
for (const module of catalog.modules) {
  rows.push({section_id:module.id,field:'instrument_context',value:{对象:module.id==='M17'?'宏观事件与 DEMO 公司': ['M11','M12','M18','M19'].includes(module.id)?'虚构多资产组合':'DEMO',市场:'虚构演示市场',币种:'USD；另有单位的值单独标注',合约口径:'期权示例乘数 100，其余规模示例乘数 1'},method_ref:'demo/fixture-research@1'});
  rows.push({section_id:module.id,field:'data_times',value:{报告截点:'2026-10-05T13:00:00Z',时区:module.id==='M17'?'America/New_York':'UTC',观察与可得时间:'按各字段中保留的独立示例日期；报价、公布和获取时间不互相替代',数据版本:'虚构示例 v2'},method_ref:'demo/fixture-research@1'});
  rows.push({section_id:module.id,field:'source_scales',value:[{来源:'Sesame 确定性演示数据',原尺度:'各指标随图与字段单独标注',方法版本:'演示 v1',类型:'虚构结果，不是 TC 原厂数据'}],method_ref:'demo/fixture-research@1'});
}
const old=JSON.parse(readFileSync(new URL('examples/module-report-input.json',root)));
old.history_rows=[...forecasts,...domain.optionCases];
for(const row of old.rows){
 if(row.section_id==='M14'&&row.field==='target')row.value['期限']=horizon;
 if(row.section_id==='M13'&&row.field==='feature')row.value['定义']='区间突破与事件条件同时成立';
 if(row.field==='probabilities'){
  row.value.items=outcomeCounts(subsets.joint).map(item=>({label:item.label,probability:item.count/subsets.joint.length}));
  row.validation={status:'unvalidated',note:'样本外验证：未进行。'};row.historical_basis=basis('joint');
 }
 if(row.field==='confidence'){row.value=confidence('joint');row.validation=validation;row.historical_basis=basis('joint');}
 if(row.section_id==='M13'&&row.field==='outcomes')row.value=outcomeCounts(subsets.joint);
}
writeFileSync(new URL('examples/module-report-input.json',root),JSON.stringify(old,null,2)+'\n');
const keys=new Set(rows.map(row=>`${row.section_id}.${row.field}`));
for(const row of old.rows)if(!keys.has(`${row.section_id}.${row.field}`)){rows.push(row);keys.add(`${row.section_id}.${row.field}`);}
rows.push({section_id:'reasoning_example',field:'comparison',method_ref:'demo/reasoning-comparison@1',value:[
  structuredClone(rows.find(row=>row.section_id==='M13'&&row.field==='inference_evidence').value.find(step=>step.id==='joint')),
  {id:'feature_pending',claim:'已有特征是否支持后续方向判断',status:'pending',reason:'尚未完成同品种近期的匹配样本检索。',method_ref:'demo/three-bar-fvg@1',origin:{kind:'inferred',nature:'prediction'},reasoning:{
    observations:['当前观察窗口已有特征记录，尚未提供对应历史结果。'],
    steps:['特征出现说明条件曾成立，尚不能推出未来方向。','历史参照需要对应相同的结果定义与观察期限。'],
    conclusion:'保留待检验判断，暂不给出方向概率。',history:{status:'pending',note:'DEMO 近期同类情景的匹配结果尚未提供。'},
  }},
]});
const visual={provenance:{kind:'demo'},description:'All market values are fictional. Historical counts, frequencies, intervals and evaluation metrics are computed from the included synthetic case rows. Technical features use separate deterministic demo definitions on the same candles; their historical matching remains pending and does not reuse the boolean directional cohorts. Calendar, strategy and portfolio fixtures are deterministic examples, not a live market backtest. Replace reference placeholders with real fixed DataRefs before composition.',title:'内置图表与历史情景证据 · 模板演示',summary:`${Object.keys(sampleRows).length} 个候选图表复用内置组件；展示可调整字段、固定数据与逐项历史依据。`,history_rows:old.history_rows,rows,
  custom_examples:[
    {title:'用户只关心财报和股息',structure:{template_id:'R09',sections:[{module_id:'M17',title:'本周财报与股息',fields:['earnings','dividends']}]}},
    {title:'用户只看历史净值与成本',structure:{template_id:'R10',sections:[{module_id:'M18',title:'历史表现摘要',fields:['equity_chart','costs']}]}},
    {title:'用户自行调整组合呈现',structure:{template_id:'R11',sections:[{module_id:'M19',title:'拟调整的权重',fields:['changes_chart','action_status']}]}},
    {title:'按用户偏好组合 · 研究摘要卡',structure:{sections:[{module_id:'M03',title:'DEMO · 基本面研究摘要',fields:[{key:'factor_results',display:'visible'},'composite_assessment']},{module_id:'M04',title:'价格研究',fields:['model_target','valuation','market_comparison']}] }},
    {title:'判断如何形成 · 历史对照',structure:{sections:[{id:'reasoning_example',title:'判断如何形成 · 历史对照',fields:[{key:'comparison',label:'观察、推导与样本',type:'inferences',meaning:'对照已有历史依据和待检索的两项独立推断，保持各自样本与状态。'}]}]}},
  ]};
writeFileSync(new URL('examples/module-visual-fixtures.json',root),JSON.stringify(visual,null,2)+'\n');
console.log(`Generated ${Object.keys(sampleRows).length} charts, ${rows.length} field results, ${history.length} directional cases and ${domain.optionCases.length} option settlements.`);
