import { evaluateReplay, validateSource } from '@sesame/plugin-sdk/svl';
import { sourceIdentity, accountIdentity, nativeTimeframe } from './contract-mapping.js';
import { requireValue } from './support.js';
import { assertTargetCapabilities } from './svl-capabilities.js';
import { canonical } from '@sesame/plugin-sdk/protocol';

export function parameterMapping(source, mapping) {
  requireValue(mapping && typeof mapping === 'object' && !Array.isArray(mapping), '需要明确的 parameter_map');
  requireValue(Object.keys(mapping).length === Object.keys(source.parameters).length && Object.keys(mapping).every(name => Object.hasOwn(source.parameters, name)), 'parameter_map 必须覆盖所有 SVL 参数');
  const inputs = new Set();
  for (const [name, parameter] of Object.entries(source.parameters)) {
    const entry = mapping[name];
    if (parameter.type === 'instrument' || parameter.type === 'account') requireValue(entry?.binding === parameter.type && Object.keys(entry).length === 1, `参数 ${name} 需要 ${parameter.type} 绑定`);
    else {
      const structured = ['record', 'array', 'series', 'timestamp', 'price'].includes(parameter.type);
      requireValue(structured ? entry?.encoding === 'json' : ['boolean', 'integer', 'duration', 'decimal', 'quantity', 'money', 'string', 'enum'].includes(parameter.type) && entry?.encoding === undefined, `参数 ${name} 的结构化类型需要 encoding:json，标量不使用 JSON 编码`, 422, 'UNSUPPORTED_CAPABILITY');
      requireValue(parameter.type !== 'quantity' || parameter.unit === 'lot', 'MT5 原生数量以 lot 表示；先在 SVL 显式定义单位换算', 422, 'UNSUPPORTED_CAPABILITY');
      requireValue(typeof entry?.nativeInput === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(entry.nativeInput) && !entry.nativeInput.startsWith('Product_') && Object.keys(entry).every(key => ['nativeInput', 'encoding'].includes(key)) && !inputs.has(entry.nativeInput), `参数 ${name} 的 MQL5 input 映射无效或重复`);
      inputs.add(entry.nativeInput);
    }
  }
  return structuredClone(mapping);
}

export function nativeParameterValue(declaration, value) {
  if (value && typeof value === 'object') {
    requireValue(!Array.isArray(value) && ['quantity', 'money'].includes(declaration.type) && Object.hasOwn(value, 'value'), '原生参数包装类型无效');
    requireValue(declaration.type === 'quantity' ? value.unit === declaration.unit : value.currency === declaration.currency, '原生参数单位或货币与 SVL 声明不一致');
  }
  const scalar = value && typeof value === 'object' ? value.value : value;
  if (['integer', 'duration'].includes(declaration.type)) {
    requireValue(typeof scalar === 'number' || typeof scalar === 'string' && /^[+-]?\d+$/.test(scalar), '原生 integer 参数必须是整数');
    const integer = typeof scalar === 'string' ? Number(scalar) : scalar;
    requireValue(Number.isSafeInteger(integer) && (declaration.type !== 'duration' || integer >= 0), '原生 integer/duration 参数超出安全整数范围'); return integer;
  }
  if (declaration.type === 'boolean') {
    if (scalar === true || scalar === 'true' || scalar === 1 || scalar === '1') return true;
    if (scalar === false || scalar === 'false' || scalar === 0 || scalar === '0') return false;
    requireValue(false, '原生 boolean 参数必须是 true/false 或 1/0');
  }
  return scalar;
}

export function translationBinding(host, mt5, buildId, config) {
  const build = mt5.storage.get('mt5_build', buildId), revision = mt5.storage.get('mt5_revision', `${build.project_id}:${build.revision}`);
  if (!revision.translation) return null;
  const translation = host.artifacts.read(revision.translation).manifest.content, artifact = host.artifacts.read(translation.source), blob = artifact.manifest.blobs.find(blob => blob.path === artifact.manifest.content.sourcePath);
  const { source } = validateSource(host.artifacts.readBlob(blob).toString('utf8'));
  const target = host.artifacts.read(translation.target).manifest.content;
  assertTargetCapabilities(source, target);
  const mapping = parameterMapping(source, translation.nativeParameterMap), account = mt5.official.config.account, native = { ...(config.parameters ?? {}) }, parameters = {};
  const instrument = { sourceId: sourceIdentity(account.server), instrumentId: config.symbol };
  for (const [name, declaration] of Object.entries(source.parameters)) {
    const entry = mapping[name];
    if (entry.binding === 'instrument') parameters[name] = instrument;
    else if (entry.binding === 'account') parameters[name] = { connectionId: 'mt5-terminal', accountId: accountIdentity(account.server, account.login) };
    else {
      const value = Object.hasOwn(native, entry.nativeInput) ? native[entry.nativeInput] : declaration.default;
      requireValue(value !== undefined, `需要显式提供 MQL5 参数 ${entry.nativeInput}`);
      if (entry.encoding === 'json') {
        let structured = value;
        if (Object.hasOwn(native, entry.nativeInput)) { requireValue(typeof value === 'string' && Buffer.byteLength(value) <= 1048576, '原生 JSON 参数必须是有限 JSON 字符串'); try { structured = JSON.parse(value); } catch { requireValue(false, `MQL5 JSON 参数 ${entry.nativeInput} 无效`); } }
        parameters[name] = structured; native[entry.nativeInput] = canonical(structured); continue;
      }
      const scalar = nativeParameterValue(declaration, value);
      native[entry.nativeInput] = scalar;
      parameters[name] = declaration.type === 'quantity' ? { value: String(scalar), unit: declaration.unit } : declaration.type === 'money' ? { value: String(scalar), currency: declaration.currency } : scalar;
    }
  }
  for (const input of Object.values(source.inputs)) if (input.kind === 'bars') requireValue(nativeTimeframe(input.timeframe) === config.period, '此 MT5 profile 仅支持同一原生图表周期；不能隐式改变 SVL 输入周期', 422, 'UNSUPPORTED_CAPABILITY');
  // Reuse source type/constraint validation; no event is evaluated and this is
  // explicitly not native execution or target equivalence validation.
  evaluateReplay(source, { parameters, events: [] });
  return { translation: revision.translation, source: translation.source, target: translation.target, validation: revision.translation_validation ?? null, environment: translation.environment, parameters, native, inputs: source.inputs, instrument };
}
