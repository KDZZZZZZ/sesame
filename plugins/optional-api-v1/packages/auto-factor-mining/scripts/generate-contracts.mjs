import { readFileSync, writeFileSync } from 'node:fs';
import { ARTIFACT_SCHEMAS, COLLECTIONS, OPERATORS } from '../contracts.js';

// Generate the static host schemas. Semantic and causal validation remains in
// contracts.js and the shared Python typed-tree compiler.
const text = (max = 256, min = 1) => ({ type: 'string', minLength: min, maxLength: max });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const number = { type: 'number' }, boolean = { type: 'boolean' }, nil = { type: 'null' };
const choice = (...values) => ({ type: 'string', enum: values });
const literal = value => ({ type: typeof value, const: value });
const array = (items, maxItems = 256, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const union = (...oneOf) => ({ oneOf });
const nullable = value => union(value, nil);
const ref = name => ({ $ref: `#/$defs/${name}` });
const hash = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const field = { ...text(64), pattern: '^[a-z][a-z0-9_]{0,63}$' };
const time = { ...text(40), pattern: '^\\d{4}-\\d{2}-\\d{2}T.*(?:Z|[+]00:00)$' };
const record = (value, maxProperties = 128) => ({ type: 'object', maxProperties, additionalProperties: value });
const page = items => object({ items: array(items, 200), cursor: nullable(text(4096)) });
const defs = {};
defs.Json = union(nil, boolean, number, text(65536, 0), array(ref('Json'), 10000), record(ref('Json'), 256));
defs.Ref = object({ id: text(), revision: text(), digest: hash, kind: text(), schemaVersion: literal('1.0.0') });
defs.Error = object({ code: text(128), message: text(2000, 0), retryable: boolean });
defs.Expr = union(object({ field }), object({ constant: { ...number, minimum: -1e12, maximum: 1e12 } }), object({ call: choice(...OPERATORS), args: array(ref('Expr'), 2, 1) }));
defs.ParameterExpr = union(object({ field }), object({ constant: { ...number, minimum: -1e12, maximum: 1e12 } }), object({ parameter: text(64) }), object({ call: choice(...OPERATORS), args: array(ref('ParameterExpr'), 2, 1) }));
defs.Formula = object({ dsl: literal('qlib-expr/1'), tree: ref('Expr') });
defs.Candidate = object({ id: text(128), formula: ref('Formula'), hypothesis: text(4000), origin: object({ method: choice('seed', 'template', 'random', 'deap', 'optuna'), parents: array(text(128), 64), parameters: record(number, 32) }) });
defs.Template = object({ tree: ref('ParameterExpr'), domains: record(array(number, 64, 1), 16) });
defs.Space = object({ fields: array(field, 64, 1), operators: array(choice(...OPERATORS), 64), windows: array(integer(1, 10000), 64), lags: array(integer(1, 10000), 64), constants: array({ ...number, minimum: -1e12, maximum: 1e12 }, 64), maxNodes: integer(1, 128), maxDepth: integer(1, 12), maxLookbackBars: integer(1, 10000), seeds: array(ref('Formula'), 64), templates: array(ref('Template'), 64) });
defs.Source = union(object({ datasetId: text() }), object({ ref: { ...defs.Ref, properties: { ...defs.Ref.properties, kind: literal('data') } } }));
defs.Target = union(object({ kind: choice('forward_return', 'forward_volatility'), field, horizonBars: integer(1, 10000) }), object({ kind: literal('provided'), field, scale: choice('continuous', 'categorical'), horizonBars: integer(1, 10000) }));
defs.Layout = object({ universe: { ...array(text(128), 4096, 1), uniqueItems: true }, frequency: { ...text(32), pattern: '^(?:[1-9]\\d*(?:min|m|h|d)|day)$' }, timezone: literal('UTC'), availableAt: literal('bar_close'), development: array(time, 2, 2), holdout: array(time, 2, 2), target: ref('Target') });
const diagnostic = (kind, options, repetitions = false) => object({ kind: literal(kind), required: boolean, ...(repetitions ? { repetitions: integer(1, 10000) } : {}), options: object(options) });
const resampling = { blockBars: integer(1, 100000), seed: integer(0, 2147483647), confidence: { ...number, exclusiveMinimum: 0, exclusiveMaximum: 1 } };
defs.Diagnostic = union(diagnostic('placebo', resampling, true), diagnostic('bootstrap', resampling, true), diagnostic('walk_forward', { foldBars: integer(3, 1000000) }), diagnostic('regimes', { field, bins: array(number, 20, 1) }), diagnostic('sensitivity', { argumentPath: array(integer(0, 1), 12), neighbors: array(number, 16, 1) }), diagnostic('quantiles', { count: integer(2, 20) }));
defs.Profile = object({ id: text(128), version: literal(1), kind: choice('alpha', 'risk', 'state'), axis: choice('time_series', 'cross_section'), minPairs: integer(3, 1000000), minCoverage: { ...number, minimum: 0, maximum: 1 }, stabilityWindows: integer(2, 100), maxReferenceCorrelation: { ...number, minimum: 0, maximum: 1 }, score: choice('abs_rank_ic', 'eta_squared'), diagnostics: array(ref('Diagnostic'), 6) });
defs.ResourceBudget = object({ maxSeconds: integer(1, 86400), maxInputBytes: integer(1024, 512 * 1024 * 1024), maxOutputBytes: integer(1024, 512 * 1024 * 1024) });
defs.SearchBudget = object({ ...defs.ResourceBudget.properties, maxCandidates: integer(1, 100000), batchSize: integer(1, 64), seed: integer(0, 2147483647) });
defs.Factor = object({ id: text(128), formula: ref('Formula'), definitionDigest: hash, evaluationIds: array(text(128), 200), annotations: array(text(4000), 200) });
defs.EvidenceContext = object(Object.fromEntries(['snapshotId', 'sourceDigest', 'layoutDigest', 'profileDigest', 'engineDigest', 'referenceDigest'].map(name => [name, name === 'snapshotId' ? text(128) : hash])));
defs.Metric = object({ value: nullable(number), status: choice('computed', 'unavailable'), reason: text(2000) }, ['value', 'status']);
defs.Evaluation = object({ id: text(128), candidateId: text(128), valuesId: text(128), valuesRef: ref('Ref'), context: ref('EvidenceContext'), profile: ref('Profile'), partition: choice('development', 'holdout'), pairs: integer(0, 100000000), ...Object.fromEntries(['coverage', 'ic', 'rankIC', 'stability', 'maxReferenceCorrelation', 'complement', 'score'].map(name => [name, ref('Metric')])), diagnostics: array(object({ kind: choice('placebo', 'bootstrap', 'walk_forward', 'regimes', 'sensitivity', 'quantiles'), status: choice('passed', 'failed', 'incomplete'), evidence: nullable(ref('Ref')), reason: text(2000) }, ['kind', 'status', 'evidence']), 6), eligibility: choice('supported', 'insufficient', 'invalid'), reasons: array(text(2000), 256), details: ref('Ref') });
defs.Query = object({ fields: array(field, 64), kind: choice('alpha', 'risk', 'state'), axis: choice('time_series', 'cross_section'), universe: array(text(), 4096), frequency: text(32), profileId: text(128), minCoverage: { ...number, minimum: 0, maximum: 1 }, evidenceMatch: ref('EvidenceContext'), cursor: text(4096), limit: integer(1, 200) }, []);
defs.PoolChange = object({ operationId: text(128), poolId: text(128), strategyId: text(128), expectedVersion: integer(0, 2147483647), decision: choice('add', 'replace', 'remove'), factorIds: array(text(128), 256), replaces: array(text(128), 256), purpose: text(4000), reason: text(4000), strategyVersion: text(128), applicationEvidence: array(ref('Ref'), 32) });
defs.Pool = object({ id: text(128), strategyId: text(128), version: integer(0, 2147483647), factorIds: array(text(128), 256), history: ref('Ref') });

function schema(value) {
  const names = new Set();
  function visit(part) {
    if (!part || typeof part !== 'object') return;
    if (part.$ref?.startsWith('#/$defs/')) {
      const name = part.$ref.slice(8);
      if (!names.has(name)) { names.add(name); visit(defs[name]); }
    }
    Object.values(part).forEach(item => Array.isArray(item) ? item.forEach(visit) : visit(item));
  }
  visit(value);
  return { type: 'object', ...value, ...(names.size ? { $defs: Object.fromEntries([...names].sort().map(name => [name, defs[name]])) } : {}) };
}
function capability(id, input, output, purpose, inputs, outputs, effects = ['read'], extra = {}) {
  return { id, kind: 'function', consumers: ['agent', 'host'], description: purpose, inputSchema: schema(input), outputSchema: schema(output), execution: 'immediate', effects, usage: { purpose, inputs, outputs, prerequisites: [], limitations: ['All data and formulas must satisfy the frozen qlib-expr/1 contract; results retain missing evidence and exclusions.'] }, binding: { type: 'native', name: id }, ...extra };
}
const requirement = [{ field: 'pythonPath', reason: 'Prepare or select the verified Qlib/DEAP/Optuna environment before numerical work.', optional: false }];
const common = { requestId: text(128), budget: ref('ResourceBudget') };
const nativeStep = { execution: 'run', resumable: true, configurationRequirements: requirement };
// These fixed numerical commands do not expose arbitrary process execution or
// trading. Keep their effects distinct so Agent workflows can run them in parallel.
const numericalEffects = ['execution', 'plugin.state.write', 'resources.publish'];
const item = value => union(object({ id: text(128), status: literal('ok'), value }), object({ id: text(128), status: literal('failed'), error: ref('Error') }));
const searchInput = union(
  object({ action: literal('open'), requestId: text(128), snapshotRef: ref('Ref'), need: text(8000), space: ref('Space'), profile: ref('Profile'), references: array(text(128), 32), budget: ref('SearchBudget') }),
  object({ action: literal('propose'), requestId: text(128), searchId: text(128), limit: integer(0, 64), feedback: array(object({ factorId: text(128), evaluationId: text(128) }), 64) }),
  object({ action: literal('read'), searchId: text(128) }),
);
const searchOutput = object({ searchId: text(128), snapshotRef: ref('Ref'), checkpoint: nullable(ref('Ref')), attempted: integer(0, 100000), exhausted: boolean, candidates: array(ref('Candidate'), 64) });
const caps = [
  capability('factor_environment', object({ action: choice('inspect', 'prepare'), pythonPath: text(4096) }, ['action']), object({ ready: boolean, pythonPath: text(4096), versions: record(text(128), 512), environmentDigest: { type: 'string', pattern: '^(?:sha256:[a-f0-9]{64})?$' }, reason: text(2000) }, ['ready', 'pythonPath', 'versions', 'environmentDigest']), 'Inspect genuine engine imports or prepare a private pinned environment.', '{action:"inspect"|"prepare",pythonPath?}; prepare uses existing CPython 3.12 and installs only into a private venv.', '{ready,pythonPath,versions,environmentDigest,reason?}; ready reflects actual imports and the validated dependency lock.', ['process', 'plugin.state.write', 'private-filesystem', 'network-on-prepare'], { execution: 'run' }),
  capability('factor_prepare', object({ ...common, source: ref('Source'), layout: ref('Layout') }), object({ snapshotRef: ref('Ref'), snapshotId: text(128), fields: array(field, 65536), layout: ref('Layout'), rows: object({ development: integer(0, 100000000), holdout: integer(0, 100000000) }) }), 'Freeze source data into a reusable immutable Qlib snapshot; perform no search or evaluation.', '{requestId,source,layout,budget:{maxSeconds,maxInputBytes,maxOutputBytes}}. Declare UTC development/holdout partitions and the prediction target.', '{snapshotRef,snapshotId,fields,layout,rows}. Read the completed native Run output before scheduling dependent work.', numericalEffects, nativeStep),
  capability('factor_search', searchInput, searchOutput, 'Open a fixed search space or request one candidate batch; the caller decides whether to continue.', 'Open: {action:"open",requestId,snapshotRef,need,space,profile,references,budget}. Propose: {action:"propose",requestId,searchId,limit,feedback:[{factorId,evaluationId}]}. Read: {action:"read",searchId}. Only genuine matching development evaluations may be feedback.', '{searchId,snapshotRef,checkpoint,attempted,exhausted,candidates}. Open/read return no candidates. Propose never computes or evaluates them; limit=0 only acknowledges feedback.', numericalEffects, nativeStep),
  capability('factor_compute', object({ ...common, snapshotRef: ref('Ref'), formulas: array(ref('Candidate'), 64, 1), partition: choice('development', 'holdout'), diagnostics: array(ref('Diagnostic'), 6) }, ['requestId', 'budget', 'snapshotRef', 'formulas', 'partition']), object({ valuesRef: ref('Ref'), valuesId: text(128), snapshotId: text(128), partition: choice('development', 'holdout'), candidates: array(union(object({ id: text(128), status: literal('ok'), computeKey: hash }), object({ id: text(128), status: literal('failed'), error: ref('Error') })), 64) }), 'Compute only the specified formulas and partition using Qlib; keep evaluation and reference selection with the caller.', '{requestId,snapshotRef,formulas,partition,budget,diagnostics?}. diagnostics prepares explicitly requested auxiliary values. No implicit reference computation or holdout selection.', '{valuesRef,valuesId,snapshotId,partition,candidates}; matrices remain in immutable artifacts. Independent calls may run in parallel under host Run control.', numericalEffects, nativeStep),
  capability('factor_evaluate', object({ ...common, valuesRef: ref('Ref'), profile: ref('Profile'), referenceValues: array(ref('Ref'), 32) }), object({ valuesRef: ref('Ref'), partition: choice('development', 'holdout'), evaluations: array(item(ref('Evaluation')), 64), factorIds: array(text(128), 64) }), 'Evaluate existing immutable values and archive genuine evidence in the library; do not select strategy pool members.', '{requestId,valuesRef,profile,referenceValues,budget}. Compute any reference factors separately and pass their matching Values refs; use [] when none are required.', '{valuesRef,partition,evaluations,factorIds}. These are factor measurements; application backtests and final reports remain separate Agent decisions.', numericalEffects, nativeStep),
  capability('factor_library', union(object({ action: literal('query'), query: ref('Query') }), object({ action: literal('read'), factorId: text(128), cursor: text(4096), limit: integer(1, 200) }, ['action', 'factorId']), object({ action: literal('annotate'), factorId: text(128), note: text(4000), operationId: text(128) })), union(page(ref('Factor')), object({ factor: ref('Factor'), evaluations: page(ref('Evaluation')) }), ref('Factor')), 'Query immutable factor definitions and separately versioned evidence, or add an annotation.', 'Query: {action:"query",query}. Read: {action:"read",factorId,cursor?,limit?}. Annotate: {action:"annotate",factorId,note,operationId}. Numerical metrics cannot be submitted.', 'Page<Factor>, {factor,evaluations:Page<Evaluation>}, or Factor.', ['plugin.state.write']),
  capability('factor_pool', union(object({ action: literal('read'), poolId: text(128) }), object({ action: literal('decide'), change: ref('PoolChange') }), object({ action: literal('feedback'), poolId: text(128), strategyVersion: text(128), poolVersion: integer(0, 2147483647), applicationEvidence: array(ref('Ref'), 32), note: text(4000), operationId: text(128) })), union(ref('Pool'), ref('Ref')), 'Apply an explicit external strategy decision to its factor pool or attach application evidence.', 'Read: {action:"read",poolId}. Decide: {action:"decide",change:{operationId,poolId,strategyId,expectedVersion,decision,factorIds,replaces,purpose,reason,strategyVersion,applicationEvidence}}. Feedback supplies observed strategy/pool versions and refs.', 'Pool or a fixed feedback reference. Mining never changes pool membership; the caller owns the strategy decision.', ['plugin.state.write']),
  capability('factor_configuration_read', object({}), object({ pythonPath: nullable(text(4096)), ready: boolean }), 'Read the saved environment selection for unified configuration.', '{}; reads selected configuration without installation or numerical work.', '{pythonPath,ready}; execution rechecks the actual environment before computing.', ['read'], { consumers: ['host'] }),
  capability('factor_configuration_update', object({ pythonPath: text(4096), command_id: text(128), expected_version: integer(0, 2147483647) }, ['pythonPath', 'command_id']), object({ pythonPath: nullable(text(4096)), ready: boolean }), 'Verify and select an existing compatible Python environment.', '{pythonPath,command_id,expected_version?}; only existing dependencies are probed; use factor_environment prepare for installation.', '{pythonPath,ready} after actual environment verification.', ['process', 'plugin.state.write'], { consumers: ['host'] }),
];
const historical = [
  ['final-report-example', 'examples/report.demo.html'], ['knowledge-4', 'examples/demo-run.json'],
  ...['research-guide', 'factor-method', 'factor-cli', 'strategy-evidence', 'strategy-cli'].map(name => [`integrated-references-${name}-md`, `references/${name}.md`]),
  ...['factor', 'experiment'].map(name => [`integrated-scripts-reference-${name}-mjs`, `scripts/reference-${name}.mjs`]),
  ...['development', 'holdout', 'plan'].map(name => [`integrated-examples-reference-factor-${name}-demo-json`, `examples/reference-factor/${name}.demo.json`]),
  ...['input', 'plan', 'timing', 'trials'].map(name => [`integrated-examples-reference-strategy-${name}-demo-json`, `examples/reference-strategy/${name}.demo.json`]),
  ['native-validation', 'references/native-validation.md'], ['native-roundtrip-example', 'examples/native-roundtrip.py'],
];
const manifest = {
  schemaVersion: 1, apiVersion: '2', configSchema: object({}), capabilities: caps, sources: [], services: [], hooks: [], views: [],
  configuration: { title: '因子研究环境', fields: [{ id: 'pythonPath', title: 'Python 环境', description: '已核验的 CPython 3.12 与固定 Qlib、DEAP、Optuna 依赖。安装私有依赖请调用 factor_environment prepare。', schema: text(4096), binding: { type: 'capability', read: 'factor_configuration_read', update: 'factor_configuration_update', valuePath: '/pythonPath', configuredPath: '/ready', writePath: '/pythonPath' } }] },
  knowledge: [
    ...[['prompt', 'prompt.md', 'prompt'], ['readme', 'README.md', 'reference'], ['provenance', 'PROVENANCE.md', 'reference'], ['validation', 'VALIDATION.md', 'reference'], ['factor-research', 'skills/auto-factor-mining/SKILL.md', 'skill'], ['contracts', 'references/contracts.md', 'reference'], ['evaluation', 'references/evaluation.md', 'reference'], ['search', 'references/search.md', 'reference'], ['execution', 'references/execution.md', 'reference']].map(([id, path, kind]) => ({ id, path, kind, description: 'Current factor-research v3 contract, usage or verification evidence. Agent directly orchestrates each independent step.' })),
    ...historical.map(([id, path]) => ({ id, path, kind: 'reference', description: 'Historical v1 material retained for provenance. Its commands, metrics and protocols are not the current v3 interface; use references/contracts.md.' })),
  ],
  stateCollections: Object.values(COLLECTIONS).map(name => ({ name, schemaVersion: '1', mode: 'document', access: 'private', schema: schema(record(ref('Json'), 128)) })),
  artifactSchemas: [
    { id: 'factor-resource', kind: 'resource', schemaVersion: '1.0.0', schema: object({ format: choice('factor-json/1', 'factor-binary/1'), path: choice('payload.json', 'payload.bin'), bytesDigest: hash, schema: choice(...ARTIFACT_SCHEMAS) }) },
    { id: 'factor-source', kind: 'data', schemaVersion: '1.0.0', schema: schema(object({ format: literal('json-rows'), path: literal('payload.json'), rowCount: integer(0, 100000000), columns: array(text(128), 256), provenance: record(ref('Json'), 128) })) },
  ],
};
const target = new URL('../capabilities.json', import.meta.url), contents = JSON.stringify(manifest, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== contents) throw new Error('Capability schemas differ; regenerate and review them.');
} else writeFileSync(target, contents);
