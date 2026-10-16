import { withMemory, activateMemory, disposeMemory, compactMemory } from './service.js';
import { requireValue } from './support.js';

async function memoryCall(host, memory, action, args, execute) {
  try { return await execute(); }
  catch (error) {
    const candidate = ['accept', 'reject'].includes(action) || args.id?.startsWith('memcandidate_');
    const next = candidate
      ? host.context.kind === 'main' ? { tool: 'memory_manage', arguments: { action: 'candidates' } } : { action: 'use_memory_propose_result', candidate_id: args.id }
      : { tool: 'memory_read', arguments: { id: args.id } };
    if (error.code === 'version_conflict') {
      let version;
      try { version = candidate ? memory.candidates().items.find(item => item.id === args.id)?.version : memory.read(args.id).version; }
      catch { /* Preserve the original error if an entry was removed or became inaccessible. */ }
      error.details = { ...error.details, ...(version === undefined ? {} : { current_version: version }), next_action: next };
      const read = candidate ? host.context.kind === 'main' ? '用 memory_manage action=candidates 重新读取候选的 id/version' : '核对 memory_propose 返回的候选并交主 Agent 重新读取候选 id/version' : '用 memory_read 重新读取正式记忆的 id/version';
      error.message += `${version === undefined ? '' : `；当前版本 ${version}`}；先${read}，核对最新内容后再提交 expected_version，不能盲目重试旧版本。`;
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

async function manage(services, args) {
  const memory = services.memory;
  if (args.action === 'candidates') return memory.candidates();
  if (args.action === 'stats') return { ...memory.stats(), compaction: services.journal.list('compaction_receipts').filter(item => item.conversationId === services.context.id).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null };
  if (args.action === 'save') return memory.save({ ...args.entry, ...(args.id ? { id: args.id } : {}), expected_version: args.expected_version });
  if (['accept', 'reject'].includes(args.action)) return memory.resolveCandidate({ ...args.entry, id: args.id, expected_version: args.expected_version, action: args.action });
  requireValue(['archive', 'restore', 'forget'].includes(args.action), 'Unknown memory action');
  return memory[args.action](args.id, args.expected_version);
}

export function createCapabilities(host) {
  return [
    { name: 'memory_search', execute: args => withMemory(host, s => s.memory.search(args)) },
    { name: 'memory_read', execute: args => withMemory(host, s => memoryCall(host, s.memory, 'read', args, () => s.memory.read(args.id))) },
    { name: 'memory_propose', execute: args => withMemory(host, s => s.memory.propose(args)) },
    { name: 'memory_mark_used', execute: args => withMemory(host, s => s.memory.markUsed(args)) },
    { name: 'memory_manage', execute: args => withMemory(host, s => memoryCall(host, s.memory, args.action, args, () => manage(s, args))) },
    { name: 'memory_tree', execute: () => withMemory(host, s => s.memory.tree()) },
    { name: 'memory_index', execute: args => withMemory(host, s => s.memory.index(args)) },
    { name: 'memory_configure', execute: args => withMemory(host, s => s.memory.configure(args)) },
    { name: 'memory_stats', execute: () => withMemory(host, s => manage(s, { action: 'stats' })) },
    { name: 'memory_activate', execute: () => activateMemory(host) },
    { name: 'memory_before_compact', execute: (args, signal) => compactMemory(host, args, signal) },
    { name: 'memory_before_run_release', execute: args => withMemory(host, (s, repository) => repository.finalizeTask(s.context.id, args.runId ?? args.workspaceRunId)) },
    { name: 'memory_dispose', execute: () => disposeMemory(host) },
  ];
}
