import { requireValue } from './support.js';
import { datasetSnapshot } from './evidence.js';

// A complete invocation snapshot keeps synchronous SQLite transactions independent
// of network/host awaits. No compatibility HostContext is constructed here.
export async function inputs(host, method, args, signal) {
  const refs = new Map(); let bytes = 0;
  async function query(name, input) {
    if (!refs.has(name)) {
      const sources = await host.data.sources({ contract: `sesame.${name}/1` });
      const source = sources.items.find(item => item.ref.providerId === `host#${name}` && item.available !== false);
      requireValue(source, `缺少已声明的 ${name} 数据源`, 503); refs.set(name, source.ref);
    }
    const items = []; let cursor, metadata;
    do {
      signal?.throwIfAborted();
      const page = await host.data.query({ source: refs.get(name), operation: 'query', input, limit: 200, ...(cursor ? { cursor } : {}) }, { signal });
      bytes += Buffer.byteLength(JSON.stringify(page)); requireValue(bytes <= 64 * 1024 * 1024, '本次核验数据超过 64 MiB；请缩小已保存证据集合', 413);
      items.push(...page.items); metadata ??= page.metadata; cursor = page.nextCursor;
    } while (cursor);
    return { items, metadata };
  }
  const event = method === 'auditTurn' ? args[0] : null;
  const sessionId = event?.conversationId ?? host.context.sessionId;
  requireValue(event ? event.scope === 'main' : host.context.kind === 'main', '判断登记、复盘与准则管理仅供主 Agent 使用', 403);
  const status = await host.plugins.read(host.context.pluginId, { part: 'status' });
  const sessions = new Map((await query('sessions', { sessionId })).items.map(item => [item.id, item]));
  const datasets = new Map(), messages = new Map();
  if (['resolve', 'reviewDue'].includes(method)) {
    const summaries = (await query('datasets', {})).items;
    requireValue(summaries.length <= 1000, '本次核验最多读取 1000 个保存的数据集', 413);
    for (const summary of summaries) {
      const result = await query('datasets', { datasetId: summary.id });
      requireValue(result.metadata?.id === summary.id, '证据数据源返回了不同身份的数据集');
      datasets.set(summary.id, { ...result.metadata, rows: result.items });
    }
    const input = args[1] ?? {};
    const references = method === 'resolve'
      ? input.artifact ? [{ datasetId: input.dataset_id, artifact: input.artifact }]
        : input.source !== undefined || input.query !== undefined ? [{ datasetId: input.dataset_id, source: input.source, query: input.query }] : []
      : input.evidence ?? [];
    const external = await datasetSnapshot(host, references, signal);
    for (const [id, dataset] of external) {
      requireValue(!datasets.has(id), '证据 ID 与已有宿主数据冲突，不能替换来源'); datasets.set(id, dataset);
    }
  }
  const messageId = event?.responseId ?? (method === 'auditSource' ? args[1].message_id : null);
  if (messageId) {
    for (const item of (await query('messages', { sessionId, ids: [messageId] })).items) messages.set(item.id, item);
    const reply = messages.get(messageId)?.replyTo;
    if (event && reply) for (const item of (await query('messages', { sessionId, ids: [reply] })).items) messages.set(item.id, item);
  }
  return { sessions, datasets, messages, enabled: status.loaded === true || status.state === 'mounted' };
}
