import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateSource, graph } from '@sesame/plugin-sdk/svl';
import { canonical, digest as valueDigest } from '@sesame/plugin-sdk/protocol';
import { projectFiles, DEFAULT_RISK_LIMITS, SDK_VERSION } from './contracts.js';
import { parameterMapping } from './parameters.js';
import { id, now, requireValue } from './support.js';

const limitations = [
  'MQL5 uses native binary64 numbers; SVL decimal34 arithmetic is not automatically equivalent. A fixed tolerance and target replay are required for numerical equivalence claims.',
  'Submitting source maps validates identities and line bounds only. It does not prove that submitted MQL5 implements the SVL decisions.',
  'Broker wall time has no inferred UTC offset. Forming-bar versus closed-bar events must be implemented explicitly.',
  'Run ownership, pending intents, partial fills and restart reconciliation require native instrumentation. Manual or external trades have unknown strategy correlation.',
  'Native Tester evidence requires the packaged Product telemetry/result SDK. A compile receipt alone proves no backtest or live behavior.',
];
const resources = ['tools.json', 'target/README.md', 'skills/svl-mql5/SKILL.md', 'backend/sdk/Expert.mqh', 'backend/sdk/Telemetry.mqh', 'backend/sdk/Trade.mqh', 'backend/sdk/Results.mqh', 'backend/sdk/Risk.mqh', 'backend/sdk/Visual.mqh'];
const root = fileURLToPath(new URL('../', import.meta.url));
const unknown = reason => ({ status: 'unknown', reason });
const value = value => ({ status: 'value', value });
const publish = (host, operationId, kind, content, dependencies = [], blobs = []) => host.artifacts.publish({ operationId, manifest: { kind, schemaVersion: '1.0.0', content, dependencies, blobs } });

export async function targetProfile(host) {
  const blobs = [];
  for (const path of resources) blobs.push({ path, mediaType: path.endsWith('.md') ? 'text/markdown' : 'text/plain', ...host.artifacts.blob(await fs.readFile(join(root, path))) });
  const tools = JSON.parse(await fs.readFile(join(root, 'tools.json'), 'utf8')).filter(tool => ['mt5_translation', 'mt5_compile', 'mt5_backtest', 'mt5_deployment'].includes(tool.name)).map(tool => ({ pluginId: host.plugin.id, toolId: tool.name, schemaDigest: valueDigest(tool.parameters) }));
  const content = { schemaVersion: '1.0.0', id: 'sesame.mt5.mql5', version: '1.0.0', modes: ['backtest', 'live'], language: { name: 'MQL5', versions: ['5'] }, platforms: ['win32', 'darwin', 'linux'],
    runtime: { engine: 'MetaTrader 5', versions: ['observed at execution'], entryDescription: 'Experts/Strategy.mq5, compiled by the frozen installed MetaEditor; the Agent supplies the SVL translation.', resources },
    svl: { versions: ['1.0.0'], operators: [], events: ['tick', 'bar.updated', 'bar.closed', 'timer', 'order.updated', 'fill', 'recovery'], extensions: [] },
    semantics: { dataGranularity: ['tick', 'forming_bar', 'closed_bar'], timeBases: ['wall'], positionModes: ['netting', 'hedging'], quantityUnits: ['lot'], orderTypes: ['market', 'limit', 'stop', 'stop_limit'], timeInForce: ['gtc', 'day', 'ioc', 'fok'], numericalPolicy: 'target/README.md#numerical-policy', recoveryPolicy: 'target/README.md#recovery' },
    resources: resources.map(path => ({ role: path.endsWith('.mqh') ? 'sdk' : 'guide', path })), workflows: [{ purpose: 'Translate a frozen SVL source into native MQL5', skill: 'skills/svl-mql5/SKILL.md', tools }],
    verification: { driver: null, supportsEventReplay: false, supportsInjectedResponses: false, traceLevel: 'node', limitations },
    translation: { method: 'agent-authored', automaticOperators: [], numericalEquivalence: 'requires_target_evidence' }, plugin: host.plugin };
  return publish(host, `target-${valueDigest({ content, blobs })}`, 'strategy.target', content, [], blobs);
}

function readSource(host, ref) {
  const artifact = host.artifacts.read(ref);
  requireValue(ref.kind === 'strategy.source', '需要冻结的 SVL 源成果');
  const path = artifact.manifest.content.sourcePath;
  const blob = artifact.manifest.blobs.find(blob => blob.path === path);
  requireValue(blob, '源成果缺少声明的 SVL 文件');
  const checked = validateSource(host.artifacts.readBlob(blob).toString('utf8'));
  requireValue(checked.sourceDigest === artifact.manifest.content.sourceDigest, 'SVL 源语义摘要与成果不一致');
  return checked;
}

export function validateMapping(source, files, sourceMap) {
  requireValue(Array.isArray(sourceMap), '需要逐节点 source_map');
  const nodes = new Set(source.nodes.map(node => node.id)), covered = new Set();
  for (const entry of sourceMap) {
    requireValue(nodes.has(entry.nodeId) && !covered.has(entry.nodeId), 'source_map 引用未知或重复节点'); covered.add(entry.nodeId);
    requireValue(['direct', 'inlined', 'boundary', 'unobservable'].includes(entry.instrumentation) && Array.isArray(entry.generated), 'source_map 可观测范围无效');
    requireValue(entry.instrumentation === 'unobservable' ? typeof entry.reason === 'string' && entry.reason.trim() : entry.generated.length > 0, '可执行节点必须有真实行映射或不可观测原因');
    for (const span of entry.generated) requireValue(typeof files[span.path] === 'string' && Number.isInteger(span.startLine) && span.startLine > 0 && Number.isInteger(span.endLine) && span.endLine >= span.startLine && span.endLine <= files[span.path].split('\n').length, 'source_map 超出实际文件行范围');
  }
  requireValue(covered.size === nodes.size, '每个 SVL 节点都必须有映射或不可观测原因');
  return structuredClone(sourceMap);
}

export async function registerTranslation(host, mt5, args) {
  requireValue(typeof args.operation_id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(args.operation_id), '需要稳定的翻译操作 ID');
  const operation = valueDigest(args.operation_id).slice(7);
  return host.storage.idempotentAsync(`translation-${operation}`, valueDigest(args), async () => {
    const checked = readSource(host, args.source), target = host.artifacts.read(args.target);
    requireValue(args.target.kind === 'strategy.target' && target.producer.id === host.plugin.id && target.manifest.content.id === 'sesame.mt5.mql5', '需要 MT5 插件发布的固定目标 profile');
    requireValue(['backtest', 'live'].includes(args.mode), 'MT5 翻译模式为 backtest 或 live');
    requireValue(typeof args.title === 'string' && args.title.trim() && args.title.length <= 120, '需要 1–120 字符工程名称');
    requireValue(checked.source.handlers.every(handler => target.manifest.content.svl.events.includes(handler.event.type)), '目标不能直接表达此 SVL 事件；请先修订源或选择其他目标');
    const parameterMap = parameterMapping(checked.source, args.parameter_map);
    requireValue(args.files && typeof args.files === 'object' && !Array.isArray(args.files), '需要 MQL5 源文件');
    const mapping = validateMapping(checked.source, args.files, args.source_map);
    requireValue(!Object.hasOwn(args.files, 'strategy.json') && !Object.hasOwn(args.files, 'observability/rules.json'), 'SVL 翻译无需旧工程语言声明或手写规则图');
    const generatedGraph = graph(checked.source), rules = { label: args.title, nodes: checked.source.nodes.map(node => ({ id: node.id, kind: node.op.startsWith('order.') || node.op === 'state.set' ? 'action' : node.op.startsWith('compare.') || node.op.startsWith('logic.') ? 'condition' : 'compute', label: node.id, operator: node.op, config: { source: args.source, instrumentation: mapping.find(entry => entry.nodeId === node.id).instrumentation } })),
      edges: generatedGraph.edges.map((edge, i) => ({ id: `edge.${i}`, source_node_id: edge.from, target_node_id: edge.to, input_name: `input.${i}` })), state_machines: [] };
    requireValue(rules.nodes.length > 0, 'MT5 翻译至少需要一个 SVL 节点');
    const source = projectFiles({ ...args.files, 'observability/rules.json': JSON.stringify(rules) });
    const adaptations = args.adaptations ?? [];
    for (const item of adaptations) {
      requireValue(typeof item.code === 'string' && typeof item.description === 'string' && item.description.trim() && ['equivalent', 'limited', 'unsupported'].includes(item.status) && Array.isArray(item.nodes) && item.nodes.every(id => checked.source.nodes.some(node => node.id === id)) && Array.isArray(item.evidence), '翻译适配声明无效');
      for (const ref of item.evidence) host.artifacts.read(ref);
    }
    requireValue(!adaptations.some(item => item.status === 'unsupported'), '翻译含无法实现的节点；先修订源，不能忽略规则');
    const numericNodes = checked.source.nodes.filter(node => /^(math|series|compare|order)\./.test(node.op)).map(node => node.id);
    const declared = [...adaptations, ...(numericNodes.length ? [{ code: 'MQL5_BINARY64', nodes: numericNodes, status: 'limited', description: limitations[0], evidence: [] }] : [])];
    const start = host.storage.idempotent(`translation-start-${operation}`, valueDigest(args), () => ({ timestamp: Date.now(), projectId: id('project'), created: now() }));
    const timestamp = start.timestamp, environment = publish(host, `${operation}-environment`, 'environment', { profile: args.target, plugin: host.plugin, observedAt: timestamp, platform: process.platform,
      runtime: { name: 'MetaTrader 5', version: 'not_observed', digest: unknown('Native execution version is verified by the actual compiler/tester, not assumed at translation time') }, dependencies: [], capabilities: mt5.status().compile ? ['native.compile.available'] : [], evidence: [] }, [args.target]);
    const lock = publish(host, `${operation}-lock`, 'dependency-lock', { plugin: host.plugin, sdkVersion: SDK_VERSION, target: args.target, nativeStandardLibrary: unknown('Frozen by mt5_compile for each build') }, [args.target]);
    const blobs = Object.entries(source.files).map(([path, content]) => ({ path, mediaType: path.endsWith('.json') ? 'application/json' : 'text/plain', ...host.artifacts.blob(content) }));
    const codeDigest = valueDigest(blobs.map(({ path, digest, size }) => ({ path, digest, size })).sort((a, b) => a.path.localeCompare(b.path)));
    const translation = publish(host, `${operation}-translation`, 'strategy.translation', { schemaVersion: '1.0.0', source: args.source, sourceDigest: checked.sourceDigest, target: args.target, plugin: host.plugin, environment,
      mode: args.mode, entryPath: 'Experts/Strategy.mq5', codeDigest, dependencyLock: lock, build: unknown('Not compiled'), sourceMap: mapping, nativeParameterMap: parameterMap, adaptations: declared, producer: { kind: 'agent', reference: host.scope.conversationId }, limitations }, [args.source, args.target, environment, lock], blobs);
    const validation = publish(host, `${operation}-validation`, 'strategy.validation', { schemaVersion: '1.0.0', source: args.source, translation, layer: 'target', validator: { id: 'sesame.mt5.mapping', version: '1.0.0', digest: host.plugin.digest ? value(host.plugin.digest) : unknown('Package digest unavailable') }, issuer: 'plugin', fixtures: [], parameters: null, environment, startedAt: timestamp, finishedAt: timestamp, outcome: 'partial',
      cases: [{ id: 'source-identity-and-map-bounds', outcome: 'passed', evidence: [translation], diagnostics: [] }, { id: 'native-semantic-equivalence', outcome: 'not_run', evidence: [], diagnostics: [] }], coverage: { nodes: mapping.map(entry => entry.nodeId), events: [], scenarios: ['artifact identity and source map structure'] }, tolerancePolicy: null, limitations }, [args.source, translation, environment]);
    const key = start.projectId, created = start.created;
    host.storage.transaction(() => {
      host.storage.put('mt5_revision', { id: `${key}:1`, project_id: key, revision: 1, ...source, svl_source: args.source, source_semantic_digest: checked.sourceDigest, translation, translation_validation: validation, created_at: created });
      host.storage.put('mt5_project', { id: key, version: 1, title: args.title.trim(), revision: 1, source_digest: source.source_digest, sdk_version: SDK_VERSION, translation, translation_mode: args.mode, test_risk_limits: { ...DEFAULT_RISK_LIMITS }, created_at: created, updated_at: created });
    });
    return { project_id: key, revision: 1, source: args.source, translation, validation, implementation: 'translated_unverified', limitations };
  });
}
