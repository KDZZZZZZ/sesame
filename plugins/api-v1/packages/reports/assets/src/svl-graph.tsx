// Shared application canvas for supplied generic dependencies.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SvlGraphCanvas, useSvlTextMeasurement } from '@sesame/svl-canvas';
import { layoutScope, nodeKey } from '@sesame/svl-layout';
import './svl-report.css';

const roots = new Map();
const translate = (labels, values = {}) => String(typeof labels === 'string' ? labels : labels[document.documentElement.lang.startsWith('zh') ? 'zh-CN' : 'en']).replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token);
function GraphCanvas({ graph, onInspect }) {
  const scope = useMemo(() => ({ ...graph, id: graph.id ?? 'diagram' }), [graph]);
  const measureText = useSvlTextMeasurement();
  const layout = useMemo(() => layoutScope(scope, { measureText }), [scope, measureText]);
  const [selected, setSelected] = useState();
  return <SvlGraphCanvas layout={layout} label={graph.title} selectedKey={selected} t={translate} statusFor={() => 'idle'} onSelect={key => {
    setSelected(key);
    const node = scope.nodes.find(node => nodeKey(scope.id, node.id) === key);
    if (node) onInspect(node);
  }}/>;
}
const element = (tag, text, className) => {
  const node = document.createElement(tag); if (text != null) node.textContent = String(text);
  if (className) node.className = className; return node;
};
export function render(target, graph, source) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Diagram requires supplied nodes and edges');
  const frame = element('div', null, 'report-svl-canvas'), detail = element('div', '', 'report-node-detail');
  detail.hidden = true; target.append(frame, detail);
  const records = new Map((source?.nodes ?? []).map(node => [node.id, node]));
  const root = createRoot(frame); roots.set(frame, root);
  flushSync(() => root.render(<GraphCanvas graph={graph} onInspect={node => {
    const record = records.get(node.id), text = record?.detail;
    detail.replaceChildren(); detail.hidden = !text;
    if (text) detail.append(element('strong', record.label), element('p', text));
  }}/>));
}
export function mount(root = document) {
  for (const target of root.querySelectorAll('[data-report-svl]:not([data-svl-mounted])')) {
    const { graph, source } = JSON.parse(target.querySelector('script[type="application/json"]').textContent);
    render(target, graph, source); target.setAttribute('data-svl-mounted', '');
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
