import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeRecords, records } from '../records.js';
import { drainWeeklyQueue, listWeeklyJobs } from '../weekly-reports.js';

for (const stage of ['before-wait', 'during-wait']) test(`weekly report reconnects the same interrupted Agent after recovery ${stage}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'kurumi-weekly-resume-'));
  let status = stage === 'before-wait' ? 'interrupted' : 'running', waits = 0, collections = 0, publications = 0;
  const run = () => ({ id: 'weekly-role', status, error: status === 'interrupted' ? { code: 'MODEL_UNAVAILABLE', message: 'Model temporarily unavailable' } : null,
    interrupts: status === 'interrupted' ? [{ id: 'weekly-interrupt', reason: 'Model temporarily unavailable' }] : [] });
  const host = {
    context: { storageRoot: root },
    capabilities: { invoke: () => assert.fail('Recovery must not create a replacement Agent') },
    runs: {
      read: ref => { assert.equal(ref.id, 'weekly-role'); return { run: run() }; },
      wait: async ref => { assert.equal(ref.id, 'weekly-role'); waits++; if (status === 'running') status = 'interrupted'; return { reason: status === 'completed' ? 'settled' : 'interrupted', run: run() }; },
      cancel: () => assert.fail('An interrupted or completed Agent must retain its Run'),
    },
    resources: {
      create: async input => ({ id: input.name, kind: input.kind }),
      publish: async (_root, manifest) => ({ ref: { id: `publication-${++publications}`, revision: '1', digest: `sha256:${'a'.repeat(64)}`, kind: manifest.kind, schemaVersion: '1.0.0' } }),
    },
  };
  t.after(async () => { closeRecords(host); await rm(root, { recursive: true, force: true }); });
  records(host).put('round2-weekly', { id: 'weekly_fixture', revision: 1, status: stage === 'before-wait' ? 'interrupted' : 'submitted', taskId: 'weekly-role', transport: 'agents',
    inputRef: { id: 'frozen-input', revision: '1', digest: `sha256:${'b'.repeat(64)}`, kind: 'data', schemaVersion: '1.0.0' },
    input: { opening: { sourceProvenance: { kind: 'demo' } }, closing: { sourceProvenance: { kind: 'demo' } }, period: { partial: false } }, output: null });
  const options = { authorizeGeneration: true, collectFullAgentOutput: async id => { assert.equal(id, 'weekly-role'); collections++; return { complete: true, output: { text: 'Synthetic retained Agent result' }, artifactRefs: [] }; } };
  const service = { archiveFileSafe: async path => ({ path }) };
  await drainWeeklyQueue(host, service, options);
  assert.equal(listWeeklyJobs(host)[0].status, 'interrupted');
  assert.equal(collections, 0);
  const pausedWaits = waits;
  await drainWeeklyQueue(host, service, options);
  assert.equal(waits, pausedWaits, 'An unresolved interruption does not loop or restart the role');
  closeRecords(host);
  status = 'completed'; // The main Agent resumed this original Run after repairing the model.
  await drainWeeklyQueue(host, service, options);
  const sealed = listWeeklyJobs(host)[0];
  assert.equal(sealed.status, 'sealed'); assert.equal(sealed.taskId, 'weekly-role');
  assert.equal(sealed.output.output.text, 'Synthetic retained Agent result');
  assert.equal(collections, 1); assert.equal(publications, 2);
  await drainWeeklyQueue(host, service, options);
  assert.equal(collections, 1); assert.equal(publications, 2);
});
