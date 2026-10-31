// A presentation of supplied steps and dependencies, never a trading-rule generator.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const check = (ok, message) => { if (!ok) throw Error(`Report logic: ${message}`); };
const text = value => typeof value === 'string' && value.trim() && value.length <= 2000;
export function renderLogicDiagram(logic) {
  check(object(logic) && Object.keys(logic).every(k => ['type', 'title', 'note', 'nodes', 'edges'].includes(k)), 'supply a title, nodes and edges');
  check(logic.type === undefined || logic.type === 'logic', 'unknown content type');
  check(text(logic.title), 'title is required');
  check(logic.note === undefined || text(logic.note), 'note must be text');
  check(Array.isArray(logic.nodes) && logic.nodes.length >= 1 && logic.nodes.length <= 80, 'supply 1–80 nodes');
  check(Array.isArray(logic.edges) && logic.edges.length <= 160, 'supply at most 160 edges');
  const nodes = new Map();
  for (const input of logic.nodes) {
    check(object(input) && Object.keys(input).every(k => ['id', 'label', 'detail'].includes(k)), 'unknown node property');
    check(text(input.id) && text(input.label) && (input.detail === undefined || text(input.detail)), 'nodes need an id and a readable label');
    check(!nodes.has(input.id), 'node IDs must be unique');
    nodes.set(input.id, { ...input, incoming: 0, children: [] });
  }
  const edges = new Set();
  for (const edge of logic.edges) {
    check(object(edge) && Object.keys(edge).every(k => ['from', 'to', 'label'].includes(k)), 'unknown edge property');
    check(nodes.has(edge.from) && nodes.has(edge.to) && edge.from !== edge.to, 'each connection must name two existing nodes');
    check(edge.label === undefined || text(edge.label), 'connection labels must be text');
    const key = JSON.stringify([edge.from, edge.to]); check(!edges.has(key), 'duplicate connection'); edges.add(key);
    nodes.get(edge.from).children.push(nodes.get(edge.to)); nodes.get(edge.to).incoming++;
  }
  const queue = [...nodes.values()].filter(n => n.incoming === 0), ordered = [];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]; ordered.push(node);
    for (const child of node.children) {
      if (--child.incoming === 0) queue.push(child);
    }
  }
  check(ordered.length === nodes.size, 'show one pass of a repeated process; circular dependencies are not supported');
  const graph = {
    title: logic.title,
    nodes: logic.nodes.map(node => ({ id: node.id, label: node.label, operator: node.detail ?? '', effect: 'pure' })),
    edges: logic.edges,
  };
  const source = { nodes: logic.nodes.map(node => ({ ...node,
    inputs: logic.edges.filter(edge => edge.to === node.id).map(edge => ({ from: edge.from, ...(edge.label ? { label: edge.label } : {}) })),
  })) };
  const payload = JSON.stringify({ graph, source }).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `<section data-report-svl><h3>${escape(logic.title)}</h3>${logic.note ? `<p class="report-source">${escape(logic.note)}</p>` : ''}<script type="application/json">${payload}</script></section>`;
}

// Project an evaluator's actual expression into dependencies. Unknown operators
// retain their recorded names; this projection never guesses their semantics.
export function factorLogic(expression) {
  if (!object(expression) || typeof expression.op !== 'string') return null;
  const nodes = [], edges = [];
  const fields = { close: '收盘价', open: '开盘价', high: '最高价', low: '最低价', volume: '成交量' };
  const labels = { add: '①加上②', sub: '①减去②', mul: '①乘以②', div: '①除以②', neg: '取相反数', abs: '取绝对值', log: '取对数', mean: '求平均值', std: '计算波动大小', sum: '求和', lag: '取之前的值', delta: '计算与之前的差' };
  function visit(value, depth = 0) {
    if (!object(value) || typeof value.op !== 'string' || depth > 20 || nodes.length >= 78) return null;
    if (value.op === 'field' && typeof value.name !== 'string' || value.op === 'constant' && !Number.isFinite(value.value)) return null;
    const id = `step-${nodes.length}`;
    const label = value.op === 'field' ? fields[value.name] ?? value.name : value.op === 'constant' ? `数值 ${value.value}` : labels[value.op] ?? value.op;
    const node = { id, label, ...(Number.isInteger(value.window) && value.window > 0 ? { detail: `${value.window} 个周期` } : {}) };
    nodes.push(node);
    const args = value.args ?? [];
    if (!Array.isArray(args)) return null;
    for (let i = 0; i < args.length; i++) {
      const from = visit(args[i], depth + 1); if (!from) return null;
      edges.push({ from, to: id, ...(args.length > 1 ? { label: `输入${i + 1}` } : {}) });
    }
    return id;
  }
  const result = visit(expression); if (!result) return null;
  nodes.push({ id: 'factor-result', label: '因子数值' }); edges.push({ from: result, to: 'factor-result' });
  return { title: '这个因子怎么算出来', nodes, edges };
}
