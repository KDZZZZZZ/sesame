import { open, realpath, lstat, writeFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { check, canonical, digest } from './workflow-mechanics.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const text = value => typeof value === 'string' && value.trim() && value.length <= 4000;
const parts = pointer => {
  check(typeof pointer === 'string' && (pointer === '' || pointer.startsWith('/')) && pointer.length <= 500, 'INVALID_NATIVE_PLAN', 'Use an explicit bounded JSON pointer');
  const values = pointer === '' ? [] : pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
  check(values.every(key => key && !Object.hasOwn(Object.prototype, key)), 'INVALID_NATIVE_PLAN', 'Unsafe JSON pointer'); return values;
};
export const pointerValue = (value, pointer) => parts(pointer).reduce((item, key) => item?.[key], value);
function setPointer(value, pointer, replacement) {
  const path = parts(pointer); check(path.length, 'INVALID_NATIVE_PLAN', 'Cannot replace the root native arguments');
  const key = path.pop(), parent = path.reduce((item, key) => item?.[key], value);
  check(object(parent) && Object.hasOwn(parent, key), 'INVALID_NATIVE_PLAN', 'A bound native argument must already exist in the frozen request'); parent[key] = replacement;
}
const buildMatches = (value, buildId) => typeof value === 'string' && (value === buildId || value.replaceAll('\\', '/').split('/').at(-1).toLowerCase() === `${buildId}.ex5`.toLowerCase());
export function validateMT5Optimizer(value, plan) {
  check(keys(value, ['inputSchema', 'arguments', 'windowBinding', 'preparedConfiguration', 'buildPointer', 'result']) && object(value.inputSchema) && object(value.arguments), 'INVALID_NATIVE_PLAN', 'MT5 nativeOptimizer needs exact catalog inputSchema and frozen arguments');
  check(Boolean(value.windowBinding) !== Boolean(value.preparedConfiguration), 'INVALID_NATIVE_PLAN', 'Bind actual date arguments or explicitly identify the prepared configuration');
  if (value.windowBinding) {
    check(keys(value.windowBinding, ['startPointer', 'endPointer']), 'INVALID_NATIVE_PLAN', 'windowBinding contains startPointer/endPointer');
    check(value.windowBinding.startPointer !== value.windowBinding.endPointer && pointerValue(value.arguments, value.windowBinding.startPointer) === plan.development.start && pointerValue(value.arguments, value.windowBinding.endPointer) === plan.development.end, 'INVALID_NATIVE_PLAN', 'Native date arguments must exactly match the declared development dates');
  } else {
    const c = value.preparedConfiguration;
    check(keys(c, ['argumentPointer', 'workspacePath', 'authority', 'source', 'acknowledgeUnverified']) && text(c.authority) && text(c.source) && text(pointerValue(value.arguments, c.argumentPointer)), 'INVALID_NATIVE_PLAN', 'Prepared configuration requires its actual argument path, authority and source explanation');
    check(c.workspacePath ? text(c.workspacePath) && !c.acknowledgeUnverified : c.acknowledgeUnverified === true, 'INVALID_NATIVE_PLAN', 'An unverifiable native configuration needs explicit acknowledgeUnverified:true; otherwise provide an authored workspace INI');
  }
  if (value.buildPointer) parts(value.buildPointer);
  if (value.result) {
    const r = value.result;
    check(keys(r, ['rootPointer', 'textJSON', 'complete', 'passesPointer', 'parametersPointer', 'statisticsPointer', 'passComplete']) && (r.textJSON === undefined || typeof r.textJSON === 'boolean'), 'INVALID_NATIVE_PLAN', 'Use a fixed actual-output parser contract, not supplied metrics');
    for (const field of ['rootPointer', 'passesPointer', 'parametersPointer', 'statisticsPointer']) parts(r[field] ?? (field === 'rootPointer' ? '' : undefined));
    for (const criterion of [r.complete, ...(r.passComplete ? [r.passComplete] : [])]) {
      check(keys(criterion, ['pointer', 'equals']) && ['string', 'number', 'boolean'].includes(typeof criterion.equals), 'INVALID_NATIVE_PLAN', 'Actual completion must match an explicit scalar in the native output'); parts(criterion.pointer);
    }
    check(plan.search.objective, 'INVALID_NATIVE_PLAN', 'Parsing optimizer passes requires a predeclared selection objective');
  }
}

export async function freezeMT5Optimizer(host, plan) {
  const binding = plan.search.nativeOptimizer;
  if (!binding) return undefined;
  const result = { schemaDigest: digest(binding.inputSchema), argumentsDigest: digest(binding.arguments), windowVerification: binding.windowBinding ? 'bound-native-date-arguments' : 'unverified',
    buildIdentityVerified: Boolean(binding.buildPointer && buildMatches(pointerValue(binding.arguments, binding.buildPointer), plan.strategy.buildId)) };
  const c = binding.preparedConfiguration;
  if (c?.workspacePath) {
    const root = await realpath(host.context.workspaceRoot), file = await realpath(resolve(root, c.workspacePath));
    check(file.startsWith(root + sep), 'INVALID_NATIVE_INPUT', 'Prepared INI must be an authored file in the active workspace');
    const before = await lstat(file); check(before.isFile() && before.nlink === 1 && before.size > 0 && before.size <= 128 * 1024, 'INVALID_NATIVE_INPUT', 'Prepared INI must be a regular file <=128 KiB');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); let contents;
    try {
      const current = await handle.stat(); check(current.ino === before.ino && current.dev === before.dev, 'INVALID_NATIVE_INPUT', 'Prepared configuration changed before reading');
      contents = new TextDecoder('utf-8', { fatal: true }).decode(await handle.readFile());
      const after = await handle.stat(); check(after.size === before.size && after.mtimeMs === before.mtimeMs && await realpath(file) === file, 'INVALID_NATIVE_INPUT', 'Prepared configuration changed while freezing');
    } finally { await handle.close(); }
    // An authored Tester configuration is not an account/terminal credential file.
    check(!/^\s*(Password|Login|Server|Token|ApiKey)\s*=/im.test(contents), 'INVALID_NATIVE_INPUT', 'Do not include account credentials in an authored optimizer configuration');
    let section = ''; const tester = {};
    for (const line of contents.split(/\r?\n/)) {
      const header = /^\s*\[([^\]]+)\]\s*$/.exec(line); if (header) { section = header[1].toLowerCase(); continue; }
      const entry = /^\s*([^;#=]+?)\s*=\s*(.*?)\s*$/.exec(line); if (section === 'tester' && entry) { check(!Object.hasOwn(tester, entry[1].toLowerCase()), 'INVALID_NATIVE_INPUT', 'Duplicate Tester configuration key'); tester[entry[1].toLowerCase()] = entry[2]; }
    }
    check(tester.fromdate?.replaceAll('.', '-') === plan.development.start && tester.todate?.replaceAll('.', '-') === plan.development.end, 'INVALID_NATIVE_INPUT', 'Authored INI dates must match the development window');
    check(['1', '2'].includes(tester.optimization) && (!tester.forwardmode || tester.forwardmode === '0'), 'INVALID_NATIVE_INPUT', 'Prepared native optimization must disable implicit forward testing; holdout is separate');
    result.configurationSource = contents; result.configurationDigest = digest(contents); result.windowVerification = 'frozen-workspace-tester-ini'; result.buildIdentityVerified = buildMatches(tester.expert, plan.strategy.buildId);
  }
  return result;
}

export async function boundMT5Arguments(host, runId, plan, frozen) {
  const args = structuredClone(plan.search.nativeOptimizer.arguments), c = plan.search.nativeOptimizer.preparedConfiguration;
  if (frozen.configurationSource) {
    check(digest(frozen.configurationSource) === frozen.configurationDigest, 'NATIVE_SOURCE_CHANGED', 'Frozen native configuration changed');
    const root = await realpath(host.context.workspaceRoot), folder = join(root, `.factor-native-${runId}`); await mkdir(folder, { recursive: true });
    check((await realpath(folder)).startsWith(root + sep), 'NATIVE_SOURCE_CHANGED', 'Prepared configuration escaped workspace');
    const path = join(folder, 'tester.ini');
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(frozen.configurationSource); } finally { await handle.close(); }
    setPointer(args, c.argumentPointer, path);
  }
  return args;
}

export function optimizerPasses(command, binding) {
  if (command.status === 'uninterpreted') return { status: 'uninterpreted', reason: command.reason, command };
  if (command.status !== 'returned' || command.result?.isError || command.result?.error) return { status: command.status === 'unknown' ? 'unknown' : 'failed', reason: 'Native command did not return a confirmed successful payload', command };
  if (!binding.result) return { status: 'uninterpreted', reason: 'Native optimizer was called; no fixed result-parser contract was supplied', command };
  const r = binding.result;
  try {
    let payload = pointerValue(command.result, r.rootPointer ?? '');
    if (r.textJSON) { check(typeof payload === 'string' && Buffer.byteLength(payload) <= 8 * 1024 * 1024, 'NATIVE_RESULT_UNAVAILABLE', 'Expected bounded native JSON text'); payload = JSON.parse(payload); }
    check(canonical(pointerValue(payload, r.complete.pointer)) === canonical(r.complete.equals), 'NATIVE_RESULT_UNAVAILABLE', 'Native command returned, but its business completion marker is not confirmed');
    const rows = pointerValue(payload, r.passesPointer);
    check(Array.isArray(rows) && rows.length > 0 && rows.length <= 10000, 'NATIVE_RESULT_UNAVAILABLE', 'Native result contains no bounded actual pass array');
    const passes = rows.map((row, index) => {
      const parameters = pointerValue(row, r.parametersPointer), statistics = pointerValue(row, r.statisticsPointer);
      check(object(parameters) && object(statistics), 'NATIVE_RESULT_UNAVAILABLE', 'Native pass parameters and statistics must come from the actual output');
      return { index, status: !r.passComplete || canonical(pointerValue(row, r.passComplete.pointer)) === canonical(r.passComplete.equals) ? 'completed' : 'failed', parameters, statistics };
    });
    return { status: 'completed', passes, command };
  } catch (error) { return { status: 'uninterpreted', reason: error.message, command }; }
}
