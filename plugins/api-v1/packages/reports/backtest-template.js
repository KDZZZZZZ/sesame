import { withEvidenceAppendix } from './report-appendix.js';
import { resolveReportStyle, applyReportStyle } from './report-styles.js';
import { renderJudgments } from './report-evidence.js';
import { readFileSync } from 'node:fs';
import { graph as sourceGraph } from '@sesame/plugin-sdk/svl';
import { readBytes, writeWorkspace } from './artifact-io.js';
import { renderLogicDiagram } from './report-logic.js';

const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function buildBacktestReport(host, args, signal) {
    let source, graph;
    if (args.strategy_source) {
      if (args.strategy_source.kind !== 'strategy.source') throw new Error('strategy_source requires a fixed SVL strategy.source');
      const { content, blobs } = await host.resources.read(args.strategy_source, { part: 'manifest' });
      const blob = blobs.find(item => item.path === content.sourcePath);
      if (!blob) throw new Error('Strategy source bytes are missing');
      source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(host, args.strategy_source, blob.path, signal)));
      graph = sourceGraph(source);
      if (graph.sourceDigest !== content.sourceDigest) throw new Error('SVL graph must match the published source digest');
    }
    const evidence = args.strategy_evidence;
    if (evidence) {
      const object = value => value && typeof value === 'object' && !Array.isArray(value);
      const refKey = ref => JSON.stringify(['id','revision','digest','kind','schemaVersion'].map(key=>ref?.[key]));
      const declared = [...args.data??[], ...args.related??[]].map(item=>item.ref??item.artifact).filter(Boolean).concat(args.references??[]);
      if (!object(evidence) || Object.keys(evidence).some(key=>!['engine','summary','references','judgments','logic'].includes(key)) ||
        !['engine','summary'].every(key=>typeof evidence[key]==='string' && evidence[key].trim() && evidence[key].length<=20000) ||
        !Array.isArray(evidence.references) || !evidence.references.length || evidence.references.length>32 ||
        evidence.references.some(ref=>!object(ref) || !['id','revision','digest','kind','schemaVersion'].every(key=>typeof ref[key]==='string' && ref[key]) || !/^sha256:[a-f0-9]{64}$/.test(ref.digest))) throw new Error('Native strategy evidence needs its engine, summary and complete fixed references');
      if (evidence.references.some(ref=>!declared.some(item=>refKey(item)===refKey(ref)))) throw new Error('Native strategy evidence must be declared in report references');
      await Promise.all(evidence.references.map(ref=>host.resources.read(ref,{part:'manifest'})));
    }
    const judgments = evidence?.judgments === undefined ? '' : renderJudgments(evidence.judgments, { locale: args.locale ?? 'en' });
    if (!graph && !evidence) throw new Error('Supply an actual SVL strategy_source or recorded native strategy_evidence; do not invent source logic');
    if (!Array.isArray(args.parameters) || !args.parameters.length || args.parameters.length>32 || args.parameters.some(key=>typeof key!=='string'||!key) || new Set(args.parameters).size !== args.parameters.length) throw new Error('Provide 1–32 unique recorded parameter names');
    if (args.parameter_labels !== undefined && (!args.parameter_labels || typeof args.parameter_labels !== 'object' || Array.isArray(args.parameter_labels) || Object.entries(args.parameter_labels).some(([key,label])=>!args.parameters.includes(key) || typeof label!=='string' || !label.trim() || label.length>64 || /[\u0000-\u001f\u007f]/.test(label)))) throw new Error('Parameter labels must name declared parameters using short, nonempty single-line strings');
    const config = { title: args.title, summary: args.summary, dataId: args.data_id, parameters: args.parameters, parameterLabels: args.parameter_labels, selectionMetric: args.selection_metric ?? 'sharpe', selectionRule: args.selection_rule, sourceNote: args.source_note, currency: args.currency, ...(graph?{source:args.strategy_source,graph,definition:source}:{}), ...(evidence?{strategyEvidence:evidence}:{}), demo: args.demo === true };
    if (evidence?.logic !== undefined) config.strategyLogicHtml = renderLogicDiagram(evidence.logic);
    const tokens = { LOCALE: escape(args.locale ?? 'en'), TITLE: escape(args.title), STYLES: asset('assets/editorial.css') + '\n' + asset('assets/backtest.css') + '\n' + asset('assets/module-report.css') + '\n' + asset('assets/svl-graph.css'), KIT: asset('assets/report-kit.js'), CHARTS: asset('assets/editorial-charts.js'), EXPLORER: asset('assets/svl-graph.js') + '\n' + asset('assets/backtest-explorer.js'), CONFIG: json(config) };
    let template = asset('templates/backtest.html');
    if (judgments) {
      const anchor = 'window.report.track(initialize())';
      if (!template.includes(anchor)) throw new Error('Backtest initialization must complete before inserting supplied judgments');
      // Native rendering owns its charts and listeners. Insert the supplied
      // analysis only after that render, without rebuilding its source or rows.
      const heading = /^zh/i.test(args.locale ?? 'en') ? '分项判断' : 'Judgments';
      tokens.JUDGMENTS = json(`<h2>${heading}</h2>${judgments}`);
      template = template.replace(anchor, `window.report.track(initialize().then(() => { const section = document.createElement('section'); section.className = 'kit-section'; section.setAttribute('data-backtest-judgments', ''); section.innerHTML = {{JUDGMENTS}}; const root = document.getElementById('report'), first = root.querySelector('.kit-section'); if (first) first.before(section); else root.append(section); }))`);
    }
    const html = withEvidenceAppendix(template.replace(/\{\{(LOCALE|TITLE|STYLES|KIT|CHARTS|EXPLORER|CONFIG|JUDGMENTS)\}\}/g, (_, key) => tokens[key]));
    if (Buffer.byteLength(html) > 1024 * 1024) throw new Error('This source exceeds the report budget; split it into focused reports and retain complete source evidence');
    return { html, graph };
}

export function backtestTemplate(host) {
  return { name: 'report_backtest_template', execute: async (args, signal) => {
    const built = await buildBacktestReport(host, args, signal), graph = built.graph;
    const html = applyReportStyle(built.html, await resolveReportStyle(host,args.style));
    const written = await writeWorkspace(host, args.output_path, html, signal);
    return { path: written.path, ...(graph?{sourceDigest:graph.sourceDigest}:{}), editable:false, publish: { content: { kind: 'backtest', data_id: args.data_id, parameters: args.parameters, ...(args.parameter_labels?{parameter_labels:args.parameter_labels}:{}), selection_metric: args.selection_metric, selection_rule: args.selection_rule, source_note: args.source_note, currency: args.currency }, style: args.style??{}, ...(args.strategy_source?{strategy_source:args.strategy_source}:{}), ...(args.strategy_evidence?{strategy_evidence:args.strategy_evidence,references:args.references}:{} ), features: ['interactive', 'strategy_details'] }, next: 'Supply title, summary and the real fixed data binding, then host.reports.publish with input containing the content and actual source evidence, or use the report_publish facade. Check the exact published ref. Preview HTML cannot be uploaded.' };
  } };
}
