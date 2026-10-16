import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { digest } from '@sesame/plugin-sdk/protocol';
import { environment, configured } from './environment.js';

const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const refSchema = (Type, kind) => Type.Object({ id: Type.String(), revision: Type.String(), digest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), kind: Type.Literal(kind), schemaVersion: Type.Literal('1.0.0') }, { additionalProperties: false });
const failOrigins = new Set(['observed', 'user_input', 'derived', 'demo']);

export function fixedRows(host, reference, columns = {}, wallAuthority) {
  const artifact = host.artifacts.read(reference), { content, blobs } = artifact.manifest;
  requireValue(reference.kind === 'data' && content.format === 'json-rows', 'A fixed json-rows DataRef is required');
  const blob = blobs.find(blob => blob.path === content.path);
  requireValue(blob && blob.size <= 16 * 1024 * 1024, 'Fixed input exceeds 16 MiB or has no data blob');
  const source = json(host.artifacts.readBlob(blob));
  requireValue(Array.isArray(source) && source.length === content.rowCount && source.length >= 2 && source.length <= 100000, 'Fixed data requires 2–100000 actual rows');
  requireValue(failOrigins.has(content.provenance?.kind), 'The input must state its provenance kind');
  const rows = source.map(row => {
    const mapped = Object.fromEntries(['datetime', 'open', 'high', 'low', 'close', 'volume'].map(key => [key, row[columns[key] ?? key]]));
    const time = mapped.datetime;
    if (time?.basis === 'utc') mapped.datetime = new Date(time.unixMs).toISOString();
    else if (time?.basis === 'wall') { requireValue(wallAuthority === time.authority, 'Declare the original wall-clock authority without converting it to UTC'); mapped.datetime = time.value; }
    requireValue(typeof mapped.datetime === 'string' && mapped.datetime.length <= 80, 'datetime must be ISO text or a SourceTime');
    if (!/(?:Z|[+-]\d\d:\d\d)$/.test(mapped.datetime)) requireValue(typeof wallAuthority === 'string' && wallAuthority.length > 0, 'Offset-free timestamps require wall_time_authority');
    requireValue(Object.values(mapped).every(value => value !== undefined && value !== null), 'Time, OHLC and volume are required; missing fields are never filled with zero');
    return mapped;
  });
  return { rows, origin: content.provenance.kind, inputProvenance: content.provenance };
}

function resource(host, operationId, kind, content, files, dependencies, origin) {
  return host.artifacts.publish({ operationId, manifest: { kind, schemaVersion: '1.0.0', content,
    blobs: Object.entries(files).map(([path, value]) => ({ ...host.artifacts.blob(value), path, mediaType: path.endsWith('.py') ? 'text/x-python' : 'application/json' })),
    dependencies, provenance: { kind: origin, references: dependencies },
  } });
}
function data(host, operationId, rows, dependencies, origin, label) {
  const provenance = { kind: origin, references: dependencies, description: label, numericalPolicy: 'Native VeighNa binary floating-point outputs represented as decimal text; this is not decimal34 equivalence.' };
  return resource(host, operationId, 'data', { format: 'json-rows', path: 'rows.json', rowCount: rows.length, columns: [...new Set(rows.flatMap(row => Object.keys(row)))], provenance }, { 'rows.json': JSON.stringify(rows) }, dependencies, origin);
}

async function backtest(host, args, signal) {
  const source = await host.workspace.file('read', args.strategy_path, undefined, signal);
  requireValue(source.length > 0 && source.length <= 512 * 1024, 'One authored Python strategy file of at most 512 KiB is supported');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  const fixed = fixedRows(host, args.data, args.columns, args.wall_time_authority);
  const fingerprint = digest({ source: text, data: args.data, columns: args.columns ?? {}, className: args.class_name, parameters: args.parameters ?? {}, config: args.config, authority: args.wall_time_authority ?? null });
  return host.storage.idempotentAsync(`vnpy-backtest:${args.operation_id}`, fingerprint, async () => {
    const selected = await configured(host, signal), operation = args.operation_id;
    const origin = fixed.origin === 'demo' ? 'demo' : 'derived';
    const environmentRef = resource(host, `${operation}:environment`, 'environment', { type: 'vnpy-environment', execution: 'host', path: 'environment.json', engine: selected.packages.vnpy, cta: selected.packages['vnpy-ctastrategy'] }, { 'environment.json': JSON.stringify(selected) }, [], 'observed');
    const nativeSource = resource(host, `${operation}:source`, 'resource', { type: 'native-strategy-source', language: 'python', className: args.class_name, path: 'strategy.py', sourceDigest: digest(source), svlEquivalent: false }, { 'strategy.py': source }, [], 'user_input');
    const inputs = resource(host, `${operation}:inputs`, 'resource', { type: 'vnpy-backtest-inputs', data: args.data, source: nativeSource, wallTimeAuthority: args.wall_time_authority ?? null, parameters: args.parameters ?? {}, config: args.config, path: 'bars.json' }, { 'bars.json': JSON.stringify(fixed.rows) }, [args.data, nativeSource, environmentRef], origin);
    const directory = join(host.workspace.root(), `.vnpy-run-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    let run, result;
    try {
      const entry = join(directory, 'strategy.py'), request = join(directory, 'request.json'), output = join(directory, 'result.json');
      await writeFile(entry, source);
      await writeFile(request, JSON.stringify({ rows: fixed.rows, config: args.config, parameters: args.parameters ?? {}, class_name: args.class_name, strategy_path: entry }));
      run = await host.workspace.run([selected.python, '-I', '-B', fileURLToPath(new URL('./runner.py', import.meta.url)), request, output], { cwd: directory, timeout: args.timeout ?? 120, signal });
      signal?.throwIfAborted();
      const bytes = await readFile(output);
      requireValue(bytes.length <= 16 * 1024 * 1024, 'Engine result exceeds 16 MiB');
      result = json(bytes);
      requireValue(['completed', 'failed'].includes(result.status), 'The real engine returned no terminal status');
      requireValue((run.exitCode === 0) === (result.status === 'completed'), 'Engine status and process exit disagree');
    } finally { await rm(directory, { recursive: true, force: true }); }
    const dependencies = [args.data, nativeSource, environmentRef, inputs];
    const raw = resource(host, `${operation}:receipt`, 'resource', { type: 'vnpy-engine-receipt', executionId: run.executionId ?? null, status: result.status, path: 'result.json', engine: result.engine ?? null }, { 'result.json': JSON.stringify(result), 'process.json': JSON.stringify({ executionId: run.executionId ?? null, exitCode: run.exitCode, output: run.output, execution: 'host' }) }, dependencies, origin);
    const tables = result.status === 'completed' ? ['daily', 'trades', 'orders'].map(name => ({ id: name, ref: data(host, `${operation}:${name}`, result[name], [...dependencies, raw], origin, `Actual VeighNa ${name} for the bound fixed input`), rowCount: result[name].length })) : [];
    const limitations = result.limitations ?? ['The native engine failed; no backtest success or live-execution claim is made.'];
    const ref = resource(host, operation, 'strategy.result', { schemaVersion: '1.0.0', status: result.status, title: args.title, source: null, nativeSource, translation: null, engine: result.engine ?? { name: 'VeighNa CTA BacktestingEngine', vnpy: '4.5.0', vnpy_ctastrategy: '1.4.1' }, execution: 'host', environment: environmentRef, assumptions: inputs, inputs: [args.data], rawResult: raw, data: tables, statistics: result.statistics ?? {}, provenance: { kind: origin, references: [...dependencies, raw] }, limitations: [...limitations, 'Single-file native Python strategy; no SVL translation or target equivalence is inferred.'] }, {}, [...dependencies, raw, ...tables.map(table => table.ref)], origin);
    return { ref, status: result.status, data: tables, statistics: result.statistics ?? {}, diagnostics: result.error ?? null, executionId: run.executionId ?? null, execution: 'host', nativeSource, environment: environmentRef, rawResult: raw };
  });
}

export function createTools(host) {
  const { define, Type, string } = host.tools;
  const decimal = Type.String({ pattern: '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$' });
  return [
    define('vnpy_environment', 'Inspect existing native Python/VeighNa environments; prepare first reuses a compatible environment and installs pinned dependencies in private plugin data only when needed. No download occurs on plugin load or inspect. Runs managed host processes, not an OS sandbox.', { action: Type.Union([Type.Literal('inspect'), Type.Literal('prepare')]), python_path: Type.Optional(string('Existing native Python executable to inspect or use for a private environment')) }, (args, signal) => environment(host, args, signal)),
    define('vnpy_backtest', 'Run actual VeighNa CTA BacktestingEngine on a fixed DataRef and one authored CtaTemplate Python file. Executes managed current-user host Python; preserves code, environment, parameters, matching assumptions and results. This is a bar backtest, not a live broker or SVL equivalence check.', {
      operation_id: string('Idempotency key for this exact backtest'), title: string('Result title'), data: refSchema(Type, 'data'), strategy_path: string('Workspace Python source file'), class_name: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }),
      config: Type.Object({ vt_symbol: string('symbol.Exchange, using a VeighNa Exchange enum'), interval: Type.Union(['1m', '1h', 'd', 'w'].map(value => Type.Literal(value))), rate: decimal, slippage: decimal, size: decimal, pricetick: decimal, capital: decimal, start: Type.Optional(Type.String()), end: Type.Optional(Type.String()) }, { additionalProperties: false }),
      columns: Type.Optional(Type.Object(Object.fromEntries(['datetime', 'open', 'high', 'low', 'close', 'volume'].map(key => [key, Type.Optional(Type.String({ minLength: 1 }))])), { additionalProperties: false })),
      wall_time_authority: Type.Optional(string('Required for offset-free timestamps; preserves their original authority without guessing UTC')),
      parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())), timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
    }, (args, signal) => backtest(host, args, signal)),
    define('vnpy_result', 'Read one fixed VeighNa result manifest and the references needed for a report. Reading does not rerun strategies or place orders.', { ref: refSchema(Type, 'strategy.result') }, args => host.artifacts.read(args.ref)),
  ];
}
