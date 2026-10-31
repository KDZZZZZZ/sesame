// Bundled from the same SVL canvas used by the application. No report-only graph renderer.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SvlGraphCanvas, useSvlTextMeasurement } from '@sesame/svl-canvas';
import { layoutScope, nodeKey } from '@sesame/svl-layout';
import { SvlLogicView } from '@sesame/svl-logic';
import { SvlExpressionTree } from '@sesame/svl-tree';
import { dependencySlice } from '@sesame/svl-logic-model';
import './svl-report.css';

const roots = new Map();
const translate = (labels, values = {}) => String(typeof labels === 'string' ? labels : labels[document.documentElement.lang.startsWith('zh') ? 'zh-CN' : 'en']).replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token);
function ScopeCanvas({ graph, source, title, onInspect }) {
  const hasSource = source?.language === 'svl/1';
  const hasLogic = Boolean(source?.handlers?.length);
  const [view, setView] = useState(hasLogic ? 'logic' : hasSource ? 'tree' : 'calculation');
  const [focusNode, setFocusNode] = useState();
  const scope = useMemo(() => ({ ...dependencySlice(graph,focusNode), id: graph.id ?? 'strategy' }), [graph,focusNode]);
  const measureText = useSvlTextMeasurement();
  const layout = useMemo(() => layoutScope(scope, { measureText }), [scope, measureText]);
  const [selected, setSelected] = useState(scope.nodes[0] ? nodeKey(scope.id, scope.nodes[0].id) : undefined);
  return <>
    {hasSource && <div className="svl-diagram-tabs" role="tablist" aria-label={tr('策略图视图','Strategy diagram view')}>
      {hasLogic && <button type="button" role="tab" aria-selected={view==='logic'} onClick={()=>setView('logic')}>{tr('交易逻辑','Trading logic')}</button>}
      <button type="button" role="tab" aria-selected={view==='tree'} onClick={()=>setView('tree')}>{tr('计算树','Calculation tree')}</button>
      <button type="button" role="tab" aria-selected={view==='calculation'} onClick={()=>setView('calculation')}>{tr('节点连线','Node graph')}</button>
    </div>}
    {view==='logic' ? <SvlLogicView source={source} t={translate} onInspect={id=>{setFocusNode(id);setSelected(nodeKey(scope.id,id));setView('tree')}}/> : <>
    {focusNode && <div className="svl-diagram-focus"><span>{focusNode}</span><button type="button" onClick={()=>setFocusNode(undefined)}>{tr('显示全部计算','Show all calculations')}</button></div>}
    {view==='tree' ? <SvlExpressionTree source={source} t={translate} nodeId={focusNode} onInspect={(id,nodeId)=>{
      const definition=id==='strategy'?source.nodes?.find(node=>node.id===nodeId):[...(source.functions??[]),...[...(source.modules??[]),...(source.extensions??[])].flatMap(ext=>(ext.module?.functions??[]).map(fn=>({...fn,id:`${ext.id}/${fn.id}`})))].find(fn=>`function:${fn.id}`===id)?.nodes?.find(node=>node.id===nodeId);
      if(definition) onInspect(definition);
    }}/> : <SvlGraphCanvas key={focusNode ?? 'all'} layout={layout} label={title} selectedKey={selected} t={translate} statusFor={() => 'idle'} onSelect={key => {
    setSelected(key);
    const node = scope.nodes.find(node => nodeKey(scope.id, node.id) === key);
    if (node) onInspect(node);
  }} />}</>}
  </>;
}
  const fail = message => { throw new Error(`SesameBacktest: ${message}`); };
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  };
  const tr = (zh, en) => document.documentElement.lang.startsWith('zh') ? zh : en;
  function graphView(target, graph, source) {
    target.setAttribute('data-report-svl', '');
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail('Use the exact graph produced by strategy_graph');
    const nodeDetails = new Map((source?.nodes ?? []).map(node => [node.id, node]));
    const draw = (container, part, definitions) => {
      const frame = el('div', null, 'report-svl-canvas'); container.append(frame);
      const disclosure = el('details'), detail = el('pre', '', 'backtest-node');
      disclosure.setAttribute('data-report-evidence', ''); disclosure.append(el('summary', tr('计算细节', 'Node definition')), detail); container.append(disclosure);
      const root = createRoot(frame); roots.set(frame, root);
      flushSync(() => root.render(<ScopeCanvas graph={part} source={part===graph ? source : undefined} title={graph.title ?? tr('策略逻辑', 'Strategy logic')} onInspect={node => {
        detail.textContent = JSON.stringify({ ...(node.op ? node : definitions.get(node.id) ?? node), ...(node.functionId ? { resolvedFunctionId: node.functionId } : {}) }, null, 2);
        disclosure.open = true; window.SesameAppendix?.reveal(disclosure);
      }} />));
    };
    const definitions = el('details');
    definitions.setAttribute('data-report-evidence', ''); definitions.append(el('summary', tr('参数、输入与初始状态', 'Parameters, inputs and initial state')), el('pre', JSON.stringify({ parameters: source?.parameters, inputs: source?.inputs, state: source?.state, semantics: source?.semantics }, null, 2), 'backtest-node'));
    if (source?.parameters || source?.inputs || source?.state || source?.semantics) target.append(definitions);
    draw(target, graph, nodeDetails);
    const functions = new Map((source?.functions ?? []).map(fn => [fn.id, fn]));
    for (const module of source?.modules ?? []) for (const fn of module.module?.functions ?? []) functions.set(`${module.id}/${fn.id}`, fn);
    for (const extension of source?.extensions ?? []) for (const fn of extension.module?.functions ?? []) functions.set(`${extension.id}/${fn.id}`, fn);
    for (const fn of graph.functions ?? []) {
      const block = el('details'); block.setAttribute('data-report-evidence', ''); block.append(el('summary', `${tr('函数', 'Function')}: ${fn.id}`)); target.append(block);
      block.append(el('pre', JSON.stringify({ parameters: fn.parameters, output: fn.output, result: fn.result }, null, 2), 'backtest-node'));
      let drawn = false;
      block.addEventListener('toggle', () => {
        if (block.open && !drawn) { drawn = true; draw(block, fn, new Map((functions.get(fn.id)?.nodes ?? []).map(node => [node.id, node]))); }
      });
    }
  }

export function render(target, graph, source) {
  graphView(target, graph, source);
}
export function mount(root = document) {
  for (const target of root.querySelectorAll('[data-report-svl]:not([data-svl-mounted])')) {
    const input = target.querySelector('script[type="application/json"]');
    const { graph, source } = JSON.parse(input.textContent);
    graphView(target, graph, source);
    target.setAttribute('data-svl-mounted', '');
  }
}
export function destroy(root = document) {
  for (const [element, react] of roots) if (root === document || element === root || root.contains(element)) {
    react.unmount(); roots.delete(element);
  }
}
new MutationObserver(() => {
  for (const [element, react] of roots) if (!element.isConnected) { react.unmount(); roots.delete(element); }
}).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pagehide', () => destroy());
