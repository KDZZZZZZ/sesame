const fail = (condition, message) => { if (!condition) throw new Error(message); };
const json = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
const refSchema = Type => Type.Object({ id: Type.String(), revision: Type.String(), digest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), kind: Type.Literal('strategy.source'), schemaVersion: Type.Literal('1.0.0') }, { additionalProperties: false });

function readSource(host, ref) {
  fail(ref?.kind === 'strategy.source', 'A fixed strategy.source reference is required');
  const artifact = host.artifacts.read(ref), content = artifact.manifest.content;
  const blob = artifact.manifest.blobs.find(b => b.path === content.sourcePath);
  fail(blob, 'Strategy source blob is missing');
  const validated = host.svl.validateSource(host.artifacts.readBlob(blob).toString('utf8'));
  fail(validated.sourceDigest === content.sourceDigest, 'SVL semantic digest does not match the published source');
  return validated;
}

export function createTools(host) {
  const { define, Type, string, optional } = host.tools;
  const ref = refSchema(Type);
  const load = async (path, signal) => {
    const bytes = await host.workspace.file('read', path, undefined, signal);
    fail(bytes.length <= 1024 * 1024, 'SVL source exceeds 1 MiB');
    return { bytes, ...host.svl.validateSource(bytes.toString('utf8')) };
  };
  return [
    define('strategy_validate', 'Validate an authored SVL/1 JSON file and return its actual semantic digest, operators and graph. This does not run a native engine or place orders.', {
      source_path: string('Workspace path to the authored SVL JSON file'),
    }, async (args, signal) => {
      const { source, sourceDigest, operators, diagnostics } = await load(args.source_path, signal);
      return { sourceDigest, operators, diagnostics, graph: host.svl.graph(source), validationScope: 'svl-source-only' };
    }),
    define('strategy_publish', 'Publish a validated SVL source as an immutable strategy.source artifact. Preserve this exact reference for target translation and future trade evidence.', {
      operation_id: string('Unique idempotency key for this exact publication'), source_path: string('Workspace SVL JSON path'), title: string('Strategy title'), change_summary: string('What this source revision changes'),
      parent: Type.Optional(ref), artifact_id: optional('Existing artifact ID when publishing a new revision'), expected_revision: optional('Exact current revision when updating an existing artifact'),
    }, async (args, signal) => {
      const validated = await load(args.source_path, signal);
      if (args.parent) readSource(host, args.parent);
      const blob = host.artifacts.blob(validated.bytes);
      signal?.throwIfAborted();
      const published = host.artifacts.publish({ operationId: args.operation_id, ...(args.artifact_id ? { artifactId: args.artifact_id, expectedRevision: args.expected_revision ?? null } : {}), manifest: {
        kind: 'strategy.source', schemaVersion: '1.0.0', content: { schemaVersion: '1.0.0', strategyId: validated.source.strategyId, title: args.title, language: 'svl/1', languageVersion: '1.0.0', sourcePath: 'strategy.svl.json', sourceDigest: validated.sourceDigest, extensions: validated.source.extensions ?? [], parent: args.parent ?? null, changeSummary: args.change_summary },
        blobs: [{ ...blob, path: 'strategy.svl.json', mediaType: 'application/json' }], dependencies: args.parent ? [args.parent] : [], provenance: { kind: 'user_input', references: args.parent ? [args.parent] : [] },
      } });
      return { ref: published, sourceDigest: validated.sourceDigest, graph: host.svl.graph(validated.source), validationScope: 'svl-source-only' };
    }),
    define('strategy_graph', 'Read a fixed SVL source artifact and derive its graph from the same validated AST. No layout or explanation is treated as execution evidence.', {
      source: ref,
    }, args => host.svl.graph(readSource(host, args.source).source)),
    define('strategy_replay', 'Evaluate fixed ordered input events against a saved SVL source. Produces state, intents and actual evaluator traces; it is not a broker simulator, native backtest or translation-equivalence receipt.', {
      source: ref, fixture_path: string('Workspace JSON with runId, parameters, initialState and ordered events'), output_path: optional('Optional workspace path for the complete evaluation result'), operation_id: optional('If provided, preserve this replay as a generic resource artifact'),
    }, async (args, signal) => {
      const validated = readSource(host, args.source), bytes = await host.workspace.file('read', args.fixture_path, undefined, signal);
      fail(bytes.length <= 4 * 1024 * 1024, 'Replay input exceeds 4 MiB');
      const fixture = json(bytes), result = host.svl.evaluateReplay(validated.source, fixture);
      signal?.throwIfAborted();
      const output = JSON.stringify(result, null, 2) + '\n';
      if (args.output_path) await host.workspace.file('write', args.output_path, output, signal);
      let evidence;
      if (args.operation_id) {
        const inputBlob = host.artifacts.blob(bytes), outputBlob = host.artifacts.blob(output);
        evidence = host.artifacts.publish({ operationId: args.operation_id, manifest: { kind: 'resource', schemaVersion: '1.0.0', content: { type: 'svl-evaluation', source: args.source, sourceDigest: validated.sourceDigest, inputPath: 'input.json', resultPath: 'replay.json', status: result.status, validationScope: 'fixed-input-svl-evaluation' }, dependencies: [args.source], blobs: [{ ...inputBlob, path: 'input.json', mediaType: 'application/json' }, { ...outputBlob, path: 'replay.json', mediaType: 'application/json' }], provenance: { kind: 'derived', references: [args.source] } } });
      }
      return { ...result, ...(evidence ? { evidence } : {}), validationScope: 'fixed-input-svl-evaluation', nativeEngineExecuted: false };
    }),
  ];
}
