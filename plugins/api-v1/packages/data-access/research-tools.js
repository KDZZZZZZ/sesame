import { join, relative, isAbsolute, sep } from 'node:path';
import { parseRows } from './data.js';
import { check, collect, digest, readBytes, snapshotOperation, systemSource } from './capture.js';

const filename = id => /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : digest(id).slice(7);
export async function registeredDataset(host, id, signal) {
  const captured = await collect(host, { source: systemSource('datasets'), input: { datasetId: id } }, { signal });
  const metadata = captured.pages[0]?.metadata;
  check(metadata?.id === id, 'Host dataset identity does not match the requested ID');
  return { ...metadata, rows: captured.rows };
}
export function createCapabilities(host) {
  return [
    { name: 'data_read', execute: async (args, signal) => {
      check(!(args.datasetId && args.ref), 'Choose datasetId or a fixed data ref');
      if (!args.datasetId && !args.ref) return host.data.query({ source: systemSource('datasets'), input: {}, limit: args.limit ?? 100, ...(args.cursor ? { cursor: args.cursor } : {}) }, { signal });
      let rows, provenance, id;
      if (args.ref) {
        check(args.ref.kind === 'data', 'Expected a fixed data artifact');
        const manifest = await host.resources.read(args.ref, { part: 'manifest' });
        rows = parseRows((await readBytes(host, args.ref, manifest.content.path, signal)).toString('utf8'));
        provenance = manifest.content.provenance; id = args.ref.id;
      } else {
        const dataset = await registeredDataset(host, args.datasetId, signal);
        rows = dataset.rows; provenance = dataset.provenance; id = dataset.id;
      }
      const directory = args.directory ?? '.';
      check(!directory.split(/[\\/]/).includes('inputs'), 'The execution directory cannot itself be inputs');
      const path = join(directory, 'inputs', filename(id) + '.json');
      const written = await host.capabilities.invoke('sesame/workspace#write', { path, content: JSON.stringify(rows) }, { signal });
      check(written.type === 'result', 'Workspace write must return an immediate result');
      return { ...(args.ref ? { ref: args.ref } : { datasetId: id }), path: written.value.path, rowCount: rows.length, sample: rows.slice(0, 5), provenance };
    } },
    { name: 'research_register', execute: (args, signal) => snapshotOperation(host, args.operationId, args, async () => {
      const response = await host.data.query({ source: systemSource('executions'), input: { executionId: args.executionId }, limit: 1 }, { signal });
      const execution = response.items[0];
      check(execution?.id === args.executionId && execution.conversation_id === host.context.sessionId && execution.status === 'completed', 'A successful host-recorded execution from this session is required');
      check(typeof execution.workspace_path === 'string' && isAbsolute(execution.workspace_path), 'Execution evidence lacks a real working directory');
      const requested = isAbsolute(args.path) ? args.path : join(execution.workspace_path, args.path), relativePath = relative(execution.workspace_path, requested);
      check(relativePath && relativePath !== '..' && !relativePath.startsWith('..' + sep) && !isAbsolute(relativePath), 'Result must be inside the frozen execution directory');
      const path = relativePath.replaceAll('\\', '/'), encoded = execution.files?.[path];
      check(typeof encoded === 'string', 'Host execution did not freeze this output; a live file cannot replace execution evidence');
      for (const recipe of args.recipePaths ?? []) check(Object.hasOwn(execution.source_files ?? {}, recipe), 'Recipe must be present in the frozen execution inputs');
      const inputs = [], dependencies = args.inputRefs ?? [];
      check((args.inputIds?.length ?? 0) + dependencies.length > 0, 'Research needs at least one registered or fixed input');
      for (const id of args.inputIds ?? []) {
        const data = await registeredDataset(host, id, signal);
        check(execution.code?.['inputs/' + filename(data.id) + '.json'] === digest(JSON.stringify(data.rows)), 'Execution did not bind the exact registered input bytes');
        inputs.push(data);
      }
      for (const ref of dependencies) {
        check(ref.kind === 'data', 'Research input references must be fixed data artifacts');
        const manifest = await host.resources.read(ref, { part: 'manifest' });
        const rows = parseRows((await readBytes(host, ref, manifest.content.path, signal)).toString('utf8'));
        check(execution.code?.['inputs/' + filename(ref.id) + '.json'] === digest(JSON.stringify(rows)), 'Execution did not bind the exact fixed input bytes');
        inputs.push({ id: ref.id, ref, provenance: manifest.content.provenance });
      }
      const text = Buffer.from(encoded, 'base64').toString('utf8'), rows = parseRows(text);
      const origin = inputs.some(item => ['demo', 'synthetic'].includes(item.provenance?.kind ?? item.provenance?.source_kind)) ? 'demo' : 'derived';
      const summary = { title: args.title, description: args.description, origin, executionId: execution.id, sessionId: execution.conversation_id, outputPath: path, outputDigest: digest(text), inputIds: inputs.map(item => item.id), recipePaths: args.recipePaths ?? [] };
      return { rows, summary, dependencies, evidence: { ...summary, execution: { id: execution.id, status: execution.status, exitCode: execution.exit_code, code: execution.code, sourceFiles: Object.fromEntries((args.recipePaths ?? []).map(path => [path, execution.source_files[path]])) }, inputs: inputs.map(({ rows, ...metadata }) => metadata) } };
    }, signal) },
  ];
}
