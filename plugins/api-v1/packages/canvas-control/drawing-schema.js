/** Authoritative, dependency-free drawing contract. Package copies are checked
 * against this file; neither the host nor installed plugins import each other. */
export const DRAWING_SCHEMA = 'sesame-drawing/1';
export const DRAWING_LIMIT = 64;
export const DRAWING_KINDS = ['trend', 'horizontal', 'rectangle', 'fibonacci'];
const text = { type: 'string', minLength: 1, maxLength: 4096 };
const identifier = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,100}$' };
const revision = { type: ['string', 'null'], minLength: 1, maxLength: 100 };
export const DRAWING_BINDING_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['source', 'instrument', 'spec'], properties: {
    source: { type: 'object', additionalProperties: false, required: ['providerId', 'revision'], properties: {
      providerId: { ...text, pattern: '^.+#.+$' }, revision: text, binding: { type: 'object' },
    } },
    instrument: { type: 'object', additionalProperties: false, required: ['sourceId', 'instrumentId'], properties: { sourceId: text, instrumentId: text } },
    spec: { type: 'object', additionalProperties: false, required: ['timeframe', 'priceBasis', 'adjustment', 'calendarRevision'], properties: {
      timeframe: text, priceBasis: { enum: ['bid', 'ask', 'mid', 'last'] }, adjustment: { enum: ['none', 'forward', 'backward'] }, session: text,
      calendarRevision: { type: 'object', required: ['status'], properties: { status: { enum: ['value', 'unknown', 'not_applicable', 'unsupported'] } } },
    } },
  },
};
export const DRAWING_SPEC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'kind', 'title', 'anchors', 'style'], properties: {
    schemaVersion: { const: DRAWING_SCHEMA }, kind: { enum: DRAWING_KINDS },
    title: { type: 'string', minLength: 1, maxLength: 80, pattern: '^(?=[^\\u0000-\\u001f]*$)(?=.*\\S).+$' },
    anchors: { type: 'array', minItems: 1, maxItems: 2, items: {
      type: 'object', additionalProperties: false, required: ['time', 'price'], properties: {
        time: { type: 'number', minimum: -8640000000000, maximum: 8640000000000 },
        price: { type: 'number', minimum: -1e15, maximum: 1e15 },
      },
    } },
    style: { type: 'object', additionalProperties: false, required: ['color', 'width', 'lineStyle', 'fillOpacity'], properties: {
      color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' }, width: { type: 'integer', enum: [1, 2, 3, 4] },
      lineStyle: { enum: ['solid', 'dashed', 'dotted'] }, fillOpacity: { type: 'number', minimum: 0, maximum: 0.4 },
    } },
  },
  anyOf: [
    { properties: { kind: { const: 'horizontal' }, anchors: { minItems: 1, maxItems: 1 } } },
    { properties: { kind: { enum: ['trend', 'rectangle', 'fibonacci'] }, anchors: { minItems: 2, maxItems: 2 } } },
  ],
};
const mutation = ['command_id', 'expected_version', 'binding', 'expected_revision', 'expected_attachment'];
const noGeometry = { not: { anyOf: [{ required: ['drawing'] }, { required: ['source'] }] } };
export const DRAWING_COMMAND_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['action', 'chart_id'], properties: {
    action: { enum: ['read', 'put', 'remove', 'migrate'] }, command_id: { ...identifier, minLength: 16 },
    expected_version: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, client_id: identifier, chart_id: identifier, drawing_id: identifier,
    expected_revision: revision, expected_attachment: { ...revision, description: 'Exact attached canvas_script id; null only when creating a drawing.' },
    binding: DRAWING_BINDING_SCHEMA, target_binding: DRAWING_BINDING_SCHEMA, drawing: DRAWING_SPEC_SCHEMA,
    source: { type: 'string', maxLength: 16384 },
  },
  oneOf: [
    { properties: { action: { const: 'read' } }, required: ['drawing_id'], not: { anyOf: [{ required: ['drawing'] }, { required: ['source'] }, { required: ['target_binding'] }] } },
    { properties: { action: { const: 'remove' } }, required: [...mutation, 'drawing_id'], not: { anyOf: [{ required: ['drawing'] }, { required: ['source'] }, { required: ['target_binding'] }] } },
    { properties: { action: { const: 'migrate' } }, required: [...mutation, 'drawing_id', 'target_binding'], ...noGeometry },
    { properties: { action: { const: 'put' } }, required: mutation, oneOf: [{ required: ['drawing'] }, { required: ['source'] }], not: { required: ['target_binding'] } },
  ],
};

/** Evaluate only the closed schema vocabulary above, not arbitrary plugin JSON
 * Schema. This keeps the exact constraints usable in a browser and native package. */
export function drawingSchemaError(schema, value, path = '$') {
  const object = value !== null && typeof value === 'object' && !Array.isArray(value);
  const types = { null: value === null, object, array: Array.isArray(value), string: typeof value === 'string', number: typeof value === 'number' && Number.isFinite(value), integer: Number.isSafeInteger(value) };
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(type => types[type])) return `${path}: invalid type`;
  if (Object.hasOwn(schema, 'const') && value !== schema.const || schema.enum && !schema.enum.includes(value)) return `${path}: unsupported value`;
  if (typeof value === 'number' && (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return `${path}: number outside budget`;
  if (typeof value === 'string' && (schema.minLength !== undefined && [...value].length < schema.minLength || schema.maxLength !== undefined && [...value].length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern, 'u').test(value))) return `${path}: invalid text`;
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) return `${path}: invalid item count`;
    if (schema.items) for (let i = 0; i < value.length; i++) { const error = drawingSchemaError(schema.items, value[i], `${path}[${i}]`); if (error) return error; }
  }
  if (object) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) return `${path}.${key}: required`;
    for (const key of Object.keys(value)) {
      if (schema.additionalProperties === false && !Object.hasOwn(schema.properties ?? {}, key)) return `${path}.${key}: unknown field`;
      if (Object.hasOwn(schema.properties ?? {}, key)) { const error = drawingSchemaError(schema.properties[key], value[key], `${path}.${key}`); if (error) return error; }
    }
  }
  if (schema.anyOf && !schema.anyOf.some(branch => !drawingSchemaError(branch, value, path))) return `${path}: no valid alternative`;
  if (schema.oneOf && schema.oneOf.filter(branch => !drawingSchemaError(branch, value, path)).length !== 1) return `${path}: expected exactly one alternative`;
  if (schema.not && !drawingSchemaError(schema.not, value, path)) return `${path}: forbidden combination`;
  return '';
}
