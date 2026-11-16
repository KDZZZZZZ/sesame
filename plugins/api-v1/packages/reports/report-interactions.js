// Controls change a view of supplied records only. No query or calculation runs.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const scalar = value => value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.trim() && value.length <= 200;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const keys = (value, allowed) => check(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'Unsupported interaction property');

export function controlScope(controls) {
  check(Array.isArray(controls) && controls.length > 0 && controls.length <= 8, 'Group controls need 1–8 supplied controls');
  const scope = new Map();
  for (const control of controls) {
    keys(control, control.kind === 'select' ? ['id', 'label', 'kind', 'options', 'value'] : ['id', 'label', 'kind', 'min', 'max', 'step', 'format', 'value']);
    check(text(control.id) && text(control.label) && !scope.has(control.id), 'Control IDs must be unique within this group and labels must be supplied');
    if (control.kind === 'select') {
      check(Array.isArray(control.options) && control.options.length > 0 && control.options.length <= 2500, 'Select needs fixed options');
      const seen = new Set();
      for (const option of control.options) {
        keys(option, ['value', 'label']);
        check(scalar(option.value) && (option.label === undefined || text(option.label)), 'Select options need scalar values and optional labels');
        const key = JSON.stringify(option.value); check(!seen.has(key), 'Select option values must be unique'); seen.add(key);
      }
      check(seen.has(JSON.stringify(control.value)), 'Select value must be one of its supplied options');
    } else {
      check(control.kind === 'range' && Number.isFinite(control.min) && Number.isFinite(control.max) && control.min < control.max, 'Range needs finite min < max');
      check(Array.isArray(control.value) && control.value.length === 2 && control.value.every(Number.isFinite)
        && control.min <= control.value[0] && control.value[0] <= control.value[1] && control.value[1] <= control.max, 'Selected range must be ordered and inside its supplied limits');
      check(control.step === undefined || Number.isFinite(control.step) && control.step > 0, 'Range step must be positive');
      check(control.format === undefined || ['number', 'time'].includes(control.format), 'Range format must be number or time');
    }
    scope.set(control.id, control);
  }
  return scope;
}

export function validateInteraction(block, controls = new Map(), columns = []) {
  const get = id => { check(controls.has(id), `Unknown local control: ${id}`); return controls.get(id); };
  if (block.filter !== undefined) {
    check(Array.isArray(block.filter) && block.filter.length <= 8, 'Filter must contain at most 8 field/control pairs');
    for (const filter of block.filter) {
      keys(filter, ['field', 'control', 'operator']);
      check(columns.includes(filter.field), `Filter field does not exist: ${filter.field}`);
      const control = get(filter.control), operator = filter.operator ?? 'eq';
      check(operator === 'eq' && control.kind === 'select' || operator === 'between' && control.kind === 'range', 'Filter operator must match its select or range control');
    }
  }
  if (block.option_controls !== undefined) {
    keys(block.option_controls, ['x', 'y', 'value', 'focus', 'frame']);
    for (const [option, id] of Object.entries(block.option_controls)) {
      const control = get(id);
      check(control.kind === 'select' && control.options.every(item => option === 'frame' ? ['number', 'string'].includes(typeof item.value) : text(item.value)), 'Chart option controls require supplied field or option names');
      if (['x', 'y', 'value'].includes(option)) check(control.options.every(item => columns.includes(item.value)), `Chart ${option} control must select existing columns`);
    }
  }
  if (block.selection !== undefined) {
    keys(block.selection, ['column', 'control']);
    check(columns.includes(block.selection.column) && get(block.selection.control).kind === 'select', 'Table selection needs an existing column and a select control');
    const index = columns.indexOf(block.selection.column), options = get(block.selection.control).options.map(item => item.value);
    check(block.rows.every(row => options.includes(row[index])), 'Every selectable row must use a supplied control value');
  }
  check(block.page_size === undefined || Number.isInteger(block.page_size) && block.page_size >= 1 && block.page_size <= 200, 'Table page_size must be 1–200');
}

export function filterRows(rows, filters = [], controls = new Map()) {
  return rows.filter(row => filters.every(filter => {
    const control = controls.get(filter.control), value = row[filter.field];
    if (control.kind === 'select') return value === control.value;
    const number = control.format === 'time' && typeof value === 'string' ? Date.parse(value) : value;
    return typeof number === 'number' && Number.isFinite(number) && number >= control.value[0] && number <= control.value[1];
  }));
}

export function controlledOptions(options, mapping = {}, controls = new Map()) {
  return { ...options, ...Object.fromEntries(Object.entries(mapping).map(([option, id]) => [option, controls.get(id).value])) };
}
