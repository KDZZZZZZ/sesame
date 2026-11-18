// The host loads static JSON. Keep the public contract in sync with the mandate and native search inputs.
import { readFile, writeFile } from 'node:fs/promises';
import { mandateInputSchema } from '../packages/strategy-development/mandate.js';
import { experimentSchema } from '../packages/strategy-development/experiments.js';
import { partitionCollection } from '../packages/strategy-development/partition-history.js';
import { methods } from '../packages/strategy-development/research-method.js';

const target = new URL('../packages/strategy-development/capabilities.json', import.meta.url);
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const text = { type: 'string', minLength: 1, maxLength: 2000 };
const record = { type: 'object' };
const ref = (kind = 'resource') => obj({ id: text, revision: text, digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  kind: kind ? { const: kind } : text, schemaVersion: { const: '1.0.0' } }, ['id', 'revision', 'digest', 'kind', 'schemaVersion']);
const op = { ...text, maxLength: 128, description: 'Stable operation key for this exact input. Choose a new key for a revision or a changed experiment.' };
const component = { anyOf: [text, obj({ model: text, settings: record }, ['model']), { type: 'null' }] };
const slots = ['universe', 'alpha', 'portfolio', 'risk', 'execution', 'stateMachine'];
const design = obj({
  strategyId: text, mode: { enum: ['framework', 'state_machine', 'hybrid'] },
  components: obj(Object.fromEntries(slots.map(slot => [slot, component]))),
  bindings: obj({
    instruments: { type: 'array', items: obj({ sourceId: text, instrumentId: text }, ['sourceId', 'instrumentId']) },
    ...Object.fromEntries(['marketDataRef', 'candidateSnapshotRef', 'riskPolicyRef', 'costModelRef', 'targetProfileRef', 'volatilityRef', 'confidenceRef'].map(key => [key, ref(null)])),
    workflowFixture: record,
  }),
  factors: { type: 'array', maxItems: 64, description: 'Optional uses of existing factor definitions. Omit for rules and direct signals.',
    items: obj({ purpose: { enum: ['alpha', 'entry_filter', 'regime', 'sizing', 'exit', 'risk'] }, factorId: text, definitionDigest: text,
      evaluationId: text, sourcePartition: text, profileId: text, snapshotId: text, librarySearched: { type: 'boolean' }, consumption: record, implementation: record }, ['purpose']) },
});
const [grid, confirm, mt5] = structuredClone(experimentSchema.anyOf);
for (const branch of [grid, confirm, mt5]) {
  for (const key of ['operation_id', 'strategy_path', 'source_digest']) delete branch.properties[key];
  branch.required = branch.required.filter(key => Object.hasOwn(branch.properties, key));
}
grid.required = grid.required.filter(key => !['objective', 'title', 'class_name'].includes(key));
grid.properties.config.required = ['feed']; // the mandate can already supply capital and costs
const registered = obj({ backend: { const: 'backtrader' }, planned_trial: { const: true }, python_path: grid.properties.python_path }, ['backend', 'planned_trial']);
const experiment = { anyOf: [grid, confirm, mt5, registered] };
const parameterTrial = obj({ parameter: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }, to: { anyOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string', maxLength: 1000 }] },
  component: { enum: ['alpha', 'entry', 'exit', 'portfolio', 'risk', 'execution'] }, hypothesis: text,
  primary: { enum: ['turnover', 'commission', 'netReturn', 'maxDrawdown', 'closedTrades', 'finalEquity'] }, direction: { enum: ['maximize', 'minimize'] } },
  ['parameter', 'to', 'component', 'hypothesis', 'primary', 'direction']);
const ids = { type: 'array', items: text, minItems: 1, maxItems: 8, uniqueItems: true };
const researchDesign = obj({ mechanism: text, rival: text, prediction: text, distinguishing_test: text, falsifier: text,
  method: { enum: methods.map(m => m.id) } }, ['mechanism']);
const projectResult = { type: 'object', required: ['projectRef', 'mandateRef', 'stage'], properties: { projectRef: ref(), mandateRef: ref(), stage: text } };
const capabilities = [];
function add(id, purpose, inputSchema, inputs, outputs, effects, { workflow = false, result = projectResult, limitations = [] } = {}) {
  capabilities.push({ id, kind: workflow ? 'workflow' : 'function', consumers: ['agent', 'host'], execution: workflow ? 'run' : 'immediate',
    ...(workflow ? { resumable: true } : {}), description: purpose, inputSchema, outputSchema: result, effects,
    usage: { purpose, inputs, outputs, prerequisites: [], limitations }, binding: { type: 'native', name: id } });
}
add('strategy_development_plan', '根据上下文填写研究委托，选用策略结构，按需接入已有因子；从固定项目局部修订。',
  obj({ operation_id: op, goal: { ...text, maxLength: 8000 }, project_ref: ref(), mandate: mandateInputSchema, design, reason: text,
    research_design: researchDesign, parameter_trial: parameterTrial,
    replace: obj({ slot: { enum: slots }, component }, ['slot', 'component']) }, ['operation_id']),
  'Start from goal or continue project_ref. Agent can supply research_design with a market mechanism, competing explanation, prediction and distinguishing test. Use design, replace one slot, or register parameter_trial from a frozen baseline.',
  'Immutable projectRef, mandateRef, component gaps, questions requiring a decision, and the next action.', ['resources.write', 'declared-calls']);
add('strategy_development_build', '发布固定 SVL；可选验证事件、组合规则，冻结独立编写的 Backtrader 实现。',
  obj({ operation_id: op, project_ref: ref(), title: text, change_summary: text, source_path: text, native_source_path: text, native_template: { const: 'forecast_buffer' },
    replay_path: text, workflow_path: text }, ['operation_id', 'project_ref']),
  'Use local source paths or choose the editable forecast_buffer native daily cash-equity template. SVL, authored native programs and the template have separate scopes.',
  'New projectRef, fixed source, independent native code and any actual fixed-event receipts.', ['resources.create', 'resources.publish', 'workspace.write'],
  { limitations: ['A starter may cover signal/rule state only. SVL event or method replay does not measure trading profitability.'] });
add('strategy_development_backtest', '在开发集批量运行原生回测，按委托硬约束筛选与择优，可用独立留出验证冻结参数。',
  obj({ operation_id: op, project_ref: ref(), experiment }, ['operation_id', 'project_ref', 'experiment']),
  'Declare data, objective, constraints and parameter selection before the search. An empty grid with max_trials:1 runs a fixed baseline. Use planned_trial:true for a predeclared change, and selection_ref plus a fresh holdout for confirmation. The packaged native template supplies its own class name.',
  'Tracked workflow Run. Its output contains projectRef, trial/exclusion counts, native evidence and the development winner or actionable gaps.',
  ['resources.write', 'state.write', 'declared-calls', 'execution'], { workflow: true, limitations: ['The Backtrader program is independently authored. MT5 requires its own target, translation, conformance and Tester evidence.'] });
add('strategy_development_read', '读取某个固定版本，查看委托、可编辑的策略模型、缺口和下一轮诊断。',
  obj({ project_ref: ref(), trade_page: obj({ offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }) }, ['project_ref']),
  'Use the exact projectRef from a prior step, optionally page through the measured development trades.', 'The project and evidence-based diagnostics.', ['read'], { result: record });
add('strategy_development_method', '按当前研发问题查找方法，读取适用情形、替代解释、区分它们的实验和具体改法。',
  obj({ method: { enum: methods.map(m => m.id) } }), 'Omit method for the index or select a method by its ID.',
  'Research technique and worked guidance for the judgment at hand.', ['read'], { result: record });
const barsCount = { type: 'integer', minimum: 1, maximum: 500 };
add('strategy_development_study', '在开发行情上检验一个设计假设。对突破机会分解跳空和下一根开盘后的延续，观察委托允许入场时还剩多少走势。',
  obj({ operation_id: op, project_ref: ref(), development: ref('data'), columns: grid.properties.columns,
    study: obj({ method: { const: 'breakout_continuation' }, lookback: barsCount, horizon: barsCount, side: { enum: ['long', 'short', 'both'] } },
      ['method', 'lookback', 'horizon', 'side']) }, ['operation_id', 'project_ref', 'development', 'study']),
  'Choose a frozen single-instrument development OHLC table, lookback, holding horizon and direction. Can run immediately after plan.',
  'Pinned study, counts, directional price changes before and after the next open, and an all-eligible-bars reference. These gross labels can motivate an executable strategy test.',
  ['resources.write', 'state.write']);
add('strategy_development_verify', '对固定的单路已收盘 SVL 行情重放，在同一决策时刻核对可用输入、预热长度、节点、状态和订单意图。',
  obj({ operation_id: op, project_ref: ref(), event_ids: ids, trace_nodes: ids,
    warmup_lengths: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 10000 } } }, ['operation_id', 'project_ref', 'event_ids']),
  'Choose checkpoints in a published replay. Closed bars require explicit UTC openTime, endTime, first availableAt, and decision availableAt. Choose warmup_lengths and trace_nodes relevant to the rule.',
  'New projectRef and pinned assessment of observed changes, first-availability violations and uncovered decisions.', ['resources.write']);
add('strategy_development_compare', '比较开发期原生基线、候选、匹配对照和消融实验，定位单个改动的增量。',
  obj({ baseline: ref(), candidate: ref(), matched: ref(), ablation: ref(), retuned: { type: 'boolean' } }, ['baseline', 'candidate']),
  'Supply project references with native development results. Declare retuned when variants chose their own parameters.',
  'Comparable development metrics, changes in observed trades, unresolved controls and interpretation limits.', ['read'], { result: record });
const existingKnowledgeIds = { 'strategy-decomposition': 'design', 'component-verification': 'verification',
  'incremental-evaluation': 'incremental', 'trade-diagnosis': 'diagnosis' };
const sources = [
  ['instructions', 'prompt', 'prompt.md', 'Strategy development routing and factor evidence boundaries.'],
  ['guide', 'reference', 'README.md', 'Workflow, package inputs, parameter search and versioned decisions.'],
  ...methods.map(method => [existingKnowledgeIds[method.id] ?? method.id, 'reference', method.path, method.useWhen]),
  ['forecast-buffer', 'reference', 'references/forecast-buffer.md', 'Worked, executable example of setting risk-based positions and reducing small rebalances.'],
];
const manifest = { schemaVersion: 1, apiVersion: '2', capabilities, configSchema: obj({}), sources: [], services: [], views: [], hooks: [], stateCollections: [partitionCollection],
  knowledge: sources.map(([id, kind, path, description]) => ({ id, kind, path, description })),
  artifactSchemas: [{ id: 'strategy-development-record', kind: 'resource', schemaVersion: '1.0.0',
    schema: obj({ type: text, path: { const: 'record.json' }, digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' } }, ['type', 'path', 'digest']) }] };
const output = JSON.stringify(manifest, null, 2) + '\n';
if (process.argv.includes('--write')) await writeFile(target, output);
else if (await readFile(target, 'utf8') !== output) throw new Error('Regenerate the strategy-development capability manifest with --write.');
