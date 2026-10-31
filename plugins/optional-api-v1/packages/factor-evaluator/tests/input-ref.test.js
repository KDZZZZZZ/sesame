import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluate, PROTOCOL, canonical, digest } from '../evaluator.js';

const iso = day => new Date(Date.UTC(2024, 0, day)).toISOString();
const rows = Array.from({ length: 13 }, (_, day) => Array.from({ length: 4 }, (_, i) => ({
  time: iso(day + 1), availableAt: iso(day + 1), symbol: `S${i}`,
  fields: { close: 100 * (1 + i / 100) ** day, signal: i },
}))).flat();
const dataset = { trainEnd: iso(5), validationEnd: iso(9), holdoutEnd: iso(13) };
const candidate = { op: 'field', name: 'signal' };
const hashBytes = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
// Independent publisher fixture: the artifact contract sorts JSON keys while
// writing them, including integer-like names that JSON.stringify reorders.
function hostCanonical(value) {
  if (Array.isArray(value)) return '[' + value.map(hostCanonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + hostCanonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const evidenceRef = { id: 'artifact_evidence', revision: 'revision_evidence', digest: 'sha256:' + 'b'.repeat(64), kind: 'resource', schemaVersion: '1.0.0' };
const execution = { provenance: {
  chain: [{ pluginId: 'sesame/auto-factor-mining' }, { pluginId: 'sesame/factor-evaluator' }],
  caller: { pluginId: 'sesame/auto-factor-mining' },
} };

function panel(data = rows, change = () => {}) {
  const bytes = Buffer.from(JSON.stringify(data));
  const provenance = { kind: 'demo', origin: 'demo', references: [evidenceRef], executionId: 'synthetic-test-execution' };
  const manifest = { kind: 'data', schemaVersion: '1.0.0',
    content: { format: 'json-rows', path: 'rows.json', columns: ['time', 'symbol', 'availableAt', 'fields'], rowCount: data.length, provenance },
    dependencies: [evidenceRef], blobs: [{ path: 'rows.json', mediaType: 'application/json', size: bytes.length, digest: hashBytes(bytes) }], provenance };
  change(manifest);
  return { bytes, manifest, ref: { id: 'artifact_panel', revision: 'revision_1', digest: hashBytes(hostCanonical(manifest)), kind: 'data', schemaVersion: '1.0.0' } };
}
function fixture(source = panel()) {
  const records = new Map(), resources = new Map(), artifacts = new Map(), reads = [];
  const add = source => { artifacts.set(canonical(source.ref), source); return structuredClone(source.ref); };
  const inputRef = add(source);
  const f = { records, resources, reads, add, inputRef, alterPage: value => value };
  const host = { context: { pluginId: 'sesame/factor-evaluator', kind: 'main', sessionId: 'factor-input-fixture' },
    data: { sources() { assert.fail('Fixed DataRef must not use a host dataset'); }, query() { assert.fail('Do not guess or register dataset IDs'); } },
    state: {
      async read({ collection, key }) {
        const record = records.get(`${collection}:${key}`);
        if (!record) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        return structuredClone(record);
      },
      async commit(changes) {
        const entries = changes.map(change => {
          const key = `${change.key.collection}:${change.key.key}`, previous = records.get(key);
          assert.equal(change.expectedVersion, previous?.version ?? 0);
          const next = { key: change.key, value: structuredClone(change.value), version: (previous?.version ?? 0) + 1 };
          records.set(key, next); return next;
        });
        return { entries };
      },
    },
    resources: {
      async create({ kind, source }) {
        const ref = { id: `resource-${resources.size}`, kind, version: 1 };
        resources.set(ref.id, Buffer.from(source.content)); return ref;
      },
      async read(ref, { part, entry, offset = 0, length = 262144 }) {
        let bytes;
        if (ref.revision) {
          const artifact = artifacts.get(canonical(ref));
          assert.ok(artifact, 'Reads must use the exact registered reference');
          reads.push({ ref: structuredClone(ref), part, entry });
          if (part === 'manifest') return structuredClone(artifact.manifest);
          assert.equal(entry, 'rows.json'); bytes = artifact.bytes;
          length = Math.min(length, 113);
        } else bytes = resources.get(ref.id);
        assert.ok(Buffer.isBuffer(bytes));
        const end = Math.min(offset + length, bytes.length);
        const page = { ref, content: bytes.subarray(offset, end).toString('base64'), total: bytes.length,
          offset, length: end - offset, encoding: 'base64', ...(end < bytes.length ? { nextOffset: end } : {}) };
        return ref.revision ? f.alterPage(page) : page;
      },
    },
  };
  f.host = host;
  f.call = (action, more = {}, signal) => evaluate(host, { protocol: PROTOCOL, action, run_id: 'fixed-panel', ...more }, signal, execution);
  f.prepare = (more = {}, signal) => f.call('prepare', { access: 'restricted', options: { dataset, inputRef }, ...more }, signal);
  return f;
}

test('fixed DataRef prepares, measures and freezes without dataset registration', async () => {
  const f = fixture(), prepared = await f.prepare();
  assert.deepEqual(prepared.data.inputRefs, [f.inputRef]);
  assert.deepEqual(prepared.data.provenance, panel().manifest.content.provenance);
  assert.equal(prepared.data.synthetic, true);
  assert.equal(prepared.data.rowCount, 36);
  assert.ok(prepared.development.rows.every(row => row.time <= iso(9)));
  assert.ok(f.reads.filter(read => read.part === 'content').length > 1);
  const session_id = prepared.sessionId;
  const measured = await f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] });
  assert.equal(measured.metrics.validation.rankIC, 1);
  const selection = await f.call('select', { session_id, trial_ids: ['one'] });
  const final = await f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.equal(final.holdout.one.rankIC, 1);
  assert.equal(final.holdoutStatus, 'evaluated');
});

test('artifact manifest digest follows publisher ordering for integer-like provenance keys', async () => {
  const counts = { '2': 3, '10': 4 };
  assert.equal(hostCanonical(counts), '{"10":4,"2":3}');
  assert.equal(canonical(counts), '{"2":3,"10":4}', 'Existing evaluator receipt canonicalization must not change');
  const source = panel(rows, manifest => { manifest.content.provenance.counts = counts; });
  assert.notEqual(source.ref.digest, digest(source.manifest), 'Fixture must distinguish artifact and evaluator digest contracts');
  const f = fixture(source), prepared = await f.prepare();
  assert.deepEqual(prepared.data.provenance.counts, counts);
  const { receiptDigest, ...body } = prepared;
  assert.equal(receiptDigest, digest(body), 'Receipts continue using the evaluator digest contract');
  const measured = await f.call('candidate', { session_id: prepared.sessionId, trial_id: 'integer-keys', candidate, accepted_ids: [] });
  assert.equal(measured.metrics.validation.rankIC, 1);
  assert.deepEqual(await f.prepare(), prepared);
  const incorrect = panel(rows, manifest => { manifest.content.provenance.counts = counts; });
  incorrect.ref.digest = digest(incorrect.manifest);
  await assert.rejects(fixture(incorrect).prepare(), /manifest.*digest/i);
});

test('registered dataset identity and input digest remain unchanged', async () => {
  const f = fixture(); let queries = 0;
  f.host.data = {
    sources: async () => ({ items: [{ ref: { providerId: 'host#datasets', revision: 'host:2' }, available: true }] }),
    query: async ({ input }) => { queries++; assert.deepEqual(input, { datasetId: 'data' }); return { items: rows, metadata: { id: 'data', provenance: { kind: 'demo' } } }; },
  };
  const prepared = await f.prepare({ dataset_id: 'data', options: { dataset } });
  assert.equal(prepared.data.inputRefs, undefined);
  assert.equal(queries, 1); assert.equal(f.reads.length, 0);
  const stored = JSON.parse(f.resources.get(f.records.get(`sessions:${prepared.sessionId}`).value.refs.dataset.id));
  assert.equal(prepared.inputDigest, digest({ dataset: stored, sourceId: 'data' }));
  const result = await f.call('candidate', { session_id: prepared.sessionId, trial_id: 'registered', candidate, accepted_ids: [] });
  assert.equal(result.metrics.validation.rankIC, 1);
});

test('DataRef remains immutable across retries and complete revision identity is frozen', async () => {
  const f = fixture(), first = await f.prepare(), written = f.resources.size;
  assert.deepEqual(await f.prepare(), first); assert.equal(f.resources.size, written);
  const second = panel(); second.ref.revision = 'revision_2'; const inputRef = f.add(second);
  await assert.rejects(f.prepare({ options: { dataset, inputRef } }), /different frozen inputs/);
  const changed = await f.prepare({ run_id: 'new-panel-run', options: { dataset, inputRef } });
  assert.notEqual(changed.inputDigest, first.inputDigest);
  assert.deepEqual(changed.data.inputRefs, [inputRef]);
});

test('two input sources conflict and missing input remains an error before I/O', async () => {
  const f = fixture();
  await assert.rejects(f.prepare({ dataset_id: 'data' }), /Choose.*dataset_id.*inputRef/);
  await assert.rejects(f.prepare({ options: { dataset } }), /dataset_id.*inputRef.*required/);
  assert.equal(f.reads.length, 0); assert.equal(f.records.size, 0);
});

test('only complete fixed data references are accepted', async t => {
  const ref = panel().ref;
  const cases = [
    ['wrong kind', { ...ref, kind: 'report' }],
    ['missing revision', Object.fromEntries(Object.entries(ref).filter(([key]) => key !== 'revision'))],
    ['missing digest', Object.fromEntries(Object.entries(ref).filter(([key]) => key !== 'digest'))],
    ['extra path', { ...ref, path: 'panel.json' }],
    ['resource handle', { id: 'file', kind: 'file', version: 1 }],
    ['wrong version', { ...ref, schemaVersion: '2.0.0' }],
    ['path string', 'panel.json'],
  ];
  for (const [name, inputRef] of cases) await t.test(name, async () => {
    const f = fixture();
    await assert.rejects(f.prepare({ options: { dataset, inputRef } }), /fixed.*data.*reference/i);
    assert.equal(f.reads.length, 0); assert.equal(f.records.size, 0);
  });
});

test('source manifest, bytes, reference and pagination are independently checked', async t => {
  await t.test('manifest digest', async () => {
    const source = panel(); source.manifest.content.rowCount--;
    const f = fixture(source); await assert.rejects(f.prepare(), /manifest.*digest/i); assert.equal(f.resources.size, 0);
  });
  await t.test('blob digest', async () => {
    const source = panel(); source.bytes = Buffer.from(source.bytes); source.bytes[3] ^= 1;
    const f = fixture(source); await assert.rejects(f.prepare(), /content.*digest/i); assert.equal(f.resources.size, 0);
  });
  await t.test('returned reference', async () => {
    const f = fixture(); f.alterPage = page => ({ ...page, ref: { ...page.ref, revision: 'other' } });
    await assert.rejects(f.prepare(), /different.*identity/i); assert.equal(f.resources.size, 0);
  });
  await t.test('nonadvancing cursor', async () => {
    const f = fixture(); f.alterPage = page => ({ ...page, nextOffset: page.offset });
    await assert.rejects(f.prepare(), /cursor/i); assert.equal(f.resources.size, 0);
  });
  await t.test('truncated stream', async () => {
    const f = fixture(); f.alterPage = page => { const { nextOffset: _nextOffset, ...truncated } = page; return truncated; };
    await assert.rejects(f.prepare(), /incomplete/i); assert.equal(f.resources.size, 0);
  });
});

test('manifest schema, provenance, row count and input bounds reject before session save', async t => {
  const cases = [
    ['format', manifest => { manifest.content.format = 'csv'; }, /json-rows/],
    ['schema version', manifest => { manifest.schemaVersion = '2.0.0'; }, /schema/],
    ['provenance', manifest => { manifest.content.provenance = {}; }, /provenance/],
    ['row count mismatch', manifest => { manifest.content.rowCount--; }, /rowCount/],
    ['more than 20000 rows', manifest => { manifest.content.rowCount = 20001; }, /20000/],
    ['larger than 4 MiB', manifest => { manifest.blobs[0].size = 4 * 1024 * 1024 + 1; }, /4MiB/],
    ['missing entry', manifest => { manifest.content.path = 'unpublished.json'; }, /entry/],
  ];
  for (const [name, change, pattern] of cases) await t.test(name, async () => {
    const f = fixture(panel(rows, change));
    await assert.rejects(f.prepare(), pattern); assert.equal(f.records.size, 0); assert.equal(f.resources.size, 0);
  });
});

test('fixed input preserves development-only and PIT gates without inventing fields', async () => {
  const f = fixture();
  await assert.rejects(f.prepare({ access: 'development-only' }), /after validationEnd/);
  const development = fixture(panel(rows.filter(row => row.time <= iso(9))));
  const prepared = await development.prepare({ access: 'development-only' });
  assert.equal(prepared.data.holdoutMode, 'none');
  const selected = await development.call('select', { session_id: prepared.sessionId, trial_ids: [] });
  const final = await development.call('finalize', { session_id: prepared.sessionId, selection_digest: selected.selectionDigest });
  assert.equal(final.holdoutStatus, 'not-requested'); assert.deepEqual(final.holdout, {});
  const invalid = structuredClone(rows); invalid[0].availableAt = iso(2);
  await assert.rejects(fixture(panel(invalid)).prepare(), /Point-in-time violation/);
  const originalMarketRows = rows.map(({ time, fields }) => ({ time, close: fields.close }));
  await assert.rejects(fixture(panel(originalMarketRows)).prepare(), /row 0/);
});

test('aborted reads cannot produce a prepared session', async () => {
  const f = fixture(), controller = new AbortController();
  f.alterPage = page => { controller.abort(new Error('test cancellation')); return page; };
  await assert.rejects(f.prepare({}, controller.signal), /test cancellation/);
  assert.equal(f.reads.filter(read => read.part === 'content').length, 1);
  assert.equal(f.records.size, 0); assert.equal(f.resources.size, 0);
});

test('portable archive reproduction includes complete input reference identity', async () => {
  const f = fixture(), prepared = await f.prepare({ options: { dataset, inputRef: f.inputRef,
    diagnostics: { placebo: { samples: 20, seed: 7 }, outOfSample: true } } }), session_id = prepared.sessionId;
  const measured = await f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] });
  const selection = await f.call('select', { session_id, trial_ids: ['one'] });
  const final = await f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.equal(measured.metrics.diagnostics.placebo.status, 'completed');
  assert.equal(final.holdout.one.diagnostics.outOfSample.holdout.status, 'evaluated');
  const run = { id: 'fixed-panel', data: prepared.data, trials: [{ id: 'one', candidate, metrics: measured.metrics }], selection, holdout: final.holdout };
  const frozen = { dataDigest: prepared.data.digest, holdoutSealed: false, dataset: final.archive };
  const prefix = join(resolve(tmpdir()), 'sesame-factor-input-'), directory = await mkdtemp(prefix);
  try {
    const runPath = join(directory, 'run.json'), dataPath = join(directory, 'dataset.json');
    await writeFile(runPath, JSON.stringify(run)); await writeFile(dataPath, JSON.stringify(frozen));
    const reproduce = () => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/reproduce.mjs', import.meta.url)), runPath, dataPath], { encoding: 'utf8' });
    const good = reproduce(); assert.equal(good.status, 0, good.stderr); assert.equal(JSON.parse(good.stdout).verified, true);
    assert.equal(JSON.parse(good.stdout).searchDiagnosticsVerified, true);
    run.selection.diagnostics.pbo.probability = .0001; await writeFile(runPath, JSON.stringify(run));
    const changedSearch = reproduce(); assert.notEqual(changedSearch.status, 0); assert.match(changedSearch.stderr, /Complete-search diagnostics differ/);
    delete run.selection.diagnostics.pbo.probability;
    run.data.inputRefs[0].revision = 'tampered-revision'; await writeFile(runPath, JSON.stringify(run));
    const tampered = reproduce(); assert.notEqual(tampered.status, 0); assert.match(tampered.stderr, /Frozen input digest differs/);
  } finally {
    assert.ok(resolve(directory).startsWith(prefix));
    await rm(directory, { recursive: true, force: true });
  }
});
