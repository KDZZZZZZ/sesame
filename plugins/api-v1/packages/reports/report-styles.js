// Shared presentation choices, independent of instruments, analyses or methods.
// Saved extensions are validated design tokens, never uploaded HTML/CSS/code.
import { canonical } from '@sesame/plugin-sdk/protocol';
const check = (ok, message) => { if (!ok) throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => check(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'Unsupported style property');
const defaultTokens = Object.freeze({ content_width: 960, body_size: 15, section_gap: 56, chart_height: 300, heading: 'serif', columns: 2 });
// Only previously saved user styles use these historical defaults. They are not
// selectable presets for a new report; frozen report HTML is never regenerated.
const historicalBases = {
  editorial: defaultTokens,
  compact: { content_width: 1080, body_size: 14, section_gap: 36, chart_height: 260, heading: 'sans', columns: 3 },
  visual: { content_width: 1160, body_size: 16, section_gap: 64, chart_height: 380, heading: 'sans', columns: 2 },
};
export const styleCatalog = Object.freeze({
  overview: 'document.overview: one short conclusion, compact facts, optional short table and one native chart. Use report_structure.first_screen_fields for the selected reference. No repeated introduction; keep full analysis and evidence below.',
  default: { id: 'unified', title: '统一排版', description: '蓝色与随主题变化的黑白灰交替、无框留白；涨赚为绿，跌亏为红。', tokens: defaultTokens },
  blocks: ['judgment', 'judgments', 'metrics', 'range', 'scores', 'chart', 'logic', 'reasoning', 'group', 'paragraph', 'markdown', 'attachments', 'formula', 'table', 'details'],
  guidance: '所有报告使用同一套默认排版。按信息关系选择组件、并排或上下组合，不选择预设、不绑定分析方法。用户明确要求时可用受控 custom token 或保存的精确版本；配色按指标种类确定，盈亏涨跌固定红绿，回撤净值固定蓝灰，不因数值分布换色；样式不计算结论、分数或概率。',
});
export function validateStyleTokens(value) {
  keys(value, ['accent','context','accent_dark','context_dark','heading','body_size','content_width','section_gap','chart_height','columns']);
  for (const key of ['accent','context','accent_dark','context_dark']) if (value[key] !== undefined) check(/^#[\da-f]{6}$/i.test(value[key]), 'Style colors require six-digit hex values');
  if (value.heading !== undefined) check(['serif','sans'].includes(value.heading), 'Choose serif or sans headings');
  for (const [key,min,max] of [['body_size',14,20],['content_width',640,1440],['section_gap',24,88],['chart_height',180,640],['columns',1,3]]) {
    if (value[key] !== undefined) check(Number.isInteger(value[key]) && value[key] >= min && value[key] <= max, `Style ${key} must be an integer from ${min} to ${max}`);
  }
  return { ...value };
}
function extension(value) {
  keys(value, ['reason','tokens']);
  check(typeof value.reason === 'string' && value.reason.trim().length > 0 && value.reason.length <= 2000, 'Describe which presentation need the custom style meets');
  return { reason: value.reason, tokens: validateStyleTokens(value.tokens) };
}
export async function resolveReportStyle(host, selection = {}) {
  keys(selection, ['custom','saved_id','saved_version']);
  check(!(selection.custom && selection.saved_id), 'Choose inline or saved custom style');
  check(selection.saved_id !== undefined || selection.saved_version === undefined, 'Saved style version needs an ID');
  let custom;
  if (selection.custom) custom = extension(selection.custom);
  if (selection.saved_id !== undefined) {
    check(/^[a-z][a-z0-9-]{0,63}$/.test(selection.saved_id) && Number.isSafeInteger(selection.saved_version) && selection.saved_version > 0, 'Saved style needs its exact ID and version');
    const saved = await host.state.read({collection:'report-styles',key:selection.saved_id}, {version:selection.saved_version});
    check(saved.version === selection.saved_version, 'Saved style version differs');
    custom = savedExtension(saved.value.style);
  }
  return { id: 'unified', theme: 'blue', density: 'comfortable', tokens: { ...defaultTokens, ...custom?.tokens } };
}
function savedExtension(value) {
  if (!Object.hasOwn(value ?? {}, 'base')) return extension(value);
  keys(value, ['base','reason','tokens']);
  check(Object.hasOwn(historicalBases,value.base), 'Unknown historical saved style');
  return extension({ reason: value.reason, tokens: { ...historicalBases[value.base], ...validateStyleTokens(value.tokens) } });
}

export function applyReportStyle(html, style) {
  const t = style.tokens;
  const color = (name, value) => value ? `${name}:${value};` : '';
  const heading = t.heading === 'serif' ? 'var(--serif,var(--report-default-serif))' : 'var(--sans,var(--report-default-sans))';
  // Every interpolated value is a validated enum, number or hex color.
  const css = `:root{--report-width:${t.content_width}px;--report-body-size:${t.body_size}px;--report-section-gap:${t.section_gap}px;--report-chart-height:${t.chart_height}px;--report-columns:${t.columns};--report-heading:${heading};${color('--report-accent',t.accent)}${color('--chart-series-1',t.accent)}${color('--report-context',t.context)}${color('--chart-series-2',t.context)}} :root[data-theme="dark"]{${color('--report-accent',t.accent_dark)}${color('--chart-series-1',t.accent_dark)}${color('--report-context',t.context_dark)}${color('--chart-series-2',t.context_dark)}}`;
  return html.replace(/<html\b/, `<html data-report-layout="unified"`).replace(/<\/head>/i, () => `<style id="sesame-report-selected-style">${css}</style></head>`);
}
export function reportStyleCapabilities(host) {
  return [
    {name:'report_styles', execute:async()=>{
      const saved = []; let cursor;
      do { const page = await host.state.query({collection:'report-styles',limit:200,...(cursor?{cursor}:{})}); saved.push(...page.items.map(row=>({id:row.value.id,title:row.value.title,description:row.value.description,style:{saved_id:row.value.id,saved_version:row.version},definition:savedExtension(row.value.style)}))); cursor=page.nextCursor; } while(cursor);
      return {...styleCatalog,saved};
    }},
    {name:'report_style_save', execute:async args=>{
      check(/^[a-z][a-z0-9-]{0,63}$/.test(args.id), 'Style ID must use lowercase letters, digits and hyphens');
      check(typeof args.title === 'string' && args.title.trim() && args.title.length <= 200, 'Style title is required');
      check(typeof args.description === 'string' && args.description.length <= 2000, 'Style description is required');
      const style = extension(args.style), key={collection:'report-styles',key:args.id};
      let previous;
      try {previous=await host.state.read(key);} catch(error) {if(error.code!=='NOT_FOUND')throw error;}
      const value={id:args.id,title:args.title,description:args.description,style,operation_id:args.operation_id};
      if(previous?.value.operation_id === args.operation_id){check(canonical(previous.value)===canonical(value),'Style operation was already used for different content');return {id:args.id,version:previous.version,style:{saved_id:args.id,saved_version:previous.version}};}
      check((args.expected_version??0)===(previous?.version??0),'Use the current style version when updating a saved style');
      const result=await host.state.commit([{op:'put',key,expectedVersion:previous?.version??0,value}],{operationId:args.operation_id});
      const version=result.entries[0].version;
      return {id:args.id,version,style:{saved_id:args.id,saved_version:version}};
    }},
  ];
}
