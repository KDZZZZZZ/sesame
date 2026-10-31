import { open, realpath, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, sep } from 'node:path';
import { check, digest } from './workflow-mechanics.js';
import { dataRef, checkedArtifact, readRows } from './research-artifacts.js';
import { validateMT5Optimizer, freezeMT5Optimizer } from './native-mt5.js';

export const nativePlugins = { backtrader: 'sesame/backtrader', vnpy: 'sesame/vnpy', mt5: 'sesame/mt5' };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const scalar = value => typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 1000;
const exactKeys = (value, keys, name) => check(object(value) && Object.keys(value).every(key => keys.includes(key)), 'INVALID_NATIVE_PLAN', `${name} has unknown fields`);
const nonempty = value => typeof value === 'string' && value.trim() && value.length <= 4000;
const instant = value => typeof value === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
export function nativePlan(value, intent = {}) {
  if (value === undefined) return undefined;
  exactKeys(value, ['engine', 'reason', 'development', 'holdout', 'strategy', 'config', 'parameters', 'columns', 'search', 'timeout', 'environment'], 'nativeValidation');
  const requested = value.engine ?? intent.requestedEngine ?? intent.intendedPlatform;
  const engine = String(requested ?? '').toLowerCase();
  check(Object.hasOwn(nativePlugins, engine), 'INVALID_NATIVE_PLAN', 'Choose the explicit engine or exact intended platform: backtrader, vnpy, mt5; no silent fallback');
  check(nonempty(value.reason), 'INVALID_NATIVE_PLAN', 'Record why the engine matches the user/platform or why a substitute is necessary');
  exactKeys(value.strategy, engine === 'mt5' ? ['buildId'] : ['path', 'className'], 'strategy');
  check(engine === 'mt5' ? nonempty(value.strategy.buildId) : nonempty(value.strategy.path) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.strategy.className), 'INVALID_NATIVE_PLAN', 'Use a frozen MT5 build ID or authored Python path and className');
  check(object(value.config) && object(value.parameters ?? {}), 'INVALID_NATIVE_PLAN', 'Native config and parameters must be objects');
  check(!Object.keys(value.config).some(key => ['from_date', 'to_date', 'start', 'end', 'parameters'].includes(key)), 'INVALID_NATIVE_PLAN', 'Windows and parameters are controlled by the frozen plan, not nested engine config');
  for (const [name, window] of Object.entries({ development: value.development, ...(value.holdout ? { holdout: value.holdout } : {}) })) {
    exactKeys(window, ['data', 'start', 'end', 'authority', ...(engine === 'vnpy' ? ['tradingStart'] : [])], name);
    if (engine === 'mt5') {
      check([window.start, window.end].every(at => typeof at === 'string' && /^\d{4}-\d\d-\d\d$/.test(at) && Number.isFinite(Date.parse(at)) && new Date(at).toISOString().slice(0, 10) === at) && nonempty(window.authority), 'INVALID_NATIVE_PLAN', 'MT5 windows need valid broker wall dates and explicit authority; these are not UTC/PIT snapshots');
      check(window.data === undefined, 'INVALID_NATIVE_PLAN', 'MT5 Tester uses its native price store; a supplied DataRef would not bind that store');
    } else {
      check(dataRef(window.data) && [window.start, window.end].every(instant), 'INVALID_NATIVE_PLAN', 'Native Python windows require fixed DataRefs and explicit UTC/offset endpoints');
    }
    check(Date.parse(window.start) < Date.parse(window.end), 'INVALID_NATIVE_PLAN', 'Windows are nonempty [start,end)');
    check(window.tradingStart === undefined || instant(window.tradingStart) && Date.parse(window.start) <= Date.parse(window.tradingStart) && Date.parse(window.tradingStart) < Date.parse(window.end),
      'INVALID_NATIVE_PLAN', 'vnpy tradingStart must be an explicit UTC/offset instant inside its fixed input [start,end) window');
  }
  check(!value.holdout || Date.parse(value.development.end) <= Date.parse(value.holdout.start), 'INVALID_NATIVE_PLAN', 'Holdout must start at or after the right-open development end');
  check(engine !== 'mt5' || !value.holdout || value.holdout.authority === value.development.authority, 'INVALID_NATIVE_PLAN', 'MT5 development and holdout must use the same broker wall authority');
  const search = structuredClone(value.search ?? { mode: 'none' });
  exactKeys(search, ['mode', 'parameterSpace', 'groups', 'objective', 'nativeOptimizer'], 'search');
  check(!search.nativeOptimizer || engine === 'mt5' && search.mode === 'auto', 'INVALID_NATIVE_PLAN', 'Exact nativeOptimizer binding is only for MT5 auto mode');
  check(['none', 'auto', 'groups'].includes(search.mode), 'INVALID_NATIVE_PLAN', 'search.mode must be none, auto or groups');
  if (search.mode === 'auto' && search.nativeOptimizer) {
    check(!search.parameterSpace && !search.groups, 'INVALID_NATIVE_PLAN', 'MT5 native search ranges come from its exact frozen arguments/configuration, not a second search engine');
    validateMT5Optimizer(search.nativeOptimizer, { ...value, search });
  } else if (search.mode === 'auto') {
    check(!search.groups && object(search.parameterSpace) && Object.keys(search.parameterSpace).length > 0 && Object.keys(search.parameterSpace).length <= 12, 'INVALID_NATIVE_PLAN', 'Auto search needs a bounded native parameter space');
    let count = 1;
    for (const [key, values] of Object.entries(search.parameterSpace)) {
      check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !Object.hasOwn(Object.prototype, key) && Array.isArray(values) && values.length > 0 && values.length <= 64 && values.every(scalar) && new Set(values.map(JSON.stringify)).size === values.length, 'INVALID_NATIVE_PLAN', 'Use distinct scalar values for each native parameter'); count *= values.length;
    }
    check(count <= 64, 'INVALID_NATIVE_PLAN', 'Use at most 64 native combinations');
  } else if (search.mode === 'groups') {
    check(!search.parameterSpace && Array.isArray(search.groups) && search.groups.length > 0 && search.groups.length <= 64 && new Set(search.groups.map(x => x.id)).size === search.groups.length, 'INVALID_NATIVE_PLAN', 'Use 1..64 distinct hypothesis-driven parameter groups');
    for (const group of search.groups) { exactKeys(group, ['id', 'hypothesis', 'parameters'], 'parameter group'); check(nonempty(group.id) && nonempty(group.hypothesis) && object(group.parameters), 'INVALID_NATIVE_PLAN', 'Every custom group needs its own hypothesis and parameters'); }
  } else check(!search.parameterSpace && !search.groups && !search.objective, 'INVALID_NATIVE_PLAN', 'No-search runs use fixed parameters without selection');
  if (search.mode !== 'none' && (!search.nativeOptimizer || search.objective)) {
    exactKeys(search.objective, ['metric', 'direction'], 'objective');
    check(typeof search.objective.metric === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,100}$/.test(search.objective.metric) && !search.objective.metric.split('.').some(x => Object.hasOwn(Object.prototype, x)) && ['max', 'min'].includes(search.objective.direction), 'INVALID_NATIVE_PLAN', 'Freeze a numeric statistics path, direction, and input-order tie-break before optimization');
  }
  check(value.timeout === undefined || Number.isInteger(value.timeout) && value.timeout >= 1 && value.timeout <= 600, 'INVALID_NATIVE_PLAN', 'Native timeout is 1..600 seconds');
  if (value.environment !== undefined) { exactKeys(value.environment, ['pythonPath'], 'environment'); check(engine !== 'mt5' && nonempty(value.environment.pythonPath), 'INVALID_NATIVE_PLAN', 'Only an explicit existing Python path is supported; workflow never downloads'); }
  const plan = { ...structuredClone(value), engine, search };
  check(Buffer.byteLength(JSON.stringify(plan)) <= 32000, 'INVALID_NATIVE_PLAN', 'Native plan must fit 32 KiB');
  return plan;
}

export async function checkWindow(host, window, columns, signal, engine) {
  const { manifest } = await checkedArtifact(host, window.data);
  check(['observed', 'demo', 'derived', 'user_input'].includes(manifest.content.provenance?.kind), 'INVALID_NATIVE_INPUT', 'Native input must retain actual provenance');
  const rows = await readRows(host, window.data, { manifest, signal, maxBytes: 16 * 1024 * 1024 });
  check(rows.length >= 2 && rows.length <= 100000, 'INVALID_NATIVE_INPUT', 'Native input requires 2..100000 bars');
  const times = rows.map(row => {
    const value = row[columns?.datetime ?? 'datetime'];
    const at = value?.basis === 'utc' && Number.isSafeInteger(value.unixMs) ? value.unixMs
      : typeof value === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
    check(Number.isFinite(at) && at >= Date.parse(window.start) && at < Date.parse(window.end), 'INVALID_NATIVE_INPUT', 'Every supplied bar must lie inside its declared [start,end) window; no implicit clipping or wall-time conversion');
    return at;
  });
  check(times.every((at, i) => !i || at > times[i - 1]), 'INVALID_NATIVE_INPUT', 'Native bar timestamps must strictly increase');
  const range = values => ({ rowCount: values.length, first: values.length ? new Date(values[0]).toISOString() : null, last: values.length ? new Date(values.at(-1)).toISOString() : null });
  const evidence = { start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString(), ...range(times), provenance: manifest.content.provenance };
  if (engine !== 'vnpy') return evidence;
  const tradingStart = Date.parse(window.tradingStart ?? evidence.first);
  const warmup = times.filter(at => at < tradingStart), trading = times.filter(at => at >= tradingStart);
  check(trading.length >= 2, 'INVALID_NATIVE_INPUT', 'vnpy trading window requires at least two supplied bars at or after tradingStart');
  const start = new Date(tradingStart).toISOString();
  return { ...evidence,
    warmup: { start: evidence.start, end: start, ...range(warmup) },
    trading: { start, end: evidence.end, ...range(trading) } };
}

export async function prepareNative(host, plan, signal) {
  if (!plan) return undefined;
  const base = { schemaVersion: 1, status: 'pending', engine: plan.engine, planDigest: digest(plan), attempts: [],
    boundary: 'Factor research is already frozen before native execution. Native code runs as the local user, not in the evaluator sealed environment; fixed-window checks do not provide an OS sandbox.' };
  try {
    const manifest = host.plugins.read(nativePlugins[plan.engine], { part: 'manifest' });
    check(manifest.id === nativePlugins[plan.engine] && typeof manifest.revision === 'string', 'NATIVE_UNAVAILABLE', 'Native plugin is not installed with a stable declaration');
    base.descriptor = { id: manifest.id, version: manifest.version, digest: manifest.revision };
    if (plan.engine === 'mt5' && plan.search.nativeOptimizer) base.mt5Optimizer = await freezeMT5Optimizer(host, plan);
    if (plan.engine !== 'mt5') {
      const root = await realpath(host.context.workspaceRoot), path = await realpath(resolve(root, plan.strategy.path));
      check(path.startsWith(root + sep), 'INVALID_NATIVE_INPUT', 'Authored native source must stay within the active workspace');
      const before = await lstat(path); check(before.isFile() && before.nlink === 1, 'INVALID_NATIVE_INPUT', 'Use one regular authored file without hard links');
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); let bytes;
      try {
        const details = await handle.stat(); check(details.isFile() && details.ino === before.ino && details.dev === before.dev && details.size > 0 && details.size <= 512 * 1024, 'INVALID_NATIVE_INPUT', 'One unchanged authored Python file <=512 KiB');
        bytes = await handle.readFile(); const after = await handle.stat();
        check(after.nlink === 1 && after.size === details.size && after.mtimeMs === details.mtimeMs && await realpath(path) === path, 'INVALID_NATIVE_INPUT', 'Strategy source changed while being frozen');
      } finally { await handle.close(); }
      signal?.throwIfAborted();
      base.source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); base.sourceDigest = digest(base.source);
      base.windows = { development: await checkWindow(host, plan.development, plan.columns, signal, plan.engine), ...(plan.holdout ? { holdout: await checkWindow(host, plan.holdout, plan.columns, signal, plan.engine) } : {}) };
    }
    return base;
  } catch (error) {
    signal?.throwIfAborted();
    return { ...base, status: 'unavailable', reason: String(error.message).slice(0, 1500), code: error.code ?? 'NATIVE_UNAVAILABLE' };
  }
}
