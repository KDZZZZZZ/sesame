import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryRepository } from '../packages/memory/repository.js';

test('explicit workflow preferences survive idle aging and restart, but archive and forget remove them from startup', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sesame-workflow-preferences-'));
  let now = Date.parse('2026-01-01T00:00:00Z');
  const repository = new MemoryRepository(directory, async (_session, source) => {
    assert.deepEqual(source, { type: 'user_message', id: 'human-preference' });
    return source;
  }, { clock: () => now }).init();
  t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
  const session = id => { repository.contexts.set(id, { id, scope: 'main' }); return repository.facade(id); };
  const first = session('first-session');
  const entry = { category: 'user/workflow', title: '公司研究的默认环节', summary: '先核查事实再综合；简单问题省略多空辩论。',
    content: '适用：一般公司研究。默认只安排事实研究与综合；当前任务明确要求时可增加反证或风险复核。偏好不改变证据或交易授权要求。',
    scope: { kind: 'global' }, evidence: 'explicit', sources: [{ type: 'user_message', id: 'human-preference' }] };
  const saved = await first.save(entry);
  now += 180 * 86_400_000; repository.maintain(); repository.close(); repository.init();
  const next = session('next-session');
  assert.ok(next.index().items.some(item => item.id === saved.id), 'an ongoing explicit workflow preference remains available on a new session');
  assert.equal(next.read(saved.id).use_count, 0, 'automatic visibility is not adoption');
  assert.deepEqual(next.read(saved.id).sources, entry.sources);
  const updated = await next.save({ id: saved.id, expected_version: saved.version, content: '默认事实研究、反证、综合；本次明确选择优先。' });
  assert.match(next.read(saved.id).content, /反证/);
  const archived = await next.archive(saved.id, updated.version);
  assert.ok(!next.index().items.some(item => item.id === saved.id));
  const restored = await next.restore(saved.id, archived.version);
  assert.ok(next.index().items.some(item => item.id === saved.id));
  await next.forget(saved.id, restored.version);
  repository.close(); repository.init();
  assert.ok(!session('third-session').index().items.some(item => item.id === saved.id));
  await assert.rejects(() => session('third-session').save(entry), { code: 'memory_forgotten' });
});

test('inferred, expired, conflicting and manually archived workflow records do not become active defaults', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sesame-workflow-unconfirmed-'));
  let now = Date.parse('2026-01-01T00:00:00Z');
  const repository = new MemoryRepository(directory, async (_session, source) => source, { clock: () => now }).init();
  t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
  repository.contexts.set('main', { id: 'main', scope: 'main' });
  const memory = repository.facade('main');
  const entry = { category: 'user/workflow', title: '推测偏好', summary: '推测的顺序', content: '先做反证', scope: { kind: 'global' }, evidence: 'inferred', sources: [{ type: 'user_message', id: 'human' }] };
  const inferred = await memory.save(entry);
  const expired = await memory.save({ ...entry, title: '临时偏好', evidence: 'explicit', expires_at: '2026-01-02T00:00:00Z' });
  const conflicted = await memory.save({ ...entry, title: '冲突偏好', evidence: 'explicit' });
  await memory.save({ ...entry, title: '冲突偏好', content: '不做反证', evidence: 'explicit' });
  now += 180 * 86_400_000; repository.maintain();
  const ids = memory.index().items.map(item => item.id);
  for (const value of [inferred, expired, conflicted]) assert.ok(!ids.includes(value.id));
});
