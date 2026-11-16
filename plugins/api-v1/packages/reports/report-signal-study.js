// Presentation only: project recorded evaluator results, never fit a model,
// infer returns, fill missing values or turn a diagnostic into a probability.
import { renderJudgments } from './report-evidence.js';
import { factorLogic, renderLogicDiagram } from './report-logic.js';
import { renderText } from './report-text.js';
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const n = (value, digits = 3) => finite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value) : '—';
const pct = value => finite(value) ? `${value > 0 ? '+' : ''}${n(value * 100, 2)}%` : '—';
const json = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const verdict = trial => trial.review?.verdict ?? trial.status;
const names = { conditional: '继续观察', accept: '继续观察', accepted: '继续观察', reject: '暂不采用', rejected: '暂不采用', failed: '未完成' };
const label = (trial, index) => String(trial.name ?? trial.hypothesis?.split(/[：:]/)[0] ?? `候选 ${index + 1}`);
const conditions = value => ['valid_when', 'invalid_when', 'stop_when'].flatMap(key => {
  const values = arr(value?.[key]);
  return values.length ? [`<div>${renderText({ valid_when: '什么时候可以参考', invalid_when: '什么时候可能不管用', stop_when: '什么时候停止使用' }[key], { role: 'title', tag: 'h3' })}${values.map(text => renderText(text, { role: 'body' })).join('')}</div>`] : [];
}).join('');
const chartHost = (id, title) => `<figure class="kit-chart"><figcaption class="kit-chart-head">${renderText(title, { role: 'title', tag: 'strong' })}</figcaption><div id="${id}"></div></figure>`;
const date = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value)) ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const periodDetail = row => [row.period,
  row.start ? `起点 ${row.start}` : row.startExclusive ? `晚于 ${row.startExclusive}（不含）` : row.dataStart ? `数据起点 ${row.dataStart}` : '起点未记录',
  row.end ? `截至 ${row.end}` : '终点未记录',
  row.labelObservations !== null ? `标签样本 ${row.labelObservations}` : '',
  row.observations !== null ? `样本 ${row.observations}` : '',
  row.periods !== null ? `组合期 ${row.periods}` : '',
].filter(Boolean).join(' · ');

export function renderSignalStudy(run, { demo = false, presentation = {} } = {}) {
  const periodLabels = presentation.period_labels === undefined ? {} : presentation.period_labels;
  if (!periodLabels || typeof periodLabels !== 'object' || Array.isArray(periodLabels) || Object.entries(periodLabels).some(([key, value]) => !['train', 'validation', 'holdout'].includes(key) || typeof value !== 'string' || !value.trim() || value.length > 200)) throw new Error('Period labels need train, validation or holdout text up to 200 characters');
  const judgments = presentation.judgments === undefined ? '' : renderJudgments(presentation.judgments);
  const evidence = `<script type="application/json" id="run-snapshot">${json(run)}</script>`;
  const trials = arr(run.trials), selected = arr(run.selection?.trialIds);
  if (presentation.logic !== undefined && (!presentation.logic || typeof presentation.logic !== 'object' || Array.isArray(presentation.logic) || Object.keys(presentation.logic).some(id => !trials.some(trial => trial.id === id)))) throw Error('Logic diagrams must name recorded trial IDs');
  const logicDiagrams = trials.map(trial => {
    const diagram = presentation.logic?.[trial.id] ?? factorLogic(trial.candidate ?? trial.expression);
    return diagram ? renderLogicDiagram(diagram) : '';
  });
  const selectedTrials = trials.filter(trial => selected.includes(trial.id));
  const conditional = selectedTrials.filter(trial => verdict(trial) === 'conditional').length;
  const state = selected.length ? `有 ${selected.length} 个信号值得${conditional === selected.length ? '继续观察' : '进一步关注'}` : run.selection ? '暂时没有值得采用的信号' : '还没有找到明确结果';
  const measuredHoldout = run.finalEvaluation?.holdoutStatus === 'evaluated';
  const defaultTrial = Math.max(0, trials.findIndex(trial => selected.includes(trial.id)));
  const dataset = run.config?.evaluator?.arguments?.dataset ?? run.config?.dataset ?? {};
  const period = (trial, scope, value) => {
    const supplied = value?.diagnostics?.outOfSample?.[scope] ?? trial.metrics?.diagnostics?.outOfSample?.[scope];
    const start = date(value?.start) ?? date(supplied?.start);
    const startExclusive = start ? null : date(value?.startExclusive) ?? date(supplied?.startExclusive) ?? date(dataset[{ validation: 'trainEnd', holdout: 'validationEnd' }[scope]]);
    const row = { period: periodLabels[scope] ?? { train: '训练期', validation: '验证期', holdout: '留出期' }[scope],
      value: finite(value?.meanNetReturn) ? value.meanNetReturn * 100 : null,
      start: value ? start : null, startExclusive: value ? startExclusive : null,
      dataStart: value && scope === 'train' && !start ? date(run.data?.range?.start) : null,
      end: value ? date(value.end) ?? date(supplied?.end) ?? date(dataset[`${scope}End`]) : null,
      labelObservations: count(value?.labelObservations), observations: value ? count(value.observations) ?? count(supplied?.observations) : null,
      periods: value ? count(value.portfolioPeriods) ?? count(supplied?.portfolioPeriods) : null,
    };
    return { ...row, detail: value ? periodDetail(row) : `${row.period} · 未提供可显示结果` };
  };
  const display = trials.map((trial, i) => {
    const holdout = measuredHoldout && selected.includes(trial.id) ? (run.holdout?.[trial.id]?.metrics ?? run.holdout?.[trial.id]) : null;
    return { id: trial.id, name: label(trial, i),
      periods: ['train', 'validation', 'holdout'].map(scope => period(trial, scope, scope === 'holdout' ? holdout : trial.metrics?.[scope])),
      folds: arr(trial.metrics?.diagnostics?.walkForward?.folds).map((fold, index) => {
        const row = { period: `前推区间 ${index + 1}`, value: finite(fold.meanNetReturn) ? fold.meanNetReturn * 100 : null, start: date(fold.testStart), end: date(fold.testEnd), labelObservations: null, observations: count(fold.observations), periods: count(fold.portfolioPeriods) };
        return { ...row, detail: periodDetail(row) };
      }),
    };
  });
  const matrixRows = display.flatMap((trial, i) => trial.periods.slice(0, 2).map(row => ({ ...row, candidate: `F${String(i + 1).padStart(2, '0')}`, name: trial.name, scope: row.period })));
  return `<div class="report-signal-study" data-report-native-charts data-report-style="${["blue","default"].includes(presentation.style) ? presentation.style : "blue"}">
<div class="kit-eyebrow">STRATEGY · ${demo ? '演示样本' : '历史研究'}</div>
${renderText(presentation.summary ?? state, { role: 'body', tag: 'div', className: 'kit-verdict-headline' })}
${renderText(presentation.note, { role: 'body', against: [presentation.summary ?? state] })}
${renderText(date(run.data?.range?.start) && date(run.data?.range?.end) ? `${run.data.range.start} — ${run.data.range.end}` : undefined, { role: 'context' })}
${judgments && presentation.judgments.length ? `<section class="kit-section" data-signal-judgments><h2>分项判断</h2>${judgments}</section>` : ''}
<section class="kit-section"><h2>哪些信号更有用</h2>${renderText('绿：正 · 红：负 · 深浅：幅度 · —：缺失', { role: 'legend' })}
${trials.length>20?`<div class="report-toolbar"><label for="factor-page">查看信号</label><select id="factor-page">${Array.from({length:Math.ceil(trials.length/20)},(_,i)=>`<option value="${i}">${i*20+1}–${Math.min(trials.length,(i+1)*20)}</option>`).join('')}</select></div>`:''}
${renderText(finite(dataset.costBps) ? `估算成本：${dataset.costBps} 基点` : undefined, { role: 'context' })}
${chartHost('factor-matrix', '成本后平均每次变化 · %')}
<div class="factor-comparison"><table><thead><tr><th>信号</th><th>Rank IC</th><th>平均变化</th><th>结论</th></tr></thead><tbody>${trials.map((trial, i) => `<tr data-factor-row="${i}"><td class="factor-name">F${String(i + 1).padStart(2, '0')} · ${e(presentation.labels?.[trial.id] ?? label(trial, i))}</td><td>${n(trial.metrics?.validation?.rankIC)}</td><td data-tone="${!finite(trial.metrics?.validation?.meanNetReturn) || trial.metrics.validation.meanNetReturn === 0 ? 'neutral' : trial.metrics.validation.meanNetReturn < 0 ? 'negative' : 'positive'}">${pct(trial.metrics?.validation?.meanNetReturn)}</td><td>${e(names[verdict(trial)] ?? verdict(trial) ?? '未记录')}</td></tr>`).join('')}</tbody></table></div></section>
<section class="kit-section"><h2>不同时段的表现</h2><div class="report-toolbar"><label for="factor-focus">选择信号</label><select id="factor-focus">${trials.map((trial, i) => `<option value="${i}"${i === defaultTrial ? ' selected' : ''}>F${String(i + 1).padStart(2, '0')} · ${e(presentation.labels?.[trial.id] ?? label(trial, i))}</option>`).join('')}</select></div>
${chartHost('factor-periods', '训练、验证与留出表现 · %')}
${chartHost('factor-folds', '前推区间表现 · %')}
${trials.map((trial, i) => `<div class="factor-conditions" data-factor-condition="${i}"${i === defaultTrial ? '' : ' hidden'}>${logicDiagrams[i]}${formula(trial.candidate ?? trial.expression)}${conditions(presentation.conditions?.[trial.id] ?? (selected.includes(trial.id) && run.selection?.applicability ? run.selection.applicability : trial.applicability ?? trial.review?.applicability))}</div>`).join('')}</section>
${evidence}
<script>(()=>{const rows=${json(matrixRows)},candidates=${json(display)},picker=document.getElementById('factor-focus');const chart=(id,spec)=>window.SesameCharts.chart(document.getElementById(id),{...spec,tone:'signed',missingLabel:'项缺失；未以零代替',onSelect:spec.onSelect});const select=index=>{const candidate=candidates[index];if(!candidate)return;picker.value=String(index);document.querySelectorAll('[data-factor-condition]').forEach(node=>node.hidden=Number(node.dataset.factorCondition)!==index);chart('factor-periods',{kind:'bar',rows:candidate.periods,x:'period',y:'value',unit:'%',title:'训练、验证与留出期的平均变化',description:candidate.periods.map(row=>row.detail).join('；'),height:230});const folds=document.getElementById('factor-folds');folds.closest('figure').hidden=!candidate.folds.length;if(candidate.folds.length)chart('factor-folds',{kind:'bar',rows:candidate.folds,x:'period',y:'value',unit:'%',title:'各前推区间的平均变化',description:candidate.folds.map(row=>row.detail).join('；'),height:230});else window.SesameCharts.destroy(folds);};const pages=document.getElementById('factor-page');const renderMatrix=page=>{const visible=rows.slice(page*40,(page+1)*40);if(visible.length)chart('factor-matrix',{kind:'matrix',rows:visible,x:'scope',y:'candidate',value:'value',unit:'%',title:'不同信号的平均变化',height:Math.max(220,Math.min(540,visible.length*28+80)),onSelect:row=>select(rows.indexOf(row)>>1)});document.querySelectorAll('[data-factor-row]').forEach(node=>node.hidden=Math.floor(Number(node.dataset.factorRow)/20)!==page);};pages?.addEventListener('change',()=>renderMatrix(Number(pages.value)));renderMatrix(0);picker.addEventListener('change',()=>select(Number(picker.value)));select(${defaultTrial});})();</script></div>`;
}

// Translate a supported expression structurally; this never evaluates it.
// Unsupported/custom expressions stay in the exact original run snapshot.
function formula(expression) {
  const latex = expressionLatex(expression);
  if (!latex) return '';
  const fields = [['C', '收盘价'], ['V', '成交量'], ['O', '开盘价'], ['H', '最高价'], ['L', '最低价']].filter(([symbol]) => latex.includes(`${symbol}_{`));
  const operators = [['MA', '均值'], ['Std', '标准差'], ['Sum', '求和']].filter(([symbol]) => latex.includes(`\\operatorname{${symbol}}`));
  const legend = [...fields, ...operators].map(([symbol, meaning]) => `${symbol}：${meaning}`).join(' · ');
  return `<div class="report-formula" data-report-math="${e(`F_t = ${latex}`)}"></div>${renderText(legend, { role: 'legend' })}`;
}
export function expressionLatex(value, time = 't', depth = 0) {
  if (!value || typeof value !== 'object' || depth > 20) return null;
  if (value.op === 'field') return ({ close: 'C', volume: 'V', open: 'O', high: 'H', low: 'L' })[value.name] ? `${({ close: 'C', volume: 'V', open: 'O', high: 'H', low: 'L' })[value.name]}_{${time}}` : null;
  if (value.op === 'constant') return finite(value.value) ? String(value.value) : null;
  const args = arr(value.args).map(arg => expressionLatex(arg, time, depth + 1));
  if (args.some(arg => arg === null)) return null;
  if (args.length === 2) {
    if (value.op === 'div') return `\\frac{${args[0]}}{${args[1]}}`;
    const sign = { add: '+', sub: '-', mul: '\\times' }[value.op];
    return sign ? `\\left(${args[0]}\\right) ${sign} \\left(${args[1]}\\right)` : null;
  }
  if (args.length !== 1) return null;
  if (value.op === 'neg') return `-\\left(${args[0]}\\right)`;
  if (value.op === 'abs') return `\\left|${args[0]}\\right|`;
  if (value.op === 'log') return `\\log\\left(${args[0]}\\right)`;
  if (['lag','delta','mean','std','sum'].includes(value.op) && Number.isInteger(value.window) && value.window > 0) {
    const previous = expressionLatex(value.args[0], `${time}-${value.window}`, depth + 1);
    if (value.op === 'lag') return previous;
    if (value.op === 'delta') return `${args[0]}-${previous}`;
    const operator = { mean: 'MA', std: 'Std', sum: 'Sum' }[value.op];
    return `\\operatorname{${operator}}_{${value.window}}\\left(${args[0]}\\right)`;
  }
  return null;
}
