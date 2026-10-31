import { join } from 'node:path';
import { digest, requireValue, text } from './support.js';

// Audit only the invocation snapshot. The service owns host reads and the ledger.
export function auditTurn(service, { conversationId, responseId, status }) {
  if (!service.enabled() || status !== 'completed' || service.data().sessions.get(conversationId)?.kind !== 'main') return;
  const message = service.message(responseId), input = service.message(message.replyTo, true);
  if (input?.origin === 'automation') return;
  const content = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  if (!content.trim() || service.get('coverage', responseId, true)) return;
  const registered = service.list('prediction').filter(item => item.source_message_id === responseId);
  const sentences = content.split(/[。！？\n]+/).map(value => value.trim()).filter(value => value && /预计|预测|预期|目标价|概率|(?:明天|下周|未来|明年).{0,40}(?:上涨|下跌|达到|超过|低于)|\b(?:predict|forecast|probability|expect)\b/i.test(value) && !/^(?:我|我们)(?:会|将)|已登记|已核验|尚未|无法|没有.*(?:预测|概率)/.test(value));
  const unmatched = sentences.filter(sentence => !registered.some(item => sentence.includes(item.id) || sentence.includes(item.claim) || item.claim.includes(sentence)));
  // Keep a durable queue without waking the model. The Agent chooses when
  // to audit; regex hints never substitute for reading the full source.
  service.put('coverage', { id: responseId, conversation_id: conversationId, created_at: service.now(), status: 'pending',
    source_hash: digest(content), source_length: content.length, read_offset: 0, statements: unmatched.slice(0, 20), attempts: 0 });
}
export function auditSource(service, conversationId, { message_id, offset = 0, limit = 12000 }) {
  service.assertMain(conversationId); const coverage = service.get('coverage', message_id);
  requireValue(Number.isInteger(offset) && offset >= 0 && offset <= (coverage.read_offset ?? 0) && Number.isInteger(limit) && limit > 0 && limit <= 20000, '必须依次读取完整原文，不能跳过页；每页最多 20000 字符');
  const message = service.message(message_id), content = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  requireValue(!coverage.source_hash || digest(content) === coverage.source_hash, '原始回复已变化，请重新检查');
  const end = Math.min(content.length, offset + limit);
  service.put('coverage', { ...coverage, read_offset: Math.max(coverage.read_offset ?? 0, end), source_length: content.length });
  return { message_id, source_text: content.slice(offset, end), offset, total: content.length, next_offset: end < content.length ? end : null,
    registered_judgments: service.list('prediction').filter(item => item.source_message_id === message_id).map(item => ({ id: item.id, claim: item.claim })) };
}
export function acknowledgeCoverage(service, conversationId, { message_id, judgment_ids = [], exclusions = [], review_summary }) {
  service.assertMain(conversationId); const coverage = service.get('coverage', message_id);
  requireValue((coverage.read_offset ?? 0) >= (coverage.source_length ?? 1), '请先用 judgment_audit_source 读完原文，不能只检查关键词提示');
  text(review_summary, '完整语义核对结论', 4000);
  requireValue(Array.isArray(judgment_ids) && Array.isArray(exclusions), '需要有效判断引用与不适用项');
  for (const key of judgment_ids) service.get('prediction', key);
  for (const item of exclusions) { text(item.statement, '原句', 2000); text(item.reason, '不适用原因', 2000); requireValue(coverage.statements.includes(item.statement), '排除项必须来自本次待核对原句'); }
  const handled = new Set(exclusions.map(item => item.statement));
  for (const statement of coverage.statements) if (judgment_ids.some(key => { const claim = service.get('prediction', key).claim; return claim === statement || statement.includes(claim); })) handled.add(statement);
  requireValue(coverage.statements.every(statement => handled.has(statement)), '仍有原句未登记或解释');
  const result = service.put('coverage', { ...coverage, status: 'reviewed', judgment_ids, exclusions, review_summary, completed_at: service.now() });
  service.refreshFiles(); return result;
}
export function reviewQueue(service, conversationId, { kind = 'all', offset = 0, limit = 30 } = {}) {
  service.assertMain(conversationId);
  requireValue(service.enabled(), '判断复盘插件未启用', 403);
  requireValue(['all', 'due', 'reflection', 'coverage'].includes(kind) && Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 100, '复盘清单参数无效');
  const now = Date.parse(service.now());
  const items = [
    ...service.list('prediction').filter(item => item.status !== 'resolved' && Date.parse(item.next_review_at) <= now)
      .map(item => ({ kind: 'due', judgment_id: item.id, claim: item.claim, topic: item.topic, due_at: item.due_at, evidence_gap: item.evidence_gap ?? null })),
    ...service.list('prediction').filter(item => item.status === 'resolved' && !item.review.semantic)
      .map(item => ({ kind: 'reflection', judgment_id: item.id, claim: item.claim, resolved_at: item.review.resolved_at })),
    ...service.list('coverage').filter(item => item.status === 'pending')
      .map(item => ({ kind: 'coverage', message_id: item.id, created_at: item.created_at, hints: item.statements, source_length: item.source_length })),
  ].filter(item => kind === 'all' || item.kind === kind);
  return { items: items.slice(offset, offset + limit), total: items.length, offset,
    next_offset: offset + limit < items.length ? offset + limit : null, statistics: service.statistics(), criteria_path: join(service.directory, 'CRITERIA.md') };
}
