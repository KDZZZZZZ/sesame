import { withMemory, activateMemory, disposeMemory, compactMemory } from './service.js';
import { requireValue } from './support.js';

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
    { name: 'memory_read', execute: args => withMemory(host, s => s.memory.read(args.id)) },
    { name: 'memory_propose', execute: args => withMemory(host, s => s.memory.propose(args)) },
    { name: 'memory_mark_used', execute: args => withMemory(host, s => s.memory.markUsed(args)) },
    { name: 'memory_manage', execute: args => withMemory(host, s => manage(s, args)) },
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
