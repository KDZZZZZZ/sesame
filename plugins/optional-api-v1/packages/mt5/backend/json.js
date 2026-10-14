import { Value } from '@sesame/plugin-sdk/schema/value';
import { requireValue } from './support.js';

const integerText = /^-?(?:0|[1-9]\d*)$/;
const losslessIntegerKeys = new Set(['run_id']);
// Tool schemas are fetched for each call and reach validation without cloning.
// Retain numeric tokens so large numeric enum/const values cannot become strings.
const numberTokens = new WeakMap();

export function isLosslessIntegerText(value) { return typeof value === 'string' && integerText.test(value); }
export function isLosslessIntegerKey(key) { return losslessIntegerKeys.has(key); }

export function parseLosslessJson(text) {
  return JSON.parse(text, function (key, value, context) {
    if (typeof value === 'number' && typeof context?.source === 'string') {
      const source = context.source;
      if (Number.isInteger(value) && !Number.isSafeInteger(value) && integerText.test(source)) value = source;
      if (!numberTokens.has(this)) numberTokens.set(this, new Map());
      numberTokens.get(this).set(key, { source, value });
    }
    return value;
  });
}

export function stringifyLosslessJson(value) {
  return JSON.stringify(value);
}

export function assertNoUnsafeNativeIds(value, path = []) {
  if (!value || typeof value !== 'object') return;
  for (const [key, current] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (isLosslessIntegerKey(key)) {
      requireValue(typeof current !== 'number' || Number.isSafeInteger(current), `${nextPath.join('.')} 超过 JS 安全整数；请使用目录返回的精确字符串 ID`, 422, 'unsafe_native_id');
    }
    if (current && typeof current === 'object') assertNoUnsafeNativeIds(current, nextPath);
  }
}

const unsupported = condition => requireValue(condition, '此 inputSchema 不支持无损 run_id 校验；请刷新目录或使用受支持的原生定义', 422, 'unsupported_native_id_schema');
const valid = condition => requireValue(condition, '参数不符合工具 inputSchema；请先读取 mt5_catalog 中的定义');
const annotations = ['$schema', '$id', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly'];
const objectKeywords = new Set([...annotations, 'type', 'properties', 'required', 'additionalProperties', 'minProperties', 'maxProperties']);
const numericKeywords = new Set([...annotations, 'type', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'enum', 'const']);
const contains = (value, predicate) => Boolean(value && typeof value === 'object' && Object.entries(value).some(([key, item]) => predicate(key, item, value) || contains(item, predicate)));
const tokenFor = (parent, key) => {
  const token = numberTokens.get(parent)?.get(String(key));
  return token && Object.is(token.value, parent[key]) ? token.source : undefined;
};

// The SDK must see numeric schema literals as numbers, including in untouched
// sibling schemas. Exact checks below use the original tokens for run_id only.
function sdkSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const entries = Object.entries(schema).map(([key, item]) => [key, tokenFor(schema, key) === undefined ? sdkSchema(item) : Number(tokenFor(schema, key))]);
  return Array.isArray(schema) ? entries.map(([, item]) => item) : Object.fromEntries(entries);
}

function rational(parent, key) {
  let source = tokenFor(parent, key);
  if (source === undefined) {
    const value = parent[key];
    if (typeof value !== 'number') return null;
    unsupported(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)));
    source = String(value);
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  const scale = (match?.[3]?.length ?? 0) - Number(match?.[4] ?? 0);
  unsupported(match && source.length <= 1024 && Number.isSafeInteger(scale) && Math.abs(scale) <= 1024);
  const numerator = BigInt(match[1] + match[2] + (match[3] ?? ''));
  return scale < 0 ? [numerator * 10n ** BigInt(-scale), 1n] : [numerator, 10n ** BigInt(scale)];
}

function checkNumericId(schema, value) {
  unsupported(Object.keys(schema).every(key => numericKeywords.has(key)));
  requireValue(isLosslessIntegerText(value) && value.length <= 1024, 'run_id 需要十进制整数 ID 字符串（最多 1024 字符）', 422, 'invalid_native_id');
  const id = BigInt(value), equals = (parent, key) => { const number = rational(parent, key); return number !== null && id * number[1] === number[0]; };
  for (const [key, compare] of Object.entries({ minimum: (a, b) => a >= b, maximum: (a, b) => a <= b, exclusiveMinimum: (a, b) => a > b, exclusiveMaximum: (a, b) => a < b, multipleOf: (a, b) => a % b === 0n })) {
    if (!Object.hasOwn(schema, key)) continue;
    const number = rational(schema, key); unsupported(number && (key !== 'multipleOf' || number[0] > 0n));
    valid(compare(id * number[1], number[0]));
  }
  if (Object.hasOwn(schema, 'enum')) { unsupported(Array.isArray(schema.enum)); valid(schema.enum.some((_item, index) => equals(schema.enum, index))); }
  if (Object.hasOwn(schema, 'const')) valid(equals(schema, 'const'));
}

export function nativeValueForLosslessIds(schema, value) {
  assertNoUnsafeNativeIds(value);
  const property = schema?.properties?.run_id;
  const numeric = ['string', 'number'].includes(typeof value?.run_id) && ['integer', 'number'].includes(property?.type);
  unsupported(!contains(value, (key, item, parent) => isLosslessIntegerKey(key) && typeof item === 'number' && !(parent === value && (numeric || property?.type === 'string'))));
  const checked = sdkSchema(schema);
  if (numeric) {
    // A deliberately bounded adapter, not a JSON Schema evaluator. Object-wide
    // composition and references may constrain the substituted field elsewhere.
    unsupported((schema.type === undefined || schema.type === 'object') && Object.keys(schema).every(key => objectKeywords.has(key)));
    unsupported(!contains(schema, key => ['$ref', '$dynamicRef', '$recursiveRef'].includes(key)));
    checkNumericId(property, String(value.run_id));
    checked.properties.run_id = { const: value.run_id };
  }
  let accepted;
  try { accepted = Value.Check(checked, value); }
  catch (error) { if (contains(value, (key, item) => isLosslessIntegerKey(key) && typeof item === 'string')) unsupported(false); throw error; }
  if (!accepted && !numeric && property?.type !== 'string' && contains(value, (key, item) => isLosslessIntegerKey(key) && typeof item === 'string')) unsupported(false);
  valid(accepted);
  if (!numeric || typeof value.run_id !== 'string') return value;
  requireValue(typeof JSON.rawJSON === 'function', '当前 Node 运行时不能无损发送 run_id，请升级后重试', 500, 'lossless_json_unavailable');
  return { ...value, run_id: JSON.rawJSON(value.run_id) };
}
