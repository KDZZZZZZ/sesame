import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JudgmentService } from '../service.js';

function fixture(t) {
  const storageRoot = mkdtempSync(join(tmpdir(), 'judgment-v2-'));
  const rows = new Map(), messages = new Map(), calls = [];
  let now = new Date('2026-01-01T00:00:00Z');
  const host = {
    context: { pluginId: 'sesame/judgment-evolution', storageRoot, sessionId: 'main', kind: 'main' },
    plugins: { read: () => ({ state: 'discoverable', loaded: true }) },
    data: {
      sources: ({ contract }) => ({ items: [{ ref: { providerId: `host#${contract.split('.')[1].split('/')[0]}`, revision: 'host:2' }, available: true }] }),
      query: async ({ source, input, cursor, limit }) => {
        assert.ok(limit <= 200); calls.push(source.providerId);
        const id = source.providerId.split('#')[1]; let items, metadata;
        if (id === 'sessions') items = [{ id: 'main', kind: 'main', activeResponseId: 'response' }];
        if (id === 'datasets') { const dataset = rows.get(input.datasetId); items = dataset ? dataset.rows : [...rows.values()].map(({ rows, ...value }) => value); if (dataset) { const { rows, ...rest } = dataset; metadata = rest; } }
        if (id === 'messages') items = [...messages.values()].filter(item => !input.ids || input.ids.includes(item.id));
        const offset = Number(cursor ?? 0), size = Math.min(limit, 2);
        return { items: items.slice(offset, offset + size), ...(metadata ? { metadata } : {}), ...(offset + size < items.length ? { nextCursor: String(offset + size) } : {}) };
      },
    },
  };
  const service = new JudgmentService(host, { clock: () => now }).init();
  t.after(() => { service.close(); rmSync(storageRoot, { recursive: true, force: true }); });
  const args = { command_id: 'first', claim: 'Value is greater than 10', topic: 'price', regime: 'trend', rationale: 'Test evidence', probability: .8,
    due_at: '2026-01-02T00:00:00Z', verification: { provider: 'source:test', metric: 'value', observed_at_field: 'observed', op: 'gt', target: 10 } };
  return { service, host, args, rows, messages, calls, setTime: value => { now = new Date(value); } };
}

test('v2 boundary reads complete paged evidence before its SQLite transaction', async t => {
  const f = fixture(t), prediction = await f.service.invoke(f.host, 'record', ['main', f.args]);
  assert.equal(prediction.source_message_id, 'response'); f.setTime(prediction.due_at);
  f.rows.set('evidence', { id: 'evidence', rows: [0, 1, 12].map(value => ({ value, observed: value === 12 ? prediction.due_at : '2025-12-30T00:00:00Z' })), provenance: { source_kind: 'external', provider: 'source:test', as_of: prediction.due_at } });
  const result = await f.service.invoke(f.host, 'resolve', ['main', { judgment_id: prediction.id, dataset_id: 'evidence' }]);
  assert.equal(result.review.evidence.outcome, 1); assert.equal(result.review.evidence.row_index, 2);
  assert.ok(f.calls.filter(id => id === 'host#datasets').length >= 3);
  await assert.rejects(f.service.invoke({ ...f.host, context: { ...f.host.context, kind: 'subagent' } }, 'record', ['main', { ...f.args, command_id: 'forged' }]), /主 Agent/);
});

test('v2 hook audits public message text and skips automation origins', async t => {
  const f = fixture(t);
  f.messages.set('user', { id: 'user', origin: 'automation', content: [] });
  f.messages.set('response', { id: 'response', replyTo: 'user', content: [{ type: 'text', text: '预计明天上涨。' }] });
  const event = { conversationId: 'main', responseId: 'response', status: 'completed', scope: 'main' };
  await f.service.invoke(f.host, 'auditTurn', [event]); assert.equal(f.service.statistics().pending_coverage, 0);
  f.messages.get('user').origin = 'user'; await f.service.invoke(f.host, 'auditTurn', [event]);
  assert.equal(f.service.statistics().pending_coverage, 1);
  const page = await f.service.invoke(f.host, 'auditSource', ['main', { message_id: 'response' }]);
  assert.equal(page.source_text, '预计明天上涨。');
});

test('non-completed and non-main turns do not read ports or create coverage work', async t => {
  const f = fixture(t);
  for (const event of [{ status: 'failed', scope: 'main' }, { status: 'completed', scope: 'subagent' }]) {
    assert.equal(await f.service.invoke(f.host, 'auditTurn', [{ conversationId: 'main', responseId: 'absent', ...event }]), null);
  }
  assert.deepEqual(f.calls, []); assert.equal(f.service.list('coverage').length, 0);
});
