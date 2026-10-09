import { requireValue } from '../../store.js';

export function createTools({ runtime, conversationId, store, box, define, string, optional, Type }) {
  return [
    define('agent_delegate', '委派研究或策略任务，返回会话和独立 Run；子任务异步执行，最终成果封存后销毁临时区。继续已结束会话时创建新的 Run。', {
      kind: Type.Union([Type.Literal('research'), Type.Literal('strategy')]), title: string('任务标题'), task: string('具体要求与数据/报告引用'), conversation_id: optional('继续已有直属子会话'),
      memory_scopes: Type.Optional(Type.Array(Type.Object({ kind: Type.Union([Type.Literal('project'), Type.Literal('strategy')]), project_id: string('项目 ID'), strategy_id: optional('策略范围时必填') }, { additionalProperties: false }), { maxItems: 32, description: '明确授予任务需要的项目/策略记忆范围；下级不能扩大上级已有范围' })),
    }, args => runtime.delegate(conversationId, args)),
    define('agent_inspect', '读取子任务进度、最终摘要与成果引用；不复制子任务过程对话。wait=true 最多等待 20 秒。', { conversation_id: string('会话 ID'), wait: Type.Optional(Type.Boolean()) }, async (args, signal) => {
      const child = store.get('conversation', args.conversation_id);
      requireValue(child.parent_conversation_id === conversationId || store.get('conversation', conversationId).scope === 'main', '只能读取自己的任务');
      if (args.wait) await runtime.wait(args.conversation_id, signal);
      const run = runtime.workspaces.current(args.conversation_id);
      return { conversation: store.get('conversation', args.conversation_id), run: runtime.run(args.conversation_id), summary: run?.summary ?? null, memory_hint: run?.cleanup_state === 'cleaned' ? '如需长期保留经验，请从最终成果提炼记忆；过程和未合并候选已销毁。' : null,
        artifacts: (run?.final_artifact_ids ?? []).map(key => store.get('artifact', key)) };
    }),
    define('agent_finish', '提交子任务最终摘要并结束当前 Run。必须是最后一个工具调用；宿主在本轮回复结束、所有下级任务停止后封存成果并销毁全部过程。等待输入时不要调用。主 Agent 可结束已空闲的直属子任务。', {
      summary: string('最终结果、关键结论与局限；不会保留过程对话'), status: Type.Optional(Type.Union(['succeeded', 'failed', 'canceled'].map(Type.Literal))),
      artifact_ids: Type.Optional(Type.Array(string('需要保留的策略工程 ID'), { maxItems: 64 })), conversation_id: optional('默认当前子任务；主 Agent 可指定直属子任务'),
    }, args => {
      const target = args.conversation_id ?? conversationId, child = store.get('conversation', target);
      requireValue(child.scope === 'subagent' && (target === conversationId || child.parent_conversation_id === conversationId), '只能结束当前或直属子任务', 403);
      requireValue(target === conversationId || !child.active_response_message_id, '请等待直属子任务本轮回复结束后再封存', 409);
      return runtime.requestFinish(target, args);
    }),
  ];
}
