export function createTools(host) {
  const { define, Type, string, optional } = host.tools;
  const conversationId = host.scope.conversationId;
  const box = host.workspace;
  return [
    define('agent_delegate', '委派研究或策略任务，返回会话和独立 Run；子任务异步执行，最终成果封存后销毁临时区。继续已结束会话时创建新的 Run。', {
      kind: Type.Union([Type.Literal('research'), Type.Literal('strategy')]), title: string('任务标题'), task: string('具体要求与数据/报告引用'), conversation_id: optional('继续已有直属子会话'),
      memory_scopes: Type.Optional(Type.Array(Type.Object({ kind: Type.Union([Type.Literal('project'), Type.Literal('strategy')]), project_id: string('项目 ID'), strategy_id: optional('策略范围时必填') }, { additionalProperties: false }), { maxItems: 32, description: '明确授予任务需要的项目/策略记忆范围；下级不能扩大上级已有范围' })),
    }, args => host.tasks.delegate(args)),
    define('agent_inspect', '读取子任务进度、最终摘要与成果引用；不复制子任务过程对话。wait=true 最多等待 20 秒。', { conversation_id: string('会话 ID'), wait: Type.Optional(Type.Boolean()) }, (args, signal) => host.tasks.inspect(args, signal)),
    define('agent_finish', '提交子任务最终摘要并结束当前 Run。必须是最后一个工具调用；宿主在本轮回复结束、所有下级任务停止后封存成果并销毁全部过程。等待输入时不要调用。主 Agent 可结束已空闲的直属子任务。', {
      summary: string('最终结果、关键结论与局限；不会保留过程对话'), status: Type.Optional(Type.Union(['succeeded', 'failed', 'canceled'].map(Type.Literal))),
      artifact_ids: Type.Optional(Type.Array(string('需要保留的策略工程 ID'), { maxItems: 64 })), conversation_id: optional('默认当前子任务；主 Agent 可指定直属子任务'),
    }, args => host.tasks.finish(args)),
  ];
}
