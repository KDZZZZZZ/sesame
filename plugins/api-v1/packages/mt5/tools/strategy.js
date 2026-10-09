import { targetProfile, registerTranslation } from '../backend/target.js';
export function createTools(host, mt5) {
  const { define, Type, string } = host.tools;
  const ref = Type.Object({ id: string('成果 ID'), revision: string('固定修订'), digest: string('sha256 摘要'), kind: string('成果类型'), schemaVersion: Type.Literal('1.0.0') }, { additionalProperties: false });
  return [
    define('mt5_target', '读取并冻结 MQL5 目标 profile、数值/事件/恢复限制及包内翻译说明。先保存 SVL 并由宿主从源生成图，再依目标翻译；本工具不编译、不回测、不交易。', {}, () => targetProfile(host)),
    define('mt5_translation', '将 Agent 按冻结 SVL 源编写的 MQL5 文件、逐节点 source_map 与适配说明登记为翻译成果和独立 MT5 工程。只检查身份与映射结构；结果 partial，不证明原生语义等价。逻辑变化先修 SVL，再创建新翻译。', {
      operation_id: Type.String({ pattern: '^[A-Za-z0-9_-]{16,128}$' }), title: string('工程名称'), source: ref, target: ref, mode: Type.Union(['backtest', 'live'].map(Type.Literal)),
      parameter_map: Type.Record(Type.String(), Type.Union([Type.Object({ nativeInput: string('实际 MQL5 input 参数名') }, { additionalProperties: false }), Type.Object({ binding: Type.Union(['instrument', 'account'].map(Type.Literal)) }, { additionalProperties: false })])),
      files: Type.Record(Type.String(), Type.String({ maxLength: 1048576 }), { maxProperties: 128 }),
      source_map: Type.Array(Type.Object({ nodeId: string('实际 SVL 节点 ID'), generated: Type.Array(Type.Object({ path: string('实际相对路径'), startLine: Type.Integer({ minimum: 1 }), endLine: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })), instrumentation: Type.Union(['direct', 'inlined', 'boundary', 'unobservable'].map(Type.Literal)), reason: Type.Optional(string('不可观测原因')) }, { additionalProperties: false }), { maxItems: 1000 }),
      adaptations: Type.Array(Type.Object({ code: string('适配代码'), nodes: Type.Array(string('实际源节点 ID')), status: Type.Union(['equivalent', 'limited', 'unsupported'].map(Type.Literal)), description: string('具体语义差异及限制'), evidence: Type.Array(ref) }, { additionalProperties: false }), { maxItems: 1000 }),
    }, args => registerTranslation(host, mt5, args)),
  ];
}
