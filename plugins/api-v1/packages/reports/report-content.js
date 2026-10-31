import { readFileSync } from 'node:fs';
import { renderMarkdown } from '@sesame/plugin-sdk/markdown';
import { withEvidenceAppendix } from './report-appendix.js';
import { renderSignalStudy } from './report-signal-study.js';
import { chartDefinition, chartValue, compositionKinds } from './report-chart-fields.js';
import { resolveReportStyle, applyReportStyle } from './report-styles.js';
import { readBytes } from './artifact-io.js';
import { renderJudgments } from './report-evidence.js';
import { renderOverview } from './report-overview.js';
import { renderLogicDiagram } from './report-logic.js';

const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (ok, message) => { if (!ok) throw new Error(message); };
const keys = (value, allowed) => check(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'Unsupported content or style property');
const text = value => check(typeof value === 'string' && value.length <= 20000, 'Content must be text up to 20,000 characters');
const list = (value, maximum = 100) => check(Array.isArray(value) && value.length <= maximum, 'Too many content items');
function valueTone(tone, value) {
  if (tone === undefined) return '';
  check(['auto', 'positive', 'negative', 'neutral'].includes(tone), 'Value tone must be auto, positive, negative or neutral');
  if (value == null || value === 0) return 'neutral';
  if (tone !== 'auto') return tone;
  check(typeof value === 'number' && Number.isFinite(value), 'Automatic colour needs a finite numeric value; formatted text requires an explicit tone');
  return value > 0 ? 'positive' : 'negative';
}
export const reportStyles = Object.freeze({ layouts: ['document', 'signal-study', 'modules', 'backtest'] });

export async function renderStructuredReport(host, args, signal) {
  const content = args.content, style = await resolveReportStyle(host, args.style);
  const bindings = args.data ?? [];
  const refKey = ref => JSON.stringify(['id','revision','digest','kind','schemaVersion'].map(key=>ref?.[key]));
  check(object(content) && reportStyles.layouts.includes(content.kind), 'Choose a built-in report layout');
  if (content.kind === 'modules') {
    keys(content, ['kind', 'structure', 'results_ref']);
    const { composeSourceReport } = await import('./report-compose.js');
    const composed = await composeSourceReport(host, { ...args, ...content }, signal);
    for (const binding of composed.data) check(bindings.some(item => item.id === binding.id && refKey(item.ref) === refKey(binding.ref)), 'Composed report requires its original fixed data binding');
    return applyReportStyle(composed.html, style);
  }
  if (content.kind === 'backtest') {
    keys(content, ['kind','data_id','parameters','parameter_labels','selection_metric','selection_rule','source_note','currency']);
    check(bindings.some(item=>item.id===content.data_id), 'Backtest data binding is missing');
    const { buildBacktestReport } = await import('./backtest-template.js');
    return applyReportStyle((await buildBacktestReport(host, { ...args, ...content, demo: args.provenance_kind === 'demo' }, signal)).html, style);
  }
  const charts = [];
  function block(row, depth = 0) {
    check(depth <= 5 && object(row), 'Invalid content block');
    if (row.type === 'logic') return renderLogicDiagram(row);
    if (row.type === 'group') {
      keys(row,['type','layout','blocks']); list(row.blocks,12);
      check(['columns','stack'].includes(row.layout),'Choose columns or stack');
      return `<div class="report-group report-group-${row.layout}">${row.blocks.map(child=>`<div>${block(child,depth+1)}</div>`).join('')}</div>`;
    }
    if (row.type === 'judgment') {
      keys(row,['type','text','note']);text(row.text);if(row.note!==undefined)text(row.note);
      return `<div class="report-judgment"><p>${e(row.text)}</p>${row.note?`<small>${e(row.note)}</small>`:''}</div>`;
    }
    if (row.type === 'judgments') {
      keys(row, ['type', 'items', 'presentation']);
      return renderJudgments(row.items, { presentation: row.presentation, locale: args.locale ?? 'zh-CN' });
    }
    if (row.type === 'range') {
      keys(row,['type','label','min','max','value','unit','note']);text(row.label);
      check([row.min,row.max,row.value].every(Number.isFinite)&&row.max>row.min&&row.value>=row.min&&row.value<=row.max,'Range needs finite min < max and an in-range value');
      if(row.unit!==undefined)text(row.unit);if(row.note!==undefined)text(row.note);
      const unit=row.unit??'', position=(row.value-row.min)/(row.max-row.min)*100;
      return `<figure class="report-range"><figcaption>${e(row.label)}<strong>${e(row.value)}${e(unit)}</strong></figcaption><div class="report-range-track" role="img" aria-label="${e(`${row.min}${unit} – ${row.max}${unit}；${row.value}${unit}`)}"><span style="left:${position}%"></span></div><div class="report-range-ends"><span>${e(row.min)}${e(unit)}</span><span>${e(row.max)}${e(unit)}</span></div>${row.note?`<p class="report-source">${e(row.note)}</p>`:''}</figure>`;
    }
    if (row.type === 'scores') {
      keys(row,['type','min','max','unit','items']);list(row.items,24);
      check(Number.isFinite(row.min)&&Number.isFinite(row.max)&&row.max>row.min,'Scores need an explicit finite min < max');
      if(row.unit!==undefined)text(row.unit);
      return `<div class="report-scores">${row.items.map(item=>{keys(item,['label','value','note']);text(item.label);if(item.note!==undefined)text(item.note);check(Number.isFinite(item.value)&&item.value>=row.min&&item.value<=row.max,'Score must be within the supplied scale');return `<figure><figcaption>${e(item.label)}<strong>${e(item.value)}${e(row.unit??'')}</strong></figcaption><meter min="${row.min}" max="${row.max}" value="${item.value}" aria-label="${e(item.label)}"></meter>${item.note?`<p class="report-source">${e(item.note)}</p>`:''}</figure>`;}).join('')}</div>`;
    }
    if (row.type === 'paragraph' || row.type === 'markdown') {
      keys(row, ['type', 'text']); text(row.text);
      return row.type === 'markdown' ? renderMarkdown(row.text) : `<p>${e(row.text)}</p>`;
    }
    if (row.type === 'attachments') {
      keys(row, ['type', 'items']); list(row.items, 64);
      check(row.items.length > 0, 'Attachments need at least one packaged file');
      const paths = new Set();
      return `<ul class="report-attachments">${row.items.map(item => {
        keys(item, ['label', 'path', 'description']);
        check(typeof item.label === 'string' && item.label.trim().length > 0 && item.label.length <= 160, 'Attachment label must be short nonempty text');
        if (item.description !== undefined) check(typeof item.description === 'string' && item.description.length <= 1000, 'Attachment description must be text up to 1,000 characters');
        // Match the provider's package path rules, excluding URL syntax and
        // percent escapes as well: links must identify one literal package entry.
        const path = item.path;
        check(typeof path === 'string' && path.length <= 256 && !/^[\/]|[\\:%?#\x00-\x1f\x7f]/.test(path)
          && path.split('/').every(part => part && part !== '.' && part !== '..'), 'Attachment links require safe literal relative paths');
        check(!paths.has(path), 'Attachment links must not repeat a path'); paths.add(path);
        const matches = (args.assets ?? []).filter(asset => asset.path === path);
        check(matches.length === 1, 'Attachment link must match one declared packaged asset');
        const asset = matches[0], media = String(asset.media_type).split(';')[0].toLowerCase();
        const extensions = { 'application/json': ['json'], 'text/plain': ['txt', 'csv', 'tsv', 'md', 'log'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/webp': ['webp'] };
        check(extensions[media]?.includes(path.split('.').at(-1).toLowerCase()), 'Attachment links only accept inert packaged data, text or raster images');
        const href = path.split('/').map(encodeURIComponent).join('/');
        return `<li><a href="${e(href)}">${e(item.label)}</a>${item.description ? `<p class="report-source">${e(item.description)}</p>` : ''}</li>`;
      }).join('')}</ul>`;
    }
    if (row.type === 'formula') {
      keys(row, ['type','latex','caption','display']); text(row.latex);
      check(row.display === undefined || ['inline','block'].includes(row.display), 'Invalid formula display');
      if (row.caption !== undefined) text(row.caption);
      return `<div class="report-formula" data-report-math="${e(row.latex)}"${row.display === 'inline' ? ' data-display="inline"' : ''}></div>${row.caption ? `<p class="report-source">${e(row.caption)}</p>` : ''}`;
    }
    if (row.type === 'metrics') {
      keys(row, ['type','items']); list(row.items, 12);
      return `<dl class="report-metrics">${row.items.map(item => { keys(item,['label','value','note','tone']); text(item.label); if(item.note!==undefined)text(item.note); check(typeof item.value === 'string' || typeof item.value === 'number' && Number.isFinite(item.value), 'Invalid metric value'); const tone = valueTone(item.tone, item.value); return `<div class="report-metric"${tone ? ` data-tone="${tone}"` : ''}><dt>${e(item.label)}</dt><dd>${e(item.value)}</dd>${item.note ? `<small>${e(item.note)}</small>` : ''}</div>`; }).join('')}</dl>`;
    }
    if (row.type === 'reasoning') {
      keys(row, ['type','steps']); list(row.steps, 8); row.steps.forEach(text);
      return `<ol class="report-reasoning-steps">${row.steps.map(step=>`<li>${e(step)}</li>`).join('')}</ol>`;
    }
    if (row.type === 'table') {
      keys(row, ['type','columns','rows','caption','column_tones']); list(row.columns, 24); list(row.rows, 2500); row.columns.forEach(text);
      if (row.column_tones !== undefined) check(Array.isArray(row.column_tones) && row.column_tones.length === row.columns.length && row.column_tones.every(tone => tone === null || ['auto','positive','negative','neutral'].includes(tone)), 'Table column_tones must match the columns; use null for ordinary content');
      if(row.caption!==undefined)text(row.caption);
      check(row.rows.every(values=>Array.isArray(values)&&values.length===row.columns.length&&values.every(value=>value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))), 'Table rows must match columns and contain finite scalar values');
      return `<div class="report-table"><table>${row.caption ? `<caption>${e(row.caption)}</caption>` : ''}<thead><tr>${row.columns.map(value=>`<th>${e(value)}</th>`).join('')}</tr></thead><tbody>${row.rows.map(values=>`<tr>${values.map((value,index)=>{ const tone = valueTone(row.column_tones?.[index] ?? undefined, value); return `<td${tone ? ` data-tone="${tone}"` : ''}>${e(value ?? '—')}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (row.type === 'chart') {
      keys(row,['type','title','kind','columns','options','rows','data_id','takeaway','source_note','nodes','chart_data']);
      text(row.title); text(row.takeaway); text(row.source_note);
      const definition={kind:row.kind,columns:row.columns,options:row.options??{},data_requirements:'Supplied results only'};
      chartDefinition(definition);
      check(Boolean(row.data_id) !== Boolean(row.rows), 'Choose fixed rows or a data binding');
      if (row.data_id) check(bindings.some(binding=>binding.id===row.data_id), 'Chart data binding is missing');
      else chartValue({rows:row.rows,takeaway:row.takeaway,source_note:row.source_note,...(row.nodes?{nodes:row.nodes}:{})},definition);
      const extraData = row.chart_data ?? []; list(extraData,8);
      check(extraData.every(item=>object(item)&&Object.keys(item).every(key=>['property','data_id'].includes(key))&&item.property==='nodes'&&bindings.some(binding=>binding.id===item.data_id)),'Extra chart data must be a declared nodes binding');
      check(extraData.length<=1&&!(extraData.length&&row.nodes),'Choose one fixed nodes input');
      const id=`content-chart-${charts.length+1}`;
      charts.push({id,title:row.title,caption:row.takeaway,source_note:row.source_note,kind:row.kind,columns:row.columns,options:{height:style.tokens.chart_height,...row.options??{}},...(row.rows?{rows:row.rows}:{dataId:row.data_id}),...(row.nodes?{nodes:row.nodes}:{}),...(extraData.length?{chartData:extraData}:{})});
      const original = row.rows ? JSON.stringify({rows:row.rows,...(row.nodes?{nodes:row.nodes}:{})},null,2) : '';
      return `<figure class="kit-chart"><figcaption class="kit-chart-head"><strong>${e(row.title)}</strong><span class="kit-chart-caption">${e(row.takeaway)}</span></figcaption><div id="${id}" class="module-chart-plot"></div></figure><details data-report-evidence><summary>${e(row.title)} · 来源与数据</summary><p>${e(row.source_note)}</p><pre id="${id}-evidence">${e(original)}</pre></details>`;
    }
    if (row.type === 'details') {
      keys(row,['type','title','blocks']); text(row.title); list(row.blocks);
      return `<details data-report-evidence><summary>${e(row.title)}</summary>${row.blocks.map(child=>block(child,depth+1)).join('')}</details>`;
    }
    check(false, 'Unknown content block; custom HTML, CSS and scripts are not accepted');
  }
  let body;
  if (content.kind === 'signal-study') {
    keys(content,['kind','run','run_source','presentation']);
    check(Boolean(content.run)!==Boolean(content.run_source),'Signal study needs recorded results or one fixed JSON source');
    let run=content.run;
    if(content.run_source){
      keys(content.run_source,['ref','entry']);
      const {ref,entry}=content.run_source;
      check(object(ref)&&['id','revision','digest','kind','schemaVersion'].every(key=>typeof ref[key]==='string')&&/\.json$/i.test(entry),'Recorded results need a complete fixed reference and a JSON entry');
      check([...bindings.map(item=>item.ref),...args.references??[]].some(item=>refKey(item)===refKey(ref)),'Recorded result source must be included in report references');
      const manifest=await host.resources.read(ref,{part:'manifest'});
      check(manifest.blobs?.some(blob=>blob.path===entry&&/^application\/json(?:;|$)/i.test(blob.mediaType)),'Recorded result entry must be a packaged JSON attachment');
      const bytes=await readBytes(host,ref,entry,signal);
      check(bytes.length<=1024*1024,'Recorded results exceed 1 MiB');
      run=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    }
    check(object(run), 'Signal study needs recorded results');
    keys(content.presentation??{},['summary','note','labels','conditions','judgments','period_labels','logic']);
    body=renderSignalStudy(run,{demo:args.provenance_kind==='demo',presentation:{...content.presentation,style:style.theme??'blue'}});
  } else {
    keys(content,['kind','overview','sections','appendix']); list(content.sections,50); if(content.appendix)list(content.appendix);
    body=content.overview === undefined ? '' : renderOverview(content.overview, block, args.locale ?? 'zh-CN', content.sections.length > 0);
    body+=content.sections.map((section,index)=>{keys(section,['title','blocks']);text(section.title);list(section.blocks);return `<section class="kit-section" id="content-section-${index+1}"><h2>${e(section.title)}</h2>${section.blocks.map(item=>block(item)).join('')}</section>`;}).join('');
    body+= (content.appendix??[]).map(item=>block(item)).join('');
    const assets=[];
    if(charts.length){assets.push('report-kit.js','editorial-charts.js');
      if(charts.some(chart=>['waterfall','dumbbell','strip','histogram','boxplot','ridgeline','violin'].includes(chart.kind)))assets.push('charts-statistics.js');
      if(charts.some(chart=>['calendar','parallel','bump','lifecycle'].includes(chart.kind)))assets.push('charts-temporal.js');
      if(charts.some(chart=>['treemap','threads','flow','network-circular','network-force'].includes(chart.kind)))assets.push('charts-structure.js');
      if(charts.some(chart=>compositionKinds.has(chart.kind)))assets.push('charts-composition.js');
      if(charts.some(chart=>chart.kind==='decision-tree'))assets.push('charts-decision.js');
      if(charts.some(chart=>chart.kind==='candlestick'))assets.push('vendor/lightweight-charts.js','charts-market.js');
      body+=`<script id="sesame-module-charts" type="application/json">${json(charts)}</script>${assets.map(path=>`<script>${asset('assets/'+path)}</script>`).join('')}<script>${asset('assets/content-charts.js')}</script>`;
    }
  }
  if (body.includes('data-report-svl')) body += `<script>${asset('assets/svl-graph.js')}</script><script>SesameSvlGraph.mount();</script>`;
  body=`<div data-report-style="${e(style.theme)}" data-report-density="${e(style.density)}">${args.provenance_kind==='demo'?'<p>演示样本</p>':''}${args.summary&&content.kind!=='signal-study'&&!content.overview?`<p class="report-subtitle">${e(args.summary)}</p>`:''}${body}</div>`;
  const tokens={LOCALE:e(args.locale??'zh-CN'),TITLE:e(args.title),STYLES:asset('assets/editorial.css')+'\n'+asset('assets/module-report.css')+'\n'+asset('assets/report-overview.css')+'\n'+asset('assets/svl-graph.css'),BODY:body};
  return applyReportStyle(withEvidenceAppendix(asset('templates/document.html').replace(/\{\{([A-Z_]+)\}\}/g,(token,key)=>tokens[key]??token)),style);
}
