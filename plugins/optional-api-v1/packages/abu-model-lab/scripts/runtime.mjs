// SPDX-License-Identifier: GPL-3.0-only
// Sesame contributors. Shared source copied into each independently installable ABU baseline.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, openSync, closeSync, fstatSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function check(ok, message) { if (!ok) throw new Error(message); }
export function finite(value, name, min = -Number.MAX_VALUE, max = Number.MAX_VALUE) {
  check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${name}: finite number in [${min}, ${max}] required`);
  return value;
}
export function integer(value, name, min = 1, max = 10000) {
  finite(value, name, min, max); check(Number.isSafeInteger(value), `${name}: integer required`); return value;
}
export function text(value, name, max = 500) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${name}: nonempty text <= ${max} required`); return value;
}
export function instant(value, name = 'timestamp') {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), `${name}: canonical UTC timestamp required`);
  const at = Date.parse(value); check(Number.isFinite(at) && new Date(at).toISOString() === value, `${name}: invalid calendar timestamp`); return at;
}
export function array(value, name, min = 1, max = 10000) {
  check(Array.isArray(value) && value.length >= min && value.length <= max, `${name}: array length ${min}..${max} required`); return value;
}
export function parameters(input, allowed) {
  const p = input.parameters ?? {};
  check(p && typeof p === 'object' && !Array.isArray(p), 'parameters: object required');
  check(Object.keys(p).every(key => allowed.includes(key)), `Unknown parameter; supported: ${allowed.join(', ')}`); return p;
}
export const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export const variance = values => { const m = mean(values); return m === null ? null : mean(values.map(v => (v - m) ** 2)); };
export const std = values => { const v = variance(values); return v === null ? null : Math.sqrt(v); };
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  check(value === null || ['boolean', 'string', 'number'].includes(typeof value), 'Only JSON data supported');
  check(typeof value !== 'number' || Number.isFinite(value), 'Non-finite JSON number'); return JSON.stringify(value);
}
export const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function boundedJson(value, depth = 0, counter = { count: 0 }) {
  check(depth <= 24 && ++counter.count <= 250000, 'JSON complexity limit exceeded');
  if (value && typeof value === 'object') {
    check(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Plain JSON objects required');
    for (const child of Object.values(value)) boundedJson(child, depth + 1, counter);
  } else check(value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)), 'Only finite JSON values supported');
}
export function validateInput(input) {
  boundedJson(input);
  check(input && !Array.isArray(input) && typeof input === 'object' && input.schema_version === 1, 'schema_version: 1 required');
  instant(input.as_of, 'as_of');
  check(input.source && typeof input.source === 'object' && !Array.isArray(input.source), 'source required');
  text(input.source.id, 'source.id');
  check(['synthetic', 'historical', 'live'].includes(input.source.kind), 'source.kind: synthetic, historical or live required');
  check(Buffer.byteLength(canonical(input)) <= 2 * 1024 * 1024, 'Input exceeds 2 MiB');
  return input;
}
export function visible(row, asOf, name = 'row') {
  const time = instant(row.time, `${name}.time`), available = instant(row.available_at, `${name}.available_at`);
  check(time <= available && available <= instant(asOf, 'as_of'), `${name}: observation is not available at as_of`); return time;
}
function snapshotVisible(row, asOf, name) {
  const dateOnly = typeof row.time === 'string' && /^\d{4}-\d\d-\d\d$/.test(row.time);
  // Midnight is only an ordering key for a calendar date, never a fabricated close/availability time.
  const time = instant(dateOnly ? `${row.time}T00:00:00.000Z` : row.time, `${name}.time`);
  const cutoff = instant(asOf, 'as_of');
  check(time <= cutoff, `${name}: observation is not available at as_of`);
  if (row.available_at != null) {
    const available = instant(row.available_at, `${name}.available_at`);
    check(time <= available && available <= cutoff, `${name}: observation is not available at as_of`);
  }
  return time;
}
export function bars(input, key = 'bars', { allowSnapshot = false } = {}) {
  validateInput(input); const rows = array(input[key], key); let previous = -Infinity;
  for (const [i, row] of rows.entries()) {
    check(row && typeof row === 'object' && !Array.isArray(row), `${key}[${i}]: object required`);
    const time = (allowSnapshot ? snapshotVisible : visible)(row, input.as_of, `${key}[${i}]`);
    if (allowSnapshot) check(row.time.length === rows[0].time.length, `${key}: use one time precision per series`);
    check(time > previous, `${key}: times must be unique and increasing`); previous = time;
    for (const name of ['open', 'high', 'low', 'close']) finite(row[name], `${key}[${i}].${name}`, Number.MIN_VALUE, 1e15);
    check(row.low <= Math.min(row.open, row.close) && row.high >= Math.max(row.open, row.close) && row.low <= row.high, `${key}[${i}]: invalid OHLC range`);
    finite(row.volume, `${key}[${i}].volume`, 0, 1e18);
  }
  return rows;
}
// TR includes both gaps relative to the preceding close; no preceding close means no TR.
// https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr
export function trueRange(row, previousClose) {
  return previousClose == null ? null : Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));
}
export function envelope(input, analyze, moduleUrl) {
  validateInput(input);
  const result = analyze(structuredClone(input));
  boundedJson(result);
  check(result && typeof result === 'object' && result.parameters && result.observations !== undefined && Array.isArray(result.limitations), 'Analysis must return parameters, observations and limitations');
  const reserved = ['schema_version', 'baseline', 'status', 'guidance', 'as_of', 'source', 'input_sha256', 'implementation_sha256', 'dataset_id', 'input_dataset_id'];
  check(reserved.every(key => !Object.hasOwn(result, key)), 'Analysis cannot override reserved evidence fields');
  const implementation = Buffer.concat([readFileSync(fileURLToPath(moduleUrl)), readFileSync(new URL('./runtime.mjs', moduleUrl))]);
  return {
    schema_version: 1, baseline: true, status: 'research_baseline',
    guidance: '这是可修改、可验证的基线，不是标准答案。Agent 可按需求改进；保留原版、假设、差异、全部试验及固定样本外对照。',
    as_of: input.as_of, source: input.source, input_sha256: digest(canonical(input)), implementation_sha256: digest(implementation),
    ...structuredClone(result),
    limitations: [...result.limitations, 'Input availability and source provenance are supplied declarations, not independently verified vendor history.', 'Research observations are not orders, fills or evidence of investment performance.'],
  };
}
export async function publish(host, input, result, pluginId, title) {
  const provenance = { kind: input.source.kind === 'synthetic' ? 'demo' : 'user_input', source: input.source, as_of: input.as_of,
    recorded_at: new Date().toISOString(), baseline: true, input_sha256: result.input_sha256, implementation_sha256: result.implementation_sha256, plugin_id: pluginId };
  const freeze = async (name, rows, dependencies, evidence) => {
    const source = await host.resources.create({ kind: 'blob', name: 'abu-evidence-' + randomUUID() + '.json', source: { content: JSON.stringify(rows) }, lifetime: 'durable' });
    const { ref } = await host.resources.publish(source, { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', title: name, path: 'rows.json', rowCount: rows.length, columns: Object.keys(rows[0] ?? {}).map(key => ({ key })), provenance: evidence }, dependencies, blobs: [{ entry: 'content', path: 'rows.json', mediaType: 'application/json' }] });
    await host.resources.remove(source, { mode: 'permanent', expectedVersion: source.version });
    return ref;
  };
  const input_artifact = await freeze(title + ' / 固定输入', [{ input }], [], provenance);
  const result_artifact = await freeze(title, [result], [input_artifact], { ...provenance, kind: provenance.kind === 'demo' ? 'demo' : 'derived' });
  return { ...result, input_artifact, result_artifact };
}
export function runCli(moduleUrl, analyze) {
  if (!process.argv[1] || resolve(process.argv[1]) !== fileURLToPath(moduleUrl)) return;
  try {
    const args = process.argv.slice(2);
    check(args.length === 1 || (args.length === 3 && args[1] === '--out'), 'Usage: node scripts/baseline.mjs input.json [--out new-result.json]');
    const fd = openSync(args[0], 'r'); let input;
    try { const stat = fstatSync(fd); check(stat.isFile() && stat.size <= 2 * 1024 * 1024, 'Input must be a regular file <= 2 MiB'); input = JSON.parse(readFileSync(fd, 'utf8')); }
    finally { closeSync(fd); }
    const output = JSON.stringify(envelope(input, analyze, moduleUrl), null, 2) + '\n';
    if (args.length === 3) writeFileSync(args[2], output, { flag: 'wx' }); else process.stdout.write(output);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
