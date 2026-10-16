import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { requireValue } from './support.js';

export const MAX_TRANSLATION_MANIFEST_BYTES = 8 * 1024 * 1024;
const text = description => Type.String({ description, minLength: 1, maxLength: 20000 });
const ref = Type.Object({ id: text('成果 ID'), revision: text('固定修订'), digest: text('sha256 摘要'), kind: text('成果类型'), schemaVersion: Type.Literal('1.0.0') }, { additionalProperties: false });
export const operationId = Type.String({ pattern: '^[A-Za-z0-9_-]{16,128}$', minLength: 16, maxLength: 128 });

// Both entry points use this exact schema before registration. The file format
// embeds file contents; it does not introduce another file-discovery protocol.
export const translationManifestProperties = {
  title: Type.String({ description: '工程名称', minLength: 1, maxLength: 120 }), source: ref, target: ref,
  mode: Type.Union(['backtest', 'live'].map(Type.Literal)),
  parameter_map: Type.Record(Type.String(), Type.Union([
    Type.Object({ nativeInput: text('实际 MQL5 input 参数名') }, { additionalProperties: false }),
    Type.Object({ binding: Type.Union(['instrument', 'account'].map(Type.Literal)) }, { additionalProperties: false }),
  ])),
  files: Type.Record(Type.String(), Type.String({ maxLength: 1048576 }), { minProperties: 1, maxProperties: 128 }),
  source_map: Type.Array(Type.Object({
    nodeId: text('实际 SVL 节点 ID'),
    generated: Type.Array(Type.Object({ path: text('实际相对路径'), startLine: Type.Integer({ minimum: 1 }), endLine: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })),
    instrumentation: Type.Union(['direct', 'inlined', 'boundary', 'unobservable'].map(Type.Literal)), reason: Type.Optional(text('不可观测原因')),
  }, { additionalProperties: false }), { maxItems: 1000 }),
  adaptations: Type.Array(Type.Object({ code: text('适配代码'), nodes: Type.Array(text('实际源节点 ID')), status: Type.Union(['equivalent', 'limited', 'unsupported'].map(Type.Literal)), description: text('具体语义差异及限制'), evidence: Type.Array(ref) }, { additionalProperties: false }), { maxItems: 1000 }),
};
export const translationProperties = { operation_id: operationId, ...translationManifestProperties };
export const translationManifestSchema = Type.Object(translationManifestProperties, { additionalProperties: false });
export const translationSchema = Type.Object(translationProperties, { additionalProperties: false });
export const translationFileProperties = {
  operation_id: operationId,
  manifest_path: Type.String({ description: '当前工作区内的 JSON 清单路径；重试使用相同操作 ID 和路径，读取已固定快照', minLength: 1, maxLength: 4096 }),
};
export const translationFileSchema = Type.Object(translationFileProperties, { additionalProperties: false });

export function normalizeTranslation(value, withOperation = true) {
  requireValue(Value.Check(withOperation ? translationSchema : translationManifestSchema, value), '翻译参数不符合 mt5_translation 的严格 schema；文件清单不含 operation_id，且不接受额外字段');
  const { operation_id: _operation, ...body } = value;
  requireValue(Buffer.byteLength(JSON.stringify(body)) <= MAX_TRANSLATION_MANIFEST_BYTES, '翻译清单超过 8 MiB 上限');
  requireValue(value.title.trim(), '工程名称不能只有空白');
  // Preserve the existing inline fingerprint, including source text and title
  // whitespace. Project registration alone trims its display title.
  return structuredClone(value);
}
