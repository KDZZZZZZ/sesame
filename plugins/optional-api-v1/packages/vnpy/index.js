import { capability } from '@sesame/plugin-sdk/capabilities';
import { records,closeRecords } from './records.js';
import { once } from './operation.js';
import { readArtifact,readEntry,publishFiles } from './resource-files.js';
import { readUserFile,runProcess } from './execution.js';
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

export async function fixedRows(host, reference, columns = {}, wallAuthority) {
  const artifact = await readArtifact(host,reference), { content, blobs } = artifact.manifest;
  requireValue(reference.kind === 'data' && content.format === 'json-rows', 'A fixed json-rows DataRef is required');
  const blob = blobs.find(blob => blob.path === content.path);
  requireValue(blob && blob.size <= 16 * 1024 * 1024, 'Fixed input exceeds 16 MiB or has no data blob');
  const source = json(await readEntry(host,reference,blob.path));
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

async function resource(host,operationId,kind,content,files={},dependencies=[],origin) {return publishFiles(host,{operationId,kind,content,files,dependencies,...(origin?{provenance:{kind:origin,references:dependencies}}:{})});}
async function data(host, operationId, rows, dependencies, origin, label) {
  const provenance = { kind: origin, references: dependencies, description: label, numericalPolicy: 'Native VeighNa binary floating-point outputs represented as decimal text; this is not decimal34 equivalence.' };
  return await resource(host, operationId, 'data', { format: 'json-rows', path: 'rows.json', rowCount: rows.length, columns: [...new Set(rows.flatMap(row => Object.keys(row)))], provenance }, { 'rows.json': JSON.stringify(rows) }, dependencies, origin);
}

async function backtest(host, args, signal) {
  const source = await readUserFile(host,'read', args.strategy_path, undefined, signal);
  requireValue(source.length > 0 && source.length <= 512 * 1024, 'One authored Python strategy file of at most 512 KiB is supported');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  const fixed = await fixedRows(host, args.data, args.columns, args.wall_time_authority);
  const fingerprint = digest({ source: text, data: args.data, columns: args.columns ?? {}, className: args.class_name, parameters: args.parameters ?? {}, config: args.config, authority: args.wall_time_authority ?? null });
  return once(host,`vnpy-backtest:${args.operation_id}`, fingerprint, async () => {
    const selected = await configured(host, signal), operation = args.operation_id;
    const origin = fixed.origin === 'demo' ? 'demo' : 'derived';
    const environmentRef = await resource(host, `${operation}:environment`, 'environment', { type: 'vnpy-environment', execution: 'host', path: 'environment.json', engine: selected.packages.vnpy, cta: selected.packages['vnpy-ctastrategy'] }, { 'environment.json': JSON.stringify(selected) }, [], 'observed');
    const nativeSource = await resource(host, `${operation}:source`, 'resource', { type: 'native-strategy-source', language: 'python', className: args.class_name, path: 'strategy.py', sourceDigest: digest(source), svlEquivalent: false }, { 'strategy.py': source }, [], 'user_input');
    const inputs = await resource(host, `${operation}:inputs`, 'resource', { type: 'vnpy-backtest-inputs', data: args.data, source: nativeSource, wallTimeAuthority: args.wall_time_authority ?? null, parameters: args.parameters ?? {}, config: args.config, path: 'bars.json' }, { 'bars.json': JSON.stringify(fixed.rows) }, [args.data, nativeSource, environmentRef], origin);
    const directory = join(host.context.workspaceRoot, `.vnpy-run-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    let run, result;
    try {
      const entry = join(directory, 'strategy.py'), request = join(directory, 'request.json'), output = join(directory, 'result.json');
      await writeFile(entry, source);
      await writeFile(request, JSON.stringify({ rows: fixed.rows, config: args.config, parameters: args.parameters ?? {}, class_name: args.class_name, strategy_path: entry }));
      run = await runProcess(host,[selected.python, '-I', '-B', fileURLToPath(new URL('./runner.py', import.meta.url)), request, output], { cwd: directory, timeout: args.timeout ?? 120, signal });
      signal?.throwIfAborted();
      const bytes = await readFile(output);
      requireValue(bytes.length <= 16 * 1024 * 1024, 'Engine result exceeds 16 MiB');
      result = json(bytes);
      requireValue(['completed', 'failed'].includes(result.status), 'The real engine returned no terminal status');
      requireValue((run.exitCode === 0) === (result.status === 'completed'), 'Engine status and process exit disagree');
    } finally { await rm(directory, { recursive: true, force: true }); }
    const dependencies = [args.data, nativeSource, environmentRef, inputs];
    const raw = await resource(host, `${operation}:receipt`, 'resource', { type: 'vnpy-engine-receipt', executionRunId: run.runId ?? null, status: result.status, path: 'result.json', engine: result.engine ?? null }, { 'result.json': JSON.stringify(result), 'process.json': JSON.stringify({ executionRunId: run.runId ?? null, exitCode: run.exitCode, output: run.output, execution: 'host' }) }, dependencies, origin);
    const tables = result.status === 'completed' ? await Promise.all(['daily', 'trades', 'orders'].map(async name => ({ id: name, ref: await data(host, `${operation}:${name}`, result[name], [...dependencies, raw], origin, `Actual VeighNa ${name} for the bound fixed input`), rowCount: result[name].length }))) : [];
    const limitations = result.limitations ?? ['The native engine failed; no backtest success or live-execution claim is made.'];
    const ref = await resource(host, operation, 'strategy.result', { schemaVersion: '1.0.0', status: result.status, title: args.title, source: null, nativeSource, translation: null, engine: result.engine ?? { name: 'VeighNa CTA BacktestingEngine', vnpy: '4.5.0', vnpy_ctastrategy: '1.4.1' }, execution: 'host', environment: environmentRef, assumptions: inputs, inputs: [args.data], rawResult: raw, data: tables, statistics: result.statistics ?? {}, provenance: { kind: origin, references: [...dependencies, raw] }, limitations: [...limitations, 'Single-file native Python strategy; no SVL translation or target equivalence is inferred.'] }, {}, [...dependencies, raw, ...tables.map(table => table.ref)], origin);
    return { ref, status: result.status, data: tables, statistics: result.statistics ?? {}, diagnostics: result.error ?? null, executionRunId: run.runId ?? null, execution: 'host', nativeSource, environment: environmentRef, rawResult: raw };
  });
}

export function createCapabilities(host) {
return [
    capability('vnpy_dispose',()=>{closeRecords(host);return{closed:true};}),
    capability('vnpy_environment', (args, signal) => environment(host, args, signal)),
    capability('vnpy_backtest', (args, signal) => backtest(host, args, signal)),
    capability('vnpy_result', async args => await readArtifact(host,args.ref)),
  ];
}
