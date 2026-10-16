import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkpointTextRepair, isUtf8Replacement } from '../checkpoint-text-repair.js';
import { ReplayService } from '../service.js';
import { Recorder } from '../recording.js';
import { createRun } from '../native-engine.js';
import { records, closeRecords } from '../records.js';
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const hostRoot = process.env.SESAME_HOST_ROOT ?? fileURLToPath(new URL('../../../../../../mt5agent/', import.meta.url));
const { hostPythonPath } = await import(pathToFileURL(join(hostRoot, 'modules/agent/host-environment.js')).href);
async function removeFixture(root) { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true }); }

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kurumi-text-repair-'));
  const decision = { id: 'role-decision', runId: 'fixture', stepId: 'fixture:0:0', expectedVersion: 1, target: '0', stop: null, reason: '已核对：空仓观察行情。', utterance: '只看已知行情。' };
  const engine = createRun('fixture', [{ symbol: 'USDJPY', startIndex: 0, endIndex: 3 }, { symbol: 'USDJPY', startIndex: 0, endIndex: 3 }, { symbol: 'USDJPY', startIndex: 0, endIndex: 3 }], {});
  engine.decisions = [{ decision: structuredClone(decision) }]; engine.nativeJournal = [{ decision: { ...decision, reason: decision.reason.replace('核', '\ufffd\ufffd\ufffd') } }];
  const doc = { id: 'continuous', revision: 7, engine, commands: {}, settings: { decisionIntervalHours: 4 }, control: { running: false, active: null, recovery: null, phase: 'continuation_error_paused', continuation: { decisionId: decision.id, remainingBars: 1, committedCount: 2 } }, roleEvidence: [{ decision, actorRunId: 'actor-verified', taskId: 'task-fixture' }] };
  const args = { run_id: decision.runId, step_id: decision.stepId, expected_version: decision.expectedVersion, target: decision.target, stop: decision.stop, reason: decision.reason, utterance: decision.utterance };
  const relative = 'runs/actor-verified/task-files/sessions/role.jsonl';
  const body = JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'kurumi_decide', arguments: args }] } }) + '\n';
  const recording = join(root, 'recording'); await mkdir(join(recording, 'runs/actor-verified/task-files/sessions'), { recursive: true });
  await writeFile(join(recording, relative), body);
  const manifest = JSON.stringify({ runId: 'actor-verified', files: [{ path: 'sessions/role.jsonl', archive: relative, bytes: Buffer.byteLength(body), digest: sha(body) }] });
  await writeFile(join(recording, 'runs/actor-verified/sealed.json'), manifest); await writeFile(join(recording, 'runs/actor-verified/sealed.digest'), sha(manifest) + '\n');
  return { root, recording, doc, relative };
}

test('native subprocess reconstructs split Chinese and emoji bytes losslessly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kurumi-utf8-pipe-'));
  try {
    const python = process.env.PYTHON ?? hostPythonPath(); assert.ok(python, 'UTF-8 transport regression requires a native Python interpreter');
    // Run the unchanged production JS adapter with a controlled Python peer.
    // This exercises real pipes on Windows and Unix, without the trading SDK.
    for (const file of ['engine.js', 'experiment-profiles.js', 'native-order-abi.js']) await copyFile(new URL('../' + file, import.meta.url), join(root, file));
    await copyFile(process.env.KURUMI_UTF8_TEST_MODULE ?? new URL('../native-engine.js', import.meta.url), join(root, 'native-engine.js'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(root, 'native-engine.py'), `import sys,json,os,time
request=json.loads(sys.stdin.buffer.read().decode('utf8'))
output=json.dumps({'ok':True,'state':{'echo':request['step']['decision']['reason']}},ensure_ascii=False).encode('utf8')
cuts=sorted({output.index(char.encode('utf8'))+offset for char in ['核','🪄'] for offset in range(1,len(char.encode('utf8')))})
start=0
for end in cuts+[len(output)]:
 os.write(1,output[start:end]); start=end; time.sleep(0.025)
`);
    const native = await import(pathToFileURL(join(root, 'native-engine.js')).href);
    const s = native.createRun('utf8', [{ symbol: 'USDJPY', startIndex: 0, endIndex: 2 }, { symbol: 'USDJPY', startIndex: 0, endIndex: 2 }, { symbol: 'USDJPY', startIndex: 0, endIndex: 2 }], {});
    const reason = '已核对中文 🪄，不得损坏原始决定。';
    const d = { id: 'd1', runId: s.id, stepId: `${s.id}:0:0`, expectedVersion: 1, target: '0', stop: null, reason, utterance: '保持原文' };
    const result = await native.decideAndAdvance(s, d, [{ time: 0 }, { time: 3600000 }], { pythonPath: python });
    assert.equal(result.echo, reason);
  } finally { await removeFixture(root); }
});

test('text restoration requires exact original sealed model tool call and changes no account field', async () => {
  const f = await fixture();
  try {
    const saved = JSON.stringify(f.doc), p = await checkpointTextRepair(f.doc, f.recording);
    assert.equal(p.changes.length, 1); assert.equal(p.after.nativeJournal[0].decision.reason, f.doc.roleEvidence[0].decision.reason);
    assert.deepEqual({ ...p.before, nativeJournal: null }, { ...p.after, nativeJournal: null }); assert.equal(JSON.stringify(f.doc), saved);
    assert.equal(p.proofs[0].sessionPath, f.relative);
    assert.equal(isUtf8Replacement('甲1', '甲2'), false); assert.equal(isUtf8Replacement('核对', '\ufffd\ufffd\ufffd对'), true); assert.equal(isUtf8Replacement('核对', '\ufffd\ufffd\ufffd改'), false);
  } finally { await removeFixture(f.root); }
});

test('repair rejects changed trading values, unproven wording and a modified sealed session', async () => {
  const f = await fixture();
  try {
    const bad = structuredClone(f.doc); bad.engine.nativeJournal[0].decision.target = '1000';
    await assert.rejects(checkpointTextRepair(bad, f.recording), { code: 'CHECKPOINT_TEXT_REPAIR_DENIED' });
    bad.engine.nativeJournal[0].decision.target = '0'; bad.engine.nativeJournal[0].decision.reason = '另一个理由';
    await assert.rejects(checkpointTextRepair(bad, f.recording), { code: 'CHECKPOINT_TEXT_REPAIR_DENIED' });
    await writeFile(join(f.recording, f.relative), '{}\n');
    await assert.rejects(checkpointTextRepair(f.doc, f.recording), { code: 'CHECKPOINT_TEXT_REPAIR_DENIED' });
  } finally { await removeFixture(f.root); }
});

test('explicit service repair keeps pending hour, retains before/after evidence and is idempotent', async () => {
  const f = await fixture(); let doc = f.doc;
  const host = { context: { pluginId: 'sesame/kurumi-replay', kind: 'main', sessionId: 'fixture-main', storageRoot: f.root } };
  records(host).put('challenge', doc);
  const service = new ReplayService(host); service.recorder = new Recorder(f.root, { mirrorRoot: join(f.root, 'mirror') });
  try {
    const input = { command_id: 'repair_fixture_20261011', expected_version: 7 }, before = structuredClone(doc);
    const result = await service.repairCheckpointText(input);
    doc = service.getDocument();
    assert.equal(doc.revision, 8); assert.deepEqual(doc.control.continuation, before.control.continuation); assert.equal(doc.control.running, false);
    assert.equal(doc.engine.version, before.engine.version); assert.equal(doc.engine.balance, before.engine.balance);
    assert.equal(JSON.parse(await readFile(join(f.recording, result.beforeFile.path), 'utf8')).engine.nativeJournal[0].decision.reason, before.engine.nativeJournal[0].decision.reason);
    const journal = await readFile(join(f.recording, 'journal.ndjson'), 'utf8'); assert.match(journal, /checkpoint_text_repair_committed/);
    await service.repairCheckpointText(input); assert.equal(service.getDocument().revision, 8); assert.equal(await readFile(join(f.recording, 'journal.ndjson'), 'utf8'), journal);
    doc.control.active = { taskId: 'still-running' };
    records(host).put('challenge', doc);
    await assert.rejects(service.repairCheckpointText({ command_id: 'repair_active_20261011', expected_version: 8 }), { code: 'DECISION_PENDING' });
  } finally { await service.dispose(host); closeRecords(host); await removeFixture(f.root); }
});
