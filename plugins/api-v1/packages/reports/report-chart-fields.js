const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim() && value.length <= 20000;
export const kitKinds = new Set(['line', 'area', 'bar', 'hbar', 'scatter', 'heatmap']);
export const compositionKinds = new Set(['stream', 'stacked-rungs', 'dot-heatmap', 'funnel', 'spectrum', 'tick-donut', 'barcode', 'bubble-ledger', 'category-links', 'outcome-tally', 'paired-rungs', 'rank-race']);
const axisKinds = new Set(['line', 'area', 'bar', 'hbar', 'scatter']);
const kinds = new Set([...kitKinds, ...compositionKinds, 'matrix', 'units', 'waterfall', 'dumbbell', 'strip', 'histogram', 'boxplot', 'ridgeline', 'violin', 'calendar', 'parallel', 'bump', 'lifecycle', 'treemap', 'threads', 'flow', 'network-circular', 'network-force', 'decision-tree', 'candlestick']);
const reserved = new Set(['rows', 'data', 'nodes', 'kind', 'title', 'caption', 'onSelect', 'onFilter', 'onError', '__proto__', 'constructor', 'prototype']);
function safeOptions(options) {
  check(object(options), 'Chart options must be an object');
  check(Object.keys(options).every(key => !reserved.has(key) && !/^on[A-Z]/.test(key)), 'Chart identity, fixed data and callbacks cannot be supplied through options');
  const visit = value => {
    if (Array.isArray(value)) return value.every(visit);
    if (object(value)) return Object.entries(value).every(([key, entry]) => !['__proto__', 'constructor', 'prototype'].includes(key) && visit(entry));
    return value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value);
  };
  check(visit(options), 'Chart options must contain safe JSON values');
}
function axisOptions(kind, options) {
  check(!(kitKinds.has(kind) || kind === 'matrix') || options.tone == null || ['neutral','signed','positive','negative'].includes(options.tone), 'Chart tone must be neutral, signed, positive or negative');
  // These reportKit charts read xType; heatmap and other renderers do not.
  // Preserve the runtime's nullish fallback rather than choosing an axis here.
  check(!axisKinds.has(kind) || options.xType == null || ['time', 'number', 'category'].includes(options.xType), 'Chart xType must be time, number or category');
}
export function chartDefinition(chart) {
  check(object(chart) && kinds.has(chart.kind), 'Chart field requires a supported built-in kind');
  check(Object.keys(chart).every(key => ['kind', 'options', 'columns', 'data_requirements', 'evidence_role'].includes(key)), 'Unknown chart definition field');
  safeOptions(chart.options ?? {});
  axisOptions(chart.kind, chart.options ?? {});
  check(Array.isArray(chart.columns) && chart.columns.length > 0 && chart.columns.length <= 32 && chart.columns.every(text), 'Chart field requires source columns');
  check(text(chart.data_requirements), 'Chart field requires data_requirements');
  check(chart.evidence_role === undefined || ['descriptive', 'historical', 'prediction'].includes(chart.evidence_role), 'Invalid chart evidence role');
}
export function chartValue(value, definition) {
  chartDefinition(definition);
  check(object(value) && Array.isArray(value.rows) && value.rows.length > 0 && value.rows.length <= 2500 && value.rows.every(object), 'Chart result needs 1–2500 fixed rows; use unavailable for missing data');
  check(text(value.source_note) && text(value.takeaway), 'Chart result requires a source_note and evidence-based takeaway');
  check(Object.keys(value).every(key => ['rows', 'source_note', 'takeaway', 'options', 'nodes'].includes(key)), 'Unknown chart result field');
  safeOptions(value.options ?? {});
  if (value.nodes !== undefined) check(Array.isArray(value.nodes) && value.nodes.length <= 2500 && value.nodes.every(object), 'Chart nodes must be fixed rows');
  const options = { ...definition.options, ...value.options };
  axisOptions(definition.kind, options);
  const needed = new Set(definition.columns);
  if (compositionKinds.has(definition.kind)) {
    for (const key of ['series', 'item', 'total', 'label', 'status', 'event']) if (typeof options[key] === 'string') needed.add(options[key]);
    if (definition.kind === 'spectrum') {
      check(Array.isArray(options.dimensions) && options.dimensions.length > 0 && options.dimensions.length <= 10, 'Spectrum requires 1–10 dimensions');
      for (const dimension of options.dimensions) {
        check(object(dimension) && text(dimension.field) && text(dimension.left) && text(dimension.right) && Number.isFinite(dimension.min) && Number.isFinite(dimension.max) && dimension.min < dimension.max, 'Spectrum dimensions require a source field, endpoint meanings and explicit bounds');
        needed.add(dimension.field);
      }
      check(text(options.focus), 'Spectrum requires a supplied focus item');
    }
    if (['stacked-rungs', 'paired-rungs', 'outcome-tally', 'tick-donut'].includes(definition.kind)) check(typeof options.unitValue === 'number' && Number.isFinite(options.unitValue) && options.unitValue > 0, 'Tick charts require an explicit positive unitValue');
    if (definition.kind === 'outcome-tally') check(typeof options.overlap === 'boolean', 'Outcome tally requires overlap true or false');
  }
  if (definition.kind === 'candlestick' && options.overlays !== undefined) {
    check(Array.isArray(options.overlays) && options.overlays.length <= 12, 'Candlestick overlays require at most 12 price-column mappings');
    const seen = new Set();
    for (const overlay of options.overlays) {
      check(object(overlay) && Object.keys(overlay).every(key => ['field','label','group','style','visible'].includes(key)) && text(overlay.field) && text(overlay.label), 'Overlay needs a field and label; only computed price columns are supported');
      check(!seen.has(overlay.field), 'Duplicate overlay field'); seen.add(overlay.field);
      check(overlay.group === undefined || text(overlay.group), 'Invalid overlay group');
      check(overlay.style === undefined || ['solid','dashed'].includes(overlay.style), 'Invalid overlay style');
      check(overlay.visible === undefined || typeof overlay.visible === 'boolean', 'Invalid overlay visibility');
      needed.add(overlay.field);
    }
  }
  for (const key of ['x', 'xEnd', 'y', 'value', 'time', 'open', 'high', 'low', 'close', 'before', 'after', 'group']) {
    const mapping = options[key];
    if (typeof mapping === 'string') needed.add(mapping);
    else if (Array.isArray(mapping)) mapping.forEach(field => needed.add(field));
  }
  for (const column of needed) check(value.rows.some(row => Object.hasOwn(row, column)), `Chart source column is missing: ${column}`);
  if (['histogram', 'boxplot', 'ridgeline', 'violin'].includes(definition.kind)) check(text(options.method), 'Statistical chart requires the registered calculation method');
  if (definition.kind === 'histogram') check(Number.isSafeInteger(options.sampleCount) && options.sampleCount > 0, 'Histogram requires the registered sampleCount');
  return true;
}
