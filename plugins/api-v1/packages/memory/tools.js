async function memoryCall(host, action, args, execute) {
  try { return await execute(); }
  catch (error) {
    const candidate = ['accept', 'reject'].includes(action) || args.id?.startsWith('memcandidate_');
    const next = candidate
      ? host.scope.kind === 'main' ? { tool: 'memory_manage', arguments: { action: 'candidates' } } : { action: 'use_memory_propose_result', candidate_id: args.id }
      : { tool: 'memory_read', arguments: { id: args.id } };
    if (error.code === 'version_conflict') {
      let version;
      try { version = candidate ? host.memory.candidates().items.find(item => item.id === args.id)?.version : host.memory.read(args.id).version; }
      catch { /* A concurrently removed or inaccessible entry must not replace the original error. */ }
      error.details = { ...error.details, ...(version === undefined ? {} : { current_version: version }), next_action: next };
      error.message += `${version === undefined ? '' : `；当前版本 ${version}`}；先${candidate ? '用 memory_manage action=candidates 重新读取候选的 id/version' : '用 memory_read 重新读取正式记忆的 id/version'}，核对最新内容后再提交 expected_version，不能盲目重试旧版本。`;
    } else if (error.code === 'memory_not_found' && candidate && !['accept', 'reject'].includes(action)) {
      error.code = 'memory_candidate_id';
      error.details = { ...error.details, next_action: next };
      error.message = '这是候选 ID，不能作为正式记忆 ID 使用。候选正文见 memory_propose 返回值；主 Agent 用 memory_manage action=candidates 核验。accept 返回的顶层 id 仍是候选 ID，正式记忆用 memory.id；候选不在列表可能已处理、过期或随任务清理，不要猜测替代 ID。';
    } else if (error.code === 'memory_candidate_expired') {
      error.details = { ...error.details, next_action: next };
      error.message += '；不要改版本强行接纳。重新读取最终成果并核验后才重新提取候选，来源不可用则保留未确认状态。';
    }
    throw error;
  }
}

export function createTools(host) {
  const { define, Type, string, optional } = host.tools;
  const conversationId = host.scope.conversationId;
  const scope = Type.Object({ kind: Type.Union(['global', 'project', 'strategy'].map(Type.Literal)), project_id: optional('项目 ID'), strategy_id: optional('策略 ID') }, { additionalProperties: false });
  const source = Type.Union([
    Type.Object({ type: Type.Literal('user_message'), id: string('真实用户消息 ID；不能使用委派消息或成果 ID') }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal('artifact'), id: string('原 ArtifactRef.id'), revision: string('原 ArtifactRef.revision 字符串，不转成整数'), kind: string('原 ArtifactRef.kind'),
      digest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$', description: '原 ArtifactRef.digest' }), schemaVersion: string('原 ArtifactRef.schemaVersion') }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal('artifact'), id: string('旧报告或已封存成果 ID；只适用于宿主返回的旧引用'), revision: Type.Optional(Type.Integer({ minimum: 1 })), kind: optional('旧成果种类') }, { additionalProperties: false }),
  ], { description: '来源必须有 type。冻结成果使用 {type:"artifact",...完整 ArtifactRef}；用户表达使用 {type:"user_message",id:"真实消息ID"}。不能只复制 ref 而省略 type，也不能改写来源类别。' });
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
    define('memory_read', '读取正式记忆正文、来源、版本和生命周期。id 来自 memory_search、save 或 accept 的 memory.id，不能使用 memory_propose 的候选 ID。候选由主 Agent 用 memory_manage action=candidates 查看；expired/conflict 不能当作已确认事实。', { id: string('正式记忆 ID；accept 返回 memory.id，顶层 id 仍是候选') }, args => memoryCall(host, 'read', args, () => api().read(args.id))),
    define('memory_propose', '提交待主 Agent 核验的候选，来源必须包含 type；冻结成果用 {type:"artifact",...完整 ArtifactRef}。返回的 id/version 属于候选，主 Agent 接纳时原样使用；候选不能用 memory_read 读取，不自动成为长期事实，任务结束后未合并候选销毁。', fields, args => api().propose(args)),
    define('memory_mark_used', '仅在记忆实际用于一个已发布成果或明确用户决策后记录采用，附具体原因和持久来源。相同来源重复调用不刷新闲置时间；搜索曝光和读取不算采用。', {
      id: string('已实际采用的记忆 ID'), reason: string('说明它如何影响该成果或决策'), source,
    }, args => api().markUsed(args)),
    define('memory_manage', '主 Agent 管理记忆：save 创建或修订；candidates 返回候选正文/id/version；accept/reject 使用候选 id/version，accept 的正式记忆在 memory 字段，顶层 id 仍属候选。archive/restore/forget 使用正式记忆 ID。version_conflict 后重读对应对象并核验，不能跳过 expected_version；过期候选从最终成果重新核验提取。', {
      action: Type.Union(['save', 'candidates', 'accept', 'reject', 'archive', 'restore', 'forget', 'stats'].map(Type.Literal)), id: optional('accept/reject 使用候选 ID；其余写操作使用正式记忆 ID'), expected_version: Type.Optional(Type.Integer({ minimum: 1, description: '对应对象最新 version：候选来自 candidates，正式记忆来自 memory_read；不是成果 revision' })),
      entry: Type.Optional(Type.Object(Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, Type.Optional(type)])), { additionalProperties: false })),
    }, args => memoryCall(host, args.action, args, () => {
      const memory = api();
      if (args.action === 'candidates') return memory.candidates();
      if (args.action === 'stats') return { ...memory.stats(), compaction: host.storage.list('compaction_receipts').filter(item => item.conversationId === conversationId).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null };
      if (args.action === 'save') return memory.save({ ...args.entry, ...(args.id ? { id: args.id } : {}), expected_version: args.expected_version });
      if (['accept', 'reject'].includes(args.action)) return memory.resolveCandidate({ id: args.id, expected_version: args.expected_version, action: args.action, ...args.entry });
      return memory[args.action](args.id, args.expected_version);
    })),
  ];
}
