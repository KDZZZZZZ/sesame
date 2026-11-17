import { readFileSync } from 'node:fs';
import { renderMarkdown } from '@sesame/plugin-sdk/markdown';
import { withBuiltins } from './renderer/builtins.js';
import { chartDefinition, chartValue, compositionKinds } from './report-chart-fields.js';
import { resolveReportStyle, applyReportStyle } from './report-styles.js';
import { renderJudgments } from './renderer/judgments.js';
import { renderLogicDiagram } from './report-logic.js';
import { normalizeComponentContent } from './component-input.js';
import { controlScope, validateInteraction, filterRows, controlledOptions } from './report-interactions.js';
import { renderText, isDuplicateText } from './report-text.js';

const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (ok, message) => { if (!ok) throw new Error(message); };
const keys = (value, allowed) => check(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'Unsupported content or style property');
const text = value => check(typeof value === 'string' && value.length <= 20000, 'Content must be text up to 20,000 characters');
const list = (value, maximum = 100) => check(Array.isArray(value) && value.length <= maximum, 'Too many content items');
function valueTone(tone, value, path, tonePath) {
  if (tone === undefined) return '';
  check(['auto', 'positive', 'negative', 'neutral'].includes(tone), 'Value tone must be auto, positive, negative or neutral');
  if (value == null || value === 0) return 'neutral';
  if (tone !== 'auto') return tone;
  check(typeof value === 'number' && Number.isFinite(value), `${path}: Automatic colour from ${tonePath} needs a finite numeric value; formatted text requires an explicit tone`);
  return value > 0 ? 'positive' : 'negative';
}
export const reportStyles = Object.freeze({ layouts: ['document'] });

function renderMetrics(items, path, opening = false) {
  list(items, 12);
  return `<dl class="report-metrics${opening ? ' report-highlights' : ''}"${opening ? ` data-count="${items.length}"` : ''}>${items.map((item, index) => {
    try {
      keys(item, ['label', 'value', 'tone']); text(item.label);
      check(typeof item.value === 'string' || typeof item.value === 'number' && Number.isFinite(item.value), `${path}/${index}/value: Invalid metric value`);
      if (opening) {
        check(item.label.trim(), `${path}/${index}/label: Opening key result needs a nonempty label`);
        check(typeof item.value !== 'string' || item.value.trim(), `${path}/${index}/value: Opening key result needs a nonempty value`);
      }
      const tone = valueTone(item.tone, item.value, `${path}/${index}/value`, `${path}/${index}/tone`);
      return `<div class="report-metric"${tone ? ` data-tone="${tone}"` : ''}><dt>${e(item.label)}</dt><dd>${e(item.value)}</dd></div>`;
    } catch (error) {
      if (!error.message.startsWith('/input/')) error.message = `${path}/${index}: ${error.message}`;
      throw error;
    }
  }).join('')}</dl>`;
}

export async function renderStructuredReport(host, args, signal) {
  const report = args.target !== 'answer';
  if (args.lead !== undefined) check(typeof args.lead === 'string' && args.lead.length <= 20000, '/input/lead: Opening answer must be plain text up to 20,000 characters');
  if (report) {
    check(typeof args.title === 'string' && args.title.trim(), '/metadata/title: A report requires a nonempty title');
    check(typeof args.lead === 'string' && args.lead.trim(), '/input/lead: A report requires an explicit opening answer to the user question; summary is only index metadata');
    check(Array.isArray(args.highlights) && args.highlights.length >= 1 && args.highlights.length <= 6, '/input/highlights: A report requires 1–6 explicitly supplied key results');
    check(Array.isArray(args.content?.sections) && args.content.sections.length > 0, '/input/content/sections: A report requires at least one body section');
    args.content.sections.forEach((section, index) => check(Array.isArray(section?.blocks) && section.blocks.length > 0, `/input/content/sections/${index}/blocks: A report body section needs content`));
  }
  if (args.highlights !== undefined) check(Array.isArray(args.highlights) && args.highlights.length >= 1 && args.highlights.length <= 6, '/input/highlights: Supply 1–6 key results');
  const highlights = args.highlights === undefined ? '' : renderMetrics(args.highlights, '/input/highlights', true);
  const bindings = args.data ?? [];
  const content = args.content?.kind === 'document' ? await normalizeComponentContent(host, args.content, bindings, signal) : args.content;
  const style = await resolveReportStyle(host, args.style);
  check(object(content) && reportStyles.layouts.includes(content.kind), 'Choose a built-in report layout');
  const charts = [], scopes = [], tables = [];
  let renderedTables = 0;
  const prose = blocks => blocks.flatMap(row => ['paragraph', 'judgment'].includes(row.type) ? [row.text] : []);
  function block(row, depth = 0, path = '/input/content', context = { titles: [], body: [] }) {
    try { return renderBlock(row, depth, path, context); }
    catch (error) {
      if (!error.message.startsWith('/input/')) error.message = `${path}: ${error.message}`;
      throw error;
    }
  }
  function renderBlock(row, depth, path, context) {
    check(depth <= 5 && object(row), 'Invalid content block');
    if (row.type === 'logic') return renderLogicDiagram(row, context);
    if (row.type === 'group') {
      keys(row,['type','layout','blocks','controls']); list(row.blocks,12);
      check(['columns','stack'].includes(row.layout),'Choose columns or stack');
      const scope = row.controls === undefined ? null : { id: `report-controls-${scopes.length + 1}`, controls: row.controls };
      if (scope) scopes.push(scope);
      const grouped = { ...context, body: [...context.body, ...prose(row.blocks)], ...(scope ? { controls: controlScope(row.controls), scope: scope.id } : {}) };
      return `<div${scope ? ` id="${scope.id}" data-report-control-scope` : ''}>${scope ? '<div class="report-controls"></div>' : ''}<div class="report-group report-group-${row.layout}">${row.blocks.map((child,index)=>`<div>${block(child,depth+1,`${path}/blocks/${index}`,grouped)}</div>`).join('')}</div></div>`;
    }
    if (row.type === 'judgment') {
      keys(row,['type','text']);text(row.text);
      return `<div class="report-judgment"><p>${e(row.text)}</p></div>`;
    }
    if (row.type === 'judgments') {
      keys(row, ['type', 'items']);
      return renderJudgments(row.items);
    }
    if (row.type === 'range') {
      keys(row,['type','label','min','max','value','unit']);text(row.label);
      check([row.min,row.max,row.value].every(Number.isFinite)&&row.max>row.min&&row.value>=row.min&&row.value<=row.max,'Range needs finite min < max and an in-range value');
      if(row.unit!==undefined)text(row.unit);
      const unit=row.unit??'', position=(row.value-row.min)/(row.max-row.min)*100;
      return `<figure class="report-range"><figcaption>${e(row.label)}<strong>${e(row.value)}${e(unit)}</strong></figcaption><div class="report-range-track" role="img" aria-label="${e(`${row.min}${unit} – ${row.max}${unit}；${row.value}${unit}`)}"><span style="left:${position}%"></span></div><div class="report-range-ends"><span>${e(row.min)}${e(unit)}</span><span>${e(row.max)}${e(unit)}</span></div></figure>`;
    }
    if (row.type === 'scores') {
      keys(row,['type','min','max','unit','items']);list(row.items,24);
      check(Number.isFinite(row.min)&&Number.isFinite(row.max)&&row.max>row.min,'Scores need an explicit finite min < max');
      if(row.unit!==undefined)text(row.unit);
      return `<div class="report-scores">${row.items.map(item=>{keys(item,['label','value']);text(item.label);check(Number.isFinite(item.value)&&item.value>=row.min&&item.value<=row.max,'Score must be within the supplied scale');return `<figure><figcaption>${e(item.label)}<strong>${e(item.value)}${e(row.unit??'')}</strong></figcaption><meter min="${row.min}" max="${row.max}" value="${item.value}" aria-label="${e(item.label)}"></meter></figure>`;}).join('')}</div>`;
    }
    if (row.type === 'paragraph' || row.type === 'markdown') {
      keys(row, ['type', 'text']); text(row.text);
      return row.type === 'markdown' ? `<div class="report-prose">${renderMarkdown(row.text)}</div>` : `<p>${e(row.text)}</p>`;
    }
    if (row.type === 'attachments') {
      keys(row, ['type', 'items']); list(row.items, 64);
      check(row.items.length > 0, 'Attachments need at least one packaged file');
      const paths = new Set();
      return `<ul class="report-attachments">${row.items.map((item, index) => {
        const itemPath = `${path}/items/${index}`;
        keys(item, ['label', 'path']);
        check(typeof item.label === 'string' && item.label.trim().length > 0 && item.label.length <= 160, 'Attachment label must be short nonempty text');
        // Match the provider's package path rules, excluding URL syntax and
        // percent escapes as well: links must identify one literal package entry.
        const assetPath = item.path;
        check(typeof assetPath === 'string' && assetPath.length <= 256 && !/^[\/]|[\\:%?#\x00-\x1f\x7f]/.test(assetPath)
          && assetPath.split('/').every(part => part && part !== '.' && part !== '..'), `${itemPath}/path: Attachment links require safe literal relative paths`);
        check(!paths.has(assetPath), `${itemPath}/path: Attachment links must not repeat a path`); paths.add(assetPath);
        const matches = (args.assets ?? []).filter(asset => asset.path === assetPath);
        check(matches.length === 1, `${itemPath}/path: Attachment link must match one declared packaged asset at /input/assets/*/path`);
        const asset = matches[0], media = String(asset.media_type).split(';')[0].toLowerCase();
        const extensions = { 'application/json': ['json'], 'text/plain': ['txt', 'csv', 'tsv', 'md', 'log'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/webp': ['webp'] };
        check(extensions[media]?.includes(assetPath.split('.').at(-1).toLowerCase()), `${itemPath}/path: Attachment links only accept inert packaged data, text or raster images; also check the matching /input/assets entry path and media_type`);
        const href = assetPath.split('/').map(encodeURIComponent).join('/');
        return `<li><a href="${e(href)}">${e(item.label)}</a></li>`;
      }).join('')}</ul>`;
    }
    if (row.type === 'formula') {
      keys(row, ['type','latex','display']); text(row.latex);
      check(row.display === undefined || ['inline','block'].includes(row.display), 'Invalid formula display');
      return `<div class="report-formula" data-report-math="${e(row.latex)}"${row.display === 'inline' ? ' data-display="inline"' : ''}></div>`;
    }
    if (row.type === 'metrics') {
      keys(row, ['type','items']); list(row.items, 12);
      return renderMetrics(row.items, `${path}/items`);
    }
    if (row.type === 'reasoning') {
      keys(row, ['type','steps']); list(row.steps, 8); row.steps.forEach(text);
      return `<ol class="report-reasoning-steps">${row.steps.map(step=>`<li>${e(step)}</li>`).join('')}</ol>`;
    }
    if (row.type === 'table') {
      keys(row, ['type','columns','rows','caption','column_tones','filter','page_size','selection']); list(row.columns, 24); list(row.rows, 2500); row.columns.forEach(text);
      if (row.column_tones !== undefined) check(Array.isArray(row.column_tones) && row.column_tones.length === row.columns.length && row.column_tones.every(tone => tone === null || ['auto','positive','negative','neutral'].includes(tone)), 'Table column_tones must match the columns; use null for ordinary content');
      if(row.caption!==undefined)text(row.caption);
      check(row.rows.every(values=>Array.isArray(values)&&values.length===row.columns.length&&values.every(value=>value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))), 'Table rows must match columns and contain finite scalar values');
      validateInteraction(row, context.controls, row.columns);
      const id = `report-table-${++renderedTables}`;
      if (row.page_size || row.filter || row.selection) tables.push({ id, columns: row.columns, rows: row.rows, filter: row.filter, pageSize: row.page_size, selection: row.selection, scope: context.scope });
      const caption = renderText(row.caption,{role:'title',tag:'caption',against:context.titles});
      return `<div id="${id}" class="report-table"><table${row.caption && !caption ? ` aria-label="${e(row.caption)}"` : ''}>${caption}<thead><tr>${row.columns.map(value=>`<th>${e(value)}</th>`).join('')}</tr></thead><tbody>${row.rows.map((values,rowIndex)=>`<tr>${values.map((value,index)=>{ const tone = valueTone(row.column_tones?.[index] ?? undefined, value, `${path}/rows/${rowIndex}/${index}`, `${path}/column_tones/${index}`); return `<td${tone ? ` data-tone="${tone}"` : ''}>${e(value ?? '—')}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (row.type === 'chart') {
      keys(row,['type','title','kind','columns','options','rows','data_id','nodes','chart_data','filter','option_controls']);
      if(row.title!==undefined)text(row.title);
      const definition={kind:row.kind,columns:row.columns,options:row.options??{},data_requirements:'Supplied results only'};
      validateInteraction(row, context.controls, row.columns);
      chartDefinition(definition);
      check(Boolean(row.data_id) !== Boolean(row.rows), 'Choose fixed rows or a data binding');
      if (row.data_id) check(bindings.some(binding=>binding.id===row.data_id), 'Chart data binding is missing');
      else {
        const visibleRows = filterRows(row.rows, row.filter, context.controls);
        if (visibleRows.length) chartValue({rows:visibleRows,...(row.nodes?{nodes:row.nodes}:{})},{...definition, options: controlledOptions(definition.options,row.option_controls,context.controls)});
      }
      const extraData = row.chart_data ?? []; list(extraData,8);
      check(extraData.every(item=>object(item)&&Object.keys(item).every(key=>['property','data_id'].includes(key))&&item.property==='nodes'&&bindings.some(binding=>binding.id===item.data_id)),'Extra chart data must be a declared nodes binding');
      check(extraData.length<=1&&!(extraData.length&&row.nodes),'Choose one fixed nodes input');
      const id=`content-chart-${charts.length+1}`;
      charts.push({id,scope:context.scope,filter:row.filter,optionControls:row.option_controls,title:row.title??row.kind,kind:row.kind,columns:row.columns,options:{height:style.tokens.chart_height,...row.options??{}},...(row.rows?{rows:row.rows}:{dataId:row.data_id}),...(row.nodes?{nodes:row.nodes}:{}),...(extraData.length?{chartData:extraData}:{})});
      const heading = row.title && !isDuplicateText(row.title,context.titles) ? `<figcaption class="kit-chart-head"><strong>${e(row.title)}</strong></figcaption>` : '';
      return `<figure class="kit-chart">${heading}<div id="${id}" class="module-chart-plot"></div></figure>`;
    }
    if (row.type === 'details') {
      keys(row,['type','title','blocks']); text(row.title); list(row.blocks);
      const detail = { ...context, titles: [row.title], body: prose(row.blocks) };
      return `<details data-report-evidence><summary>${e(row.title)}</summary>${row.blocks.map((child,index)=>block(child,depth+1,`${path}/blocks/${index}`,detail)).join('')}</details>`;
    }
    check(false, 'Unknown content block; custom HTML, CSS and scripts are not accepted');
  }
  keys(content,['kind','sections']); list(content.sections,50);
  const reportTitles = args.target === 'answer' ? [] : [args.title];
  let body=content.sections.map((section,index)=>{keys(section,['title','blocks']);text(section.title);list(section.blocks);const context={titles:section.title.trim()?[section.title]:reportTitles,body:prose(section.blocks)};return `<section class="kit-section" id="content-section-${index+1}">${section.title.trim()&&!isDuplicateText(section.title,reportTitles) ? `<h2>${e(section.title)}</h2>` : ''}${section.blocks.map((item,blockIndex)=>block(item,0,`/input/content/sections/${index}/blocks/${blockIndex}`,context)).join('')}</section>`;}).join('');
    if(scopes.length || tables.length) body+=`<script id="sesame-report-interactions" type="application/json">${json({scopes,tables,locale:args.locale??'en'})}</script><script>${asset('assets/interactions.js')}</script>`;
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
  if (body.includes('data-report-svl')) body += `<script>${asset('assets/svl-graph.js')}</script><script>SesameSvlGraph.mount();</script>`;
  // The explicit opening answer owns its position. Metadata summaries remain
  // index-only; the renderer never invents an answer from prose or chart data.
  const lead = report ? `<p class="report-lead">${e(args.lead)}</p>` : '';
  body=`<div data-report-style="${e(style.theme)}" data-report-density="${e(style.density)}">${lead}${report ? highlights : ''}${args.provenance_kind==='demo'?'<p data-sesame-provenance="demo">演示样本</p>':''}${body}</div>`;
  const tokens={LOCALE:e(args.locale??'zh-CN'),TITLE:e(args.title),STYLES:asset('assets/editorial.css')+'\n'+asset('assets/content.css')+'\n'+asset('assets/svl-graph.css'),BODY:body};
  return applyReportStyle(withBuiltins(asset('renderer/document-shell.html').replace(/\{\{([A-Z_]+)\}\}/g,(token,key)=>tokens[key]??token)),style);
}
