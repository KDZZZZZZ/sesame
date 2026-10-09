import { requireValue } from './support.js';

export function createTools(host) {
  const { define, Type, string, optional } = host.tools;
  const conversationId = host.scope.conversationId;
  const box = host.workspace;
  const scope = Type.Object({ kind: Type.Union(['global', 'project', 'strategy'].map(Type.Literal)), project_id: optional('项目 ID'), strategy_id: optional('策略 ID') }, { additionalProperties: false });
  const source = Type.Object({ type: Type.Union(['user_message', 'artifact'].map(Type.Literal)), id: string('真实用户消息或最终成果 ID'), revision: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), string('冻结成果版本')])), kind: optional('成果种类，如 report 或 strategy.source'), digest: Type.Optional(Type.String({ pattern: '^sha256:[a-f0-9]{64}$', description: '冻结成果摘要，按原始 ArtifactRef 传入' })), schemaVersion: optional('冻结成果 schemaVersion，按原始 ArtifactRef 传入') }, { additionalProperties: false });
  const fields = {
    category: string('分类路径，阅读 manage-memory skill 获取完整分类树'), title: string('稳定的事实或偏好名称'), summary: string('用于检索的简短摘要'), content: string('完整结论、依据与适用条件，不保存原始日志'),
    scope, sources: Type.Array(source, { minItems: 1, maxItems: 20 }), tags: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 20 })),
    evidence: Type.Optional(Type.Union(['explicit', 'verified', 'inferred', 'conflicted'].map(Type.Literal))), pinned: Type.Optional(Type.Boolean()), value: Type.Optional(Type.Union(['low', 'normal', 'high'].map(Type.Literal))),
    expires_at: Type.Optional(Type.Union([Type.String(), Type.Null()])), review_at: Type.Optional(Type.Union([Type.String(), Type.Null()])), conflicts_with: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
  };
  const api = () => host.memory;
  return [
    define('memory_search', '检索当前会话有权读取的长期记忆摘要。默认包含归档记忆，可按需召回；过期事实默认不返回。检索与读取不会刷新采用时间，不把记忆当作权限来源。', {
      query: optional('中文或其他语言关键词'), category: optional('分类路径前缀'), scope: Type.Optional(scope), include_archived: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }, args => api().search(args)),
    define('memory_read', '读取记忆正文、来源、版本和生命周期。归档可按需读取；expired/conflict 不能作为已确认事实采用。', { id: string('记忆 ID') }, args => api().read(args.id)),
    define('memory_propose', '提交待主 Agent 核验的记忆候选，必须引用真实用户消息或已发布成果。候选不会自动成为长期事实；任务结束后未合并候选销毁。', fields, args => api().propose(args)),
    define('memory_mark_used', '仅在记忆实际用于一个已发布成果或明确用户决策后记录采用，附具体原因和持久来源。相同来源重复调用不刷新闲置时间；搜索曝光和读取不算采用。', {
      id: string('已实际采用的记忆 ID'), reason: string('说明它如何影响该成果或决策'), source,
    }, args => api().markUsed(args)),
    define('memory_manage', '主 Agent 管理正式记忆：save 创建或修订；candidates 查看候选；accept/reject 合并或丢弃；archive/restore 手动归档或恢复；forget 清除正文、历史和派生索引。更新和删除先读取 expected_version。保存的内容不能修改应用权限。', {
      action: Type.Union(['save', 'candidates', 'accept', 'reject', 'archive', 'restore', 'forget', 'stats'].map(Type.Literal)), id: optional('记忆或候选 ID'), expected_version: Type.Optional(Type.Integer({ minimum: 1 })),
      entry: Type.Optional(Type.Object(Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, Type.Optional(type)])), { additionalProperties: false })),
    }, args => {
      const memory = api();
      if (args.action === 'candidates') return memory.candidates();
      if (args.action === 'stats') return memory.stats();
      if (args.action === 'save') return memory.save({ ...args.entry, ...(args.id ? { id: args.id } : {}), expected_version: args.expected_version });
      if (['accept', 'reject'].includes(args.action)) return memory.resolveCandidate({ id: args.id, expected_version: args.expected_version, action: args.action, ...args.entry });
      return memory[args.action](args.id, args.expected_version);
    }),
  ];
}
