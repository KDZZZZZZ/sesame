/** The source module is a portable editable/published representation. Drawing
 * geometry is validated declarative data, never code executed by the renderer. */
import { DRAWING_SPEC_SCHEMA, drawingSchemaError } from './drawing-schema.js';
export { DRAWING_SCHEMA, DRAWING_LIMIT, DRAWING_KINDS } from './drawing-schema.js';
const prefix = 'export const drawing = ';
const suffix = ';\n\nexport function compute() {\n  return { status: "ready", diagnostics: [], series: [], drawings: [drawing] };\n}\n';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function check(value, message) { if (!value) throw new Error(message); }
export function validateDrawing(value) {
  const error = drawingSchemaError(DRAWING_SPEC_SCHEMA, value);
  check(!error, `Invalid drawing: ${error}`);
  return structuredClone(value);
}

export function drawingSource(drawing) {
  return prefix + JSON.stringify(validateDrawing(drawing), null, 2) + suffix;
}

export function drawingFromSource(source) {
  check(typeof source === 'string' && source.length <= 16384, '绘图代码过长');
  const text = source.replaceAll('\r\n', '\n').trim();
  check(text.startsWith(prefix) && text.endsWith(suffix.trimEnd()), '请保留绘图模块结构，仅编辑 drawing 的内容');
  let drawing;
  try { drawing = JSON.parse(text.slice(prefix.length, -suffix.trimEnd().length)); }
  catch { throw new Error('绘图内容格式无效，请检查引号和逗号'); }
  return validateDrawing(drawing);
}

/** JSON keys may arrive in a different order from the API or an editor. */
export function drawingBindingKey(binding) {
  const stable = value => Array.isArray(value) ? value.map(stable) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  return JSON.stringify(stable(binding));
}
