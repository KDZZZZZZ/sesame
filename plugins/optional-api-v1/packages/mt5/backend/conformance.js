import { evaluateReplay } from '@sesame/plugin-sdk/svl';
import { canonical, digest, artifactRef, decimal } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { readSource } from './target.js';
import { translationBinding } from './parameters.js';
import { sourceNodes, sourceNodeKey, sourceRuleId } from './svl-capabilities.js';
import { frozenTimeline, readTimeline, TIMELINE_PATH, EXTERNAL_INPUT_FORMAT } from './external-inputs.js';
import { requireValue } from './support.js';

export const CONFORMANCE_FORMAT = 'sesame.svl.native-conformance/1';
const equal = (a, b) => canonical(a) === canonical(b);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed, label) => requireValue(object(value) && Object.keys(value).every(key => allowed.includes(key)), `${label} 有未知字段或不是对象`);
const frozen = value => { artifactRef(value); return value; };
const decode = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
const readJson = (host, artifact, path) => { const blob = artifact.manifest.blobs.find(blob => blob.path === path); requireValue(blob && blob.size <= 8 * 1024 * 1024, '固定 JSON 文件缺失或过大'); return decode(host.artifacts.readBlob(blob)); };
const publish = (host, operationId, kind, content, dependencies, files = {}) => host.artifacts.publish({ operationId, manifest: { kind, schemaVersion: '1.0.0', content, dependencies, blobs: Object.entries(files).map(([path, value]) => ({ path, mediaType: path.endsWith('.mqh') ? 'text/plain' : 'application/json', ...host.artifacts.blob(typeof value === 'string' ? value : JSON.stringify(value)) })) } });

function parameters(source, fixture) {
  return Object.fromEntries(Object.entries(source.parameters).map(([name, declaration]) => {
    let value = Object.hasOwn(fixture.parameters ?? {}, name) ? fixture.parameters[name] : declaration.default;
    if (typeof value === 'string' && ['money', 'quantity'].includes(declaration.type)) value = { value, ...(declaration.type === 'money' ? { currency: declaration.currency } : { unit: declaration.unit }) };
    return [name, value];
  }));
}

function tolerancePolicy(value = []) {
  requireValue(Array.isArray(value) && value.length <= 256, '公差必须是最多256项的固定JSON指针数组');
  const paths = new Set();
  for (const entry of value) {
    keys(entry, ['path', 'absolute', 'relative'], '公差');
    requireValue(typeof entry.path === 'string' && /^\/events\/\d+\/trace\/\d+\/value(?:\/[^/]*)*$/.test(entry.path) && !paths.has(entry.path), '公差只可精确指定计算 trace.value，不能放宽分支、状态、订单或身份');
    paths.add(entry.path);
    for (const key of ['absolute', 'relative']) { decimal(entry[key]); requireValue(entry[key].length <= 128 && Decimal.compare(entry[key], '0') >= 0, '公差必须是有界非负Decimal'); }
  }
  return structuredClone(value);
}

/** Shared JSON comparison contract: no target-specific casts, event sorting or
 * epsilon on order decisions. Backend adapters supply actual observed values. */
export function compareNativeReplay(expected, observed, policy = []) {
  const tolerances = new Map(tolerancePolicy(policy).map(value => [value.path, value])), used = new Set(), differences = [];
  const mismatch = (path, reason) => { if (differences.length < 100) differences.push({ path, reason }); };
  const visit = (a, b, path) => {
    if (tolerances.has(path)) {
      const tolerance = tolerances.get(path); used.add(path);
      try {
        decimal(a); decimal(b);
        const allowed = Decimal.compare(tolerance.absolute, Decimal.mul(tolerance.relative, Decimal.abs(a))) >= 0 ? tolerance.absolute : Decimal.mul(tolerance.relative, Decimal.abs(a));
        if (Decimal.compare(Decimal.abs(Decimal.sub(a, b)), allowed) > 0) mismatch(path, 'numeric_tolerance_exceeded');
      } catch { mismatch(path, 'tolerance_requires_decimal_strings'); }
      return;
    }
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) { mismatch(path, 'array_length_or_type'); return; }
      a.forEach((value, index) => visit(value, b[index], `${path}/${index}`)); return;
    }
    if (object(a)) {
      if (!object(b) || !equal(Object.keys(a).sort(), Object.keys(b).sort())) { mismatch(path, 'object_keys_or_type'); return; }
      for (const [key, value] of Object.entries(a)) visit(value, b[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
      return;
    }
    if (a !== b) mismatch(path, 'exact_value_mismatch');
  };
  visit(expected, observed, '');
  for (const path of tolerances.keys()) if (!used.has(path)) mismatch(path, 'tolerance_path_not_observed');
  return { matched: differences.length === 0, differences, tolerancePolicy: [...tolerances.values()] };
}

export async function prepareConformance(host, args, signal) {
  frozen(args.source); const checked = readSource(host, args.source);
  const bytes = await host.workspace.file('read', args.fixture_path, undefined, signal);
  requireValue(bytes.length <= 4 * 1024 * 1024, '回放 fixture 超过4MiB');
  const fixture = decode(bytes);
  requireValue(object(fixture) && typeof fixture.runId === 'string' && fixture.runId.length > 0 && Array.isArray(fixture.events) && fixture.events.length > 0, '对照需要固定runId和非空事件序列');
  keys(fixture, ['runId', 'parameters', 'initialState', 'events'], 'fixture');
  const expected = evaluateReplay(checked.source, fixture), policy = tolerancePolicy(args.tolerances ?? []);
  requireValue(compareNativeReplay(expected, expected, policy).matched, '公差路径必须实际指向参考结果中的Decimal计算值');
  const fixedParameters = parameters(checked.source, fixture);
  const body = { format: CONFORMANCE_FORMAT, source: args.source, sourceDigest: checked.sourceDigest, languageVersion: checked.source.schemaVersion, runId: fixture.runId, inputDigest: digest(fixture.events), parametersDigest: digest(fixedParameters), fixture, tolerances: policy };
  const external = checked.source.handlers.some(handler => handler.event.type === 'external.input');
  const timeline = external ? frozenTimeline(fixture.events) : null;
  const timelineInfo = timeline ? readTimeline(timeline) : null;
  const fixtureDigest = digest(body), header = `#ifndef PRODUCT_SVL_FIXTURE_MQH\n#define PRODUCT_SVL_FIXTURE_MQH\n#define PRODUCT_SVL_FIXTURE_DIGEST "${fixtureDigest}"\n#define PRODUCT_SVL_SOURCE_DIGEST "${checked.sourceDigest}"\n#define PRODUCT_SVL_PARAMETERS_DIGEST "${body.parametersDigest}"\n#endif\n`;
  const content = { ...body, fixtureDigest, fixturePath: 'fixture.json', referencePath: 'reference.json', referenceDigest: digest(expected), validationScope: 'reference-only', nativeEngineExecuted: false };
  // Large fixtures are blobs, never duplicated into the small artifact manifest.
  delete content.fixture;
  signal?.throwIfAborted();
  const ref = publish(host, args.operation_id, 'resource', content, [args.source], { 'fixture.json': fixture, 'reference.json': expected, 'ConformanceFixture.mqh': header, ...(timeline ? { [TIMELINE_PATH]: timeline } : {}) });
  const bridgeConfiguration = timeline ? publish(host, `${args.operation_id}-external-input`, 'resource', { format: EXTERNAL_INPUT_FORMAT, mode: 'frozen-timeline', clock: 'utc', availability: 'availableAt-and-expiry', failurePolicy: 'halt_new_risk', transport: { path: TIMELINE_PATH, digest: timelineInfo.digest } }, [ref]) : null;
  if (args.timeline_path) { requireValue(timeline, 'timeline_path仅用于external.input源'); await host.workspace.file('write', args.timeline_path, timeline, signal); }
  if (args.header_path) await host.workspace.file('write', args.header_path, header, signal);
  return { fixture: ref, fixtureDigest, ...(timeline ? { bridgeConfiguration, timelineDigest: timelineInfo.digest, timelinePath: TIMELINE_PATH } : {}), referenceDigest: content.referenceDigest, events: expected.events.length, status: expected.status, validationScope: 'reference-only', nativeEngineExecuted: false, ...(args.header_path ? { header_path: args.header_path } : {}) };
}

function readFixture(host, ref) {
  const artifact = host.artifacts.read(frozen(ref)), content = artifact.manifest.content;
  requireValue(ref.kind === 'resource' && artifact.producer.id === host.plugin.id && content.format === CONFORMANCE_FORMAT, '需要本插件固定的conformance fixture');
  const fixture = readJson(host, artifact, content.fixturePath), checked = readSource(host, content.source);
  requireValue(checked.sourceDigest === content.sourceDigest, 'fixture源身份已改变');
  const body = { format: content.format, source: content.source, sourceDigest: content.sourceDigest, languageVersion: content.languageVersion, runId: content.runId, inputDigest: content.inputDigest, parametersDigest: content.parametersDigest, fixture, tolerances: content.tolerances };
  requireValue(digest(body) === content.fixtureDigest && digest(fixture.events) === content.inputDigest, 'fixture内容摘要不匹配');
  const expected = evaluateReplay(checked.source, fixture);
  requireValue(digest(expected) === content.referenceDigest && digest(readJson(host, artifact, content.referencePath)) === content.referenceDigest, '参考解释器结果已改变；重新冻结并运行测试');
  return { content, fixture, expected, source: checked.source };
}

function nativeTrace(host, mt5, translationRef, resultRef) {
  const translation = host.artifacts.read(frozen(translationRef)), result = host.artifacts.read(frozen(resultRef)), body = result.manifest.content;
  requireValue(translationRef.kind === 'strategy.translation' && resultRef.kind === 'strategy.result' && [translation, result].every(value => value.producer.id === host.plugin.id), '只接受MT5插件产生的冻结翻译和实际Tester结果');
  requireValue(body.status === 'completed' && equal(body.translation, translationRef) && equal(body.source, translation.manifest.content.source), '原生结果不属于此翻译或源');
  const pass = mt5.storage.get('mt5_pass', body.nativePassId), build = mt5.storage.get('mt5_build', pass.build_id), revision = mt5.storage.get('mt5_revision', `${build.project_id}:${build.revision}`);
  requireValue(pass.status === 'succeeded' && build.status === 'succeeded' && equal(pass.result_artifact, resultRef) && equal(revision.translation, translationRef), '未找到已成功执行且属于此翻译的真实Tester账本', 422, 'NATIVE_EVIDENCE_REQUIRED');
  requireValue(body.buildId === build.id && body.codeDigest === build.ex5_sha256 && pass.artifact_digest === build.ex5_sha256 && !pass.trace_truncated, '原生构建身份不符或执行trace不完整', 422, 'NATIVE_EVIDENCE_REQUIRED');
  requireValue(build.execution?.backend === 'native' && pass.process_cleanup?.activeProcesses === 0, '缺少实际原生编译或已确认的Tester进程清理回执', 422, 'NATIVE_EVIDENCE_REQUIRED');
  requireValue(object(pass.actual_inputs) && Object.values(translation.manifest.content.nativeParameterMap).every(entry => !entry.nativeInput || Object.hasOwn(pass.actual_inputs, entry.nativeInput)), '必须读取实际Tester参数，不能用提交配置冒充');
  const raw = host.artifacts.read(frozen(body.rawResult)), summary = readJson(host, raw, 'result.json');
  requireValue(raw.producer.id === host.plugin.id && summary.completed === true && summary.build_id === build.id && summary.run_id === pass.id && summary.trace_truncated === false, '原生完成证据不匹配');
  requireValue(summary.metrics?.trade_count === 0 && Array.isArray(summary.deals) && summary.deals.every(row => ['DEAL_TYPE_BALANCE', 'DEAL_TYPE_CREDIT', 'balance', 'credit'].includes(row.type)), '语义fixture只能捕获意图，不能执行模拟或实盘订单');
  const rows = [], chunks = body.data?.filter(item => item.role === 'trace').sort((a, b) => a.offset - b.offset);
  requireValue(Array.isArray(chunks) && chunks.length > 0, '原生结果没有trace');
  for (const chunk of chunks) {
    requireValue(chunk.offset === rows.length, '原生trace分块缺失或重叠');
    const artifact = host.artifacts.read(frozen(chunk.ref)), data = artifact.manifest.content;
    requireValue(artifact.producer.id === host.plugin.id && chunk.ref.kind === 'data' && data.provenance?.kind === 'observed' && data.provenance.nativePassId === pass.id, 'trace不是此原生pass的观察数据');
    const values = readJson(host, artifact, data.path);
    requireValue(Array.isArray(values) && values.length === data.rowCount && rows.length + values.length <= 200000, '原生trace数量无效'); rows.push(...values);
  }
  requireValue(rows.every((row, i) => row.seq === i + 1 && row.build_id === build.id && typeof row.kind === 'string'), '原生trace顺序或构建身份不符');
  const actualParameters = Object.fromEntries(Object.entries(pass.actual_inputs).filter(([key]) => !key.startsWith('Product_')));
  return { translation: translation.manifest.content, body, pass, build, rows, binding: translationBinding(host, mt5, build.id, { ...pass.config, parameters: actualParameters }) };
}

export function verifyConformance(host, mt5, args) {
  const prepared = readFixture(host, args.fixture), native = nativeTrace(host, mt5, args.translation, args.result), { content, fixture, expected, source } = prepared;
  requireValue(equal(native.translation.source, content.source) && native.translation.sourceDigest === content.sourceDigest, 'fixture源与原生翻译不一致');
  requireValue(equal(native.binding.parameters, parameters(source, fixture)), '实际原生参数/账户/品种绑定与fixture不同');
  if (source.handlers.some(handler => handler.event.type === 'external.input')) {
    const expectedTimeline = readTimeline(frozenTimeline(fixture.events));
    const fixed = native.translation.admission?.externalInputs;
    requireValue(fixed?.mode === 'frozen-timeline' && fixed.timelineDigest === expectedTimeline.digest, '实际翻译外部输入与conformance fixture不同');
    const staged = native.pass.native_input_files?.find(item => item.path === TIMELINE_PATH);
    const observedFile = native.rows.filter(row => row.kind === 'external_input_file');
    requireValue(staged?.digest === expectedTimeline.digest && staged.rows === fixture.events.length && equal(staged.translation, args.translation) && observedFile.length === 1 && equal(observedFile[0].value, { digest: staged.digest, rows: staged.rows }), '缺少实际原生文件SHA256读取和固定timeline staging证据', 422, 'NATIVE_EVIDENCE_REQUIRED');
  }
  const rows = native.rows.filter(row => row.kind.startsWith('svl_'));
  requireValue(rows[0]?.kind === 'svl_begin' && rows.at(-1)?.kind === 'svl_end' && rows.filter(row => row.kind === 'svl_begin').length === 1 && rows.filter(row => row.kind === 'svl_end').length === 1, '原生fixture开始/结束证据缺失或重复', 422, 'NATIVE_EVIDENCE_REQUIRED');
  requireValue(equal(rows[0].value, { fixtureDigest: content.fixtureDigest, sourceDigest: content.sourceDigest, runId: content.runId, parametersDigest: content.parametersDigest }), '原生fixture身份或实际参数摘要不匹配');
  const events = [], inputs = []; let lastInput = -1;
  for (const row of rows.slice(1, -1)) {
    if (row.kind === 'svl_input') {
      const index = inputs.length, input = fixture.events[index];
      requireValue(input && equal(row.value, { index, eventId: input.eventId, digest: digest(input) }), '实际原生输入事件内容或顺序不同'); inputs.push(row.value); lastInput = index;
    } else if (row.kind === 'svl_event') {
      requireValue(lastInput >= 0 && row.value.eventId === fixture.events[lastInput].eventId, '原生事件结果缺少对应输入或顺序不符'); events.push(row.value);
    } else requireValue(false, '未知原生SVL telemetry kind');
  }
  requireValue(inputs.length === fixture.events.length && digest(fixture.events) === content.inputDigest, '原生输入未完整消费，不能声称通过');
  const end = rows.at(-1).value; keys(end, ['status', 'state'], '原生结束结果');
  const observed = { sourceDigest: content.sourceDigest, events, state: end.state, status: end.status };
  const comparison = compareNativeReplay(expected, observed, content.tolerances), allNodes = sourceNodes(source);
  const covered = new Set(observed.events.flatMap(event => (event.trace ?? []).map(sourceNodeKey)));
  const observable = allNodes.filter(node => covered.has(sourceNodeKey(node))), uncovered = allNodes.filter(node => !covered.has(sourceNodeKey(node)));
  const validationScope = 'fixed-fixture-native-observation', outcome = comparison.matched ? uncovered.length ? 'partial' : 'passed' : 'failed';
  requireValue(Number.isFinite(Date.parse(native.pass.created_at)) && Number.isFinite(Date.parse(native.pass.completed_at)) && Date.parse(native.pass.completed_at) >= Date.parse(native.pass.created_at), '原生执行时间回执无效');
  const limitations = ['A matching fixture proves only those actual native observations under the fixed tolerance; it is not universal translation equivalence or live execution certification.', 'Fixture execution captures intended requests, without a broker matching engine or trading side effects.', ...(uncovered.length ? ['Some source/function nodes were not observed by this fixture.'] : [])];
  const dependencies = [content.source, args.translation, args.fixture, args.result, native.translation.environment];
  const evidence = publish(host, args.operation_id, 'strategy.validation', { schemaVersion: '1.0.0', source: content.source, translation: args.translation, layer: 'target', validator: { id: 'sesame.mt5.native-conformance', version: '1.0.0', digest: host.plugin.digest ? { status: 'value', value: host.plugin.digest } : { status: 'unknown', reason: 'Package digest unavailable' } }, issuer: 'plugin', fixtures: [args.fixture], parameters: native.binding.parameters, environment: native.translation.environment, startedAt: Date.parse(native.pass.created_at), finishedAt: Date.parse(native.pass.completed_at), outcome,
    cases: [{ id: content.fixtureDigest, outcome: comparison.matched ? 'passed' : 'failed', evidence: [args.result], diagnostics: comparison.differences }], coverage: { nodes: observable.map(sourceRuleId), events: fixture.events.map(value => value.type), scenarios: [content.runId], uncovered: uncovered.map(sourceRuleId) }, tolerancePolicy: content.tolerances, validationScope, nativeEngineExecuted: true, generalEquivalence: 'not_proven', nativePassId: native.pass.id, buildId: native.build.id, fixtureDigest: content.fixtureDigest, nativeObservationDigest: digest(observed), limitations }, dependencies, { 'comparison.json': comparison, 'observed.json': observed });
  return { validation: evidence, outcome, validationScope, nativeEngineExecuted: true, generalEquivalence: 'not_proven', differences: comparison.differences, covered: observable.length, uncovered: uncovered.map(sourceRuleId), limitations };
}
