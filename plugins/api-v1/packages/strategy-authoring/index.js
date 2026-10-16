import { validateSource, graph, evaluateReplay } from '@sesame/plugin-sdk/svl';
import { evaluatePipeline } from './lib/pipeline.js';
import { createDecisionCapabilities } from './lib/agent-decision-tools.js';
import { createQuantCapabilities } from './lib/quant-functions.js';
import { activateDecisions, disposeDecisions } from './lib/decision-service.js';
import { readBytes, readWorkspace, writeWorkspace, publishFiles } from './artifact-io.js';

const fail = (condition, message) => { if (!condition) throw new Error(message); };
const json = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
const file = (path, bytes) => ({ path, bytes, mediaType: 'application/json' });

async function readSource(host, ref, signal) {
  fail(ref?.kind === 'strategy.source', 'A fixed strategy.source reference is required');
  const manifest = await host.resources.read(ref, { part: 'manifest' }), content = manifest.content;
  const blob = manifest.blobs.find(value => value.path === content.sourcePath);
  fail(blob && blob.size <= 1048576, 'Strategy source blob is missing or exceeds 1 MiB');
  const validated = validateSource((await readBytes(host, ref, blob.path, signal)).toString('utf8'));
  fail(validated.sourceDigest === content.sourceDigest, 'SVL semantic digest does not match the published source'); return validated;
}

async function pinnedInputs(host, fixture, signal) {
  const refs = new Map(), pending = [fixture]; let budget = 100000;
  while (pending.length) {
    fail(--budget >= 0, 'Pipeline fixture exceeds its structural budget');
    const value = pending.pop(); if (!value || typeof value !== 'object') continue;
    if (['id', 'revision', 'digest', 'kind', 'schemaVersion'].every(key => Object.hasOwn(value, key))) {
      const key = JSON.stringify([value.id, value.revision, value.digest, value.kind, value.schemaVersion]);
      if (refs.has(key)) continue;
      await host.resources.read(value, { part: 'manifest' });
      if (value.kind === 'strategy.source') await readSource(host, value, signal);
      refs.set(key, value); fail(refs.size <= 256, 'Pipeline fixture has too many pinned inputs');
    } else for (const child of Object.values(value)) pending.push(child);
  }
  return [...refs.values()];
}

export async function provenance(host, dependencies) {
  for (const ref of dependencies) {
    const manifest = await host.resources.read(ref, { part: 'manifest' });
    if (manifest.provenance?.kind === 'demo' || manifest.content.provenance?.kind === 'demo') return { kind: 'demo', references: dependencies };
  }
  return { kind: 'derived', references: dependencies };
}

export function createCapabilities(host) {
  const load = async (path, signal) => {
    const bytes = await readWorkspace(host, path, signal); fail(bytes.length <= 1048576, 'SVL source exceeds 1 MiB');
    return { bytes, ...validateSource(bytes.toString('utf8')) };
  };
  const evaluateFixture = async (args, signal, methodOnly = false) => {
    const bytes = await readWorkspace(host, args.fixture_path, signal); fail(bytes.length <= 4194304, 'Pipeline fixture exceeds 4 MiB');
    const fixture = json(bytes), dependencies = await pinnedInputs(host, fixture, signal);
    if (methodOnly) fail(fixture.schemaVersion === '1.1.0', 'strategy_workflow requires the method workflow 1.1 fixture');
    const declared = await readSource(host, fixture.schemaVersion === '1.1.0' ? fixture.strategySource : fixture.target?.strategySource, signal);
    fail(declared.source.strategyId === fixture.scope?.strategyId, 'Pipeline ownership differs from the frozen strategy source');
    const result = evaluatePipeline(fixture); signal?.throwIfAborted();
    const output = JSON.stringify(result, null, 2) + '\n';
    if (args.output_path) await writeWorkspace(host, args.output_path, output, signal);
    let evidence;
    if (args.operation_id) evidence = (await publishFiles(host, args.operation_id, { kind: 'resource', schemaVersion: '1.0.0',
      content: { type: 'strategy-pipeline-evaluation', inputPath: 'input.json', resultPath: 'pipeline.json', validationScope: result.validationScope, nativeEngineExecuted: false },
      dependencies, provenance: await provenance(host, dependencies) }, [file('input.json', bytes), file('pipeline.json', output)], {}, signal)).ref;
    return { ...result, ...(evidence ? { evidence } : {}) };
  };
  return [
    { name: 'strategy_validate', execute: async (args, signal) => {
      const { source, sourceDigest, operators, diagnostics } = await load(args.source_path, signal);
      return { sourceDigest, operators, diagnostics, graph: graph(source), validationScope: 'svl-source-only' };
    } },
    { name: 'strategy_publish', execute: async (args, signal) => {
      const validated = await load(args.source_path, signal); if (args.parent) await readSource(host, args.parent, signal);
      const refs = args.parent ? [args.parent] : [];
      const result = await publishFiles(host, args.operation_id, { kind: 'strategy.source', schemaVersion: '1.0.0',
        content: { schemaVersion: '1.0.0', strategyId: validated.source.strategyId, title: args.title, language: validated.source.language, languageVersion: validated.source.schemaVersion, sourcePath: 'strategy.svl.json', sourceDigest: validated.sourceDigest, extensions: validated.source.extensions ?? [], parent: args.parent ?? null, changeSummary: args.change_summary },
        dependencies: refs, provenance: { kind: 'user_input', references: refs } }, [file('strategy.svl.json', validated.bytes)],
      args.artifact_id ? { artifactId: args.artifact_id, expectedRevision: args.expected_revision ?? null } : {}, signal);
      return { ref: result.ref, sourceDigest: validated.sourceDigest, graph: graph(validated.source), validationScope: 'svl-source-only' };
    } },
    { name: 'strategy_graph', execute: async (args, signal) => graph((await readSource(host, args.source, signal)).source) },
    { name: 'strategy_replay', execute: async (args, signal) => {
      const validated = await readSource(host, args.source, signal), bytes = await readWorkspace(host, args.fixture_path, signal); fail(bytes.length <= 4194304, 'Replay input exceeds 4 MiB');
      const result = evaluateReplay(validated.source, json(bytes)); signal?.throwIfAborted();
      const output = JSON.stringify(result, null, 2) + '\n'; if (args.output_path) await writeWorkspace(host, args.output_path, output, signal);
      let evidence;
      if (args.operation_id) evidence = (await publishFiles(host, args.operation_id, { kind: 'resource', schemaVersion: '1.0.0',
        content: { type: 'svl-evaluation', source: args.source, sourceDigest: validated.sourceDigest, inputPath: 'input.json', resultPath: 'replay.json', status: result.status, validationScope: 'fixed-input-svl-evaluation' },
        dependencies: [args.source], provenance: await provenance(host, [args.source]) }, [file('input.json', bytes), file('replay.json', output)], {}, signal)).ref;
      return { ...result, ...(evidence ? { evidence } : {}), validationScope: 'fixed-input-svl-evaluation', nativeEngineExecuted: false };
    } },
    { name: 'strategy_pipeline', execute: (args, signal) => evaluateFixture(args, signal) },
    { name: 'strategy_workflow', execute: (args, signal) => evaluateFixture(args, signal, true) },
    ...createDecisionCapabilities(host), ...createQuantCapabilities(host),
    { name: 'strategy_activate', execute: () => activateDecisions(host) },
    { name: 'strategy_dispose', execute: () => disposeDecisions(host) },
  ];
}
