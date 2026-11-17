import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCapabilities, researchMethods, researchRead } from '../packages/research/index.js';
import { buildLock, packageFiles } from '../scripts/plugin-lock.mjs';

const root = fileURLToPath(new URL('../packages/research/', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');
const json = path => JSON.parse(read(path));
const catalog = json('methods/index.json');
const entries = new Map(catalog.entries.map(entry => [entry.id, entry]));
const content = id => read(entries.get(id).path);
const fields = id => JSON.parse(content(id)).fields;
const manifest = json('plugin.json');
const declarations = json('capabilities.json');
const migration = JSON.parse(readFileSync(new URL('./fixtures/research-migration-coverage.json', import.meta.url)));

test('Research is a mounted native read-only plugin with exactly two narrow tools', async () => {
  assert.equal(manifest.id, 'sesame/research');
  assert.equal(manifest.apiVersion, '2');
  assert.equal(manifest.version, json('package.json').version);
  assert.equal(manifest.execution, 'native');
  assert.equal(manifest.default_state, 'mounted');
  assert.deepEqual(manifest.permissions, { scopes: [], calls: [] });
  const capabilities = createCapabilities(new Proxy({}, { get() { throw new Error('Research must not call host services'); } }));
  assert.deepEqual(capabilities.map(item => item.name), ['research_methods', 'research_read']);
  assert.deepEqual(declarations.capabilities.map(item => item.id), capabilities.map(item => item.name));
  for (const cap of declarations.capabilities) {
    assert.deepEqual(cap.effects, []);
    assert.deepEqual(cap.consumers, ['agent', 'host']);
    assert.equal(cap.execution, 'immediate');
    assert.deepEqual(cap.binding, { type: 'native', name: cap.id });
    assert.equal(cap.inputSchema.type, 'object');
    assert.equal(cap.inputSchema.additionalProperties, false);
  }
  assert.deepEqual(Object.keys(declarations.capabilities[0].inputSchema.properties), ['query', 'limit']);
  assert.deepEqual(Object.keys(declarations.capabilities[1].inputSchema.properties), ['ids']);
  assert.equal((await capabilities[0].execute({ query: 'valuation' })).items[0].id, 'valuation');
  assert.equal((await capabilities[1].execute({ ids: ['valuation'] })).items[0].content, content('valuation'));
});

test('Discovery exposes bounded metadata, not full method or field bodies', () => {
  const first = researchMethods();
  assert.equal(first.items.length, 8);
  assert.equal(first.total, 21);
  assert.equal(first.hasMore, true);
  const all = researchMethods({ limit: 50 });
  assert.equal(all.items.length, 21);
  assert.equal(all.hasMore, false);
  for (const item of all.items) {
    assert.equal(item.kind, 'method');
    assert.ok(item.summary && item.questions.length && item.path);
    assert.equal(Object.hasOwn(item, 'content'), false);
  }
  assert.deepEqual(all.resources.map(item => item.id), catalog.common);
  first.items[0].title = 'changed';
  first.items[0].references.length = 0;
  assert.notEqual(researchMethods().items[0].title, 'changed');
  assert.ok(researchMethods().items[0].references.length > 0);
});

test('Question discovery keeps specialist and mixed questions distinct', () => {
  for (const [query, expected] of [
    ['财报前应该看什么', 'earnings-preview'], ['财报哪里超预期', 'earnings-review'],
    ['现在的价格贵不贵', 'valuation'], ['策略最近为什么失效', 'strategy-diagnosis'],
    ['portfolio risk', 'portfolio-risk'], ['fields-volatility-pricing', 'fields-volatility-pricing'],
  ]) assert.ok(researchMethods({ query }).items.some(item => item.id === expected), `${query} should discover ${expected}`);
  const mixed = researchMethods({ query: '利润增长为什么股价跌了', limit: 50 }).items.map(item => item.id);
  assert.ok(mixed.includes('event-explanation') && mixed.includes('earnings-review'));
  const absent = researchMethods({ query: 'xyznonexistentquestionabc' });
  assert.deepEqual(absent.items, []);
  assert.match(absent.guidance, /不代表没有适用方法/);
  assert.match(absent.guidance, /adapt-and-compose/);
});

test('Every indexed resource is declared, readable in full and connected to valid references', async () => {
  assert.equal(catalog.entries.length, 45);
  assert.equal(entries.size, catalog.entries.length);
  const declaredPaths = new Set(declarations.knowledge.map(item => item.path));
  const resources = new Set(manifest.resources);
  for (let start = 0; start < catalog.entries.length; start += 5) {
    const batch = catalog.entries.slice(start, start + 5);
    const result = await researchRead({ ids: batch.map(item => item.id) });
    assert.deepEqual(result.items.map(item => item.id), batch.map(item => item.id));
    for (const item of result.items) {
      assert.equal(item.content, read(item.path));
      assert.ok(item.content.length > 100);
      assert.ok(Buffer.byteLength(item.content) < 128 * 1024);
      assert.ok(declaredPaths.has(item.path) && resources.has(item.path));
      assert.match(item.path, /^(references|examples)\//);
      assert.ok(!item.path.includes('..'));
      for (const id of [...item.related ?? [], ...item.references ?? []]) assert.ok(entries.has(id), `${item.id} -> ${id}`);
    }
  }
  const discovered = researchMethods({ limit: 50 });
  const pending = [...discovered.items, ...discovered.resources].map(item => item.id);
  const reachable = new Set();
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (reachable.has(id)) continue;
    reachable.add(id);
    const entry = entries.get(id);
    pending.push(...entry.related ?? [], ...entry.references ?? []);
  }
  assert.deepEqual([...entries.keys()].filter(id => !reachable.has(id)), [], 'Every resource needs a route from normal discovery');
});

test('Read rejects undeclared paths and oversized batches and honors cancellation', async () => {
  for (const args of [null, [], { query: 1 }, { limit: 0 }, { limit: 51 }, { limit: 1.5 }, { extra: true }, { query: 'a'.repeat(1001) }]) {
    assert.throws(() => researchMethods(args));
  }
  for (const args of [null, {}, { ids: [] }, { ids: Array(6).fill('valuation') }, { ids: ['valuation', 'valuation'] }, { ids: ['../plugin.json'] }, { ids: ['unknown'] }, { ids: ['valuation'], extra: true }]) {
    await assert.rejects(researchRead(args));
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(researchRead({ ids: ['valuation'] }, controller.signal), { name: 'AbortError' });
});

test('All 19 former domains and 352 field roles have live semantic destinations', () => {
  assert.equal(migration.modules.length, 19);
  assert.equal(migration.modules.reduce((sum, item) => sum + item.fields.length, 0), 352);
  for (const domain of migration.modules) {
    for (const id of domain.methods) assert.equal(entries.get(id)?.kind, 'method', `${domain.from} -> ${id}`);
    assert.ok(entries.has(domain.semanticResource));
    for (const [oldKey, destination] of domain.fields) {
      const [id, anchor] = destination.split('#');
      assert.ok(entries.has(id), `${domain.from}.${oldKey} -> ${destination}`);
      if (anchor && id === 'fields-context') assert.ok(content(id).includes(`## ${anchor}`));
      else if (anchor) assert.ok(Object.hasOwn(fields(id), anchor), `${domain.from}.${oldKey} -> ${destination}`);
    }
  }
  for (const entry of catalog.entries.filter(item => item.path.endsWith('.json') && item.id.startsWith('fields-'))) {
    const guide = JSON.parse(content(entry.id));
    assert.equal(guide.context, 'fields-context');
    assert.match(guide.reading, /并非必须计算或填满/);
    for (const [key, value] of Object.entries(guide.fields)) {
      assert.ok(!/_chart$/.test(key));
      for (const property of ['visual', 'type', 'options', 'shape', 'required', 'template', 'component']) assert.equal(Object.hasOwn(value, property), false);
      if (value.historical) assert.equal(value.historical, 'evidence-and-judgment');
    }
    assert.doesNotMatch(content(entry.id), /图注|图例|热力图|start\/delta\/end|Report 不|桥图/);
  }
  for (const entry of catalog.entries) assert.doesNotMatch(content(entry.id), /\b(?:M\d{2}|R\d{2})\b|module-catalog|analysis-questions/);
  assert.doesNotMatch(read('index.js'), /migration|module-catalog|analysis-questions/);
});

test('Former report directions retain their distinct questions without becoming a runtime contract', () => {
  assert.equal(migration.compositions.length, 11);
  assert.equal(migration.compositions.reduce((sum, item) => sum + item.questions.length, 0), 50);
  assert.equal(migration.compositions.reduce((sum, item) => sum + item.referenceQuestions.length, 0), 81);
  for (const composition of migration.compositions) {
    assert.ok(composition.methods.length && composition.questions.length);
    for (const id of composition.methods) assert.equal(entries.get(id)?.kind, 'method');
    for (const item of composition.questions) assert.ok(item.question.length > 5);
    for (const item of composition.referenceQuestions) {
      assert.ok(item.question.length > 5 && item.destinations.length > 0);
      for (const destination of item.destinations) {
        const [id, anchor] = destination.split('#');
        assert.ok(entries.has(id), `${composition.from}: ${item.question} -> ${id}`);
        if (anchor && id === 'fields-context') assert.ok(content(id).includes(`## ${anchor}`));
        else if (anchor) assert.ok(Object.hasOwn(fields(id), anchor), `${id}#${anchor}`);
      }
    }
  }
  for (const id of ['valuation', 'market-state', 'allocation-rebalance', 'opportunity-and-calendar']) {
    assert.ok(migration.compositions.some(item => item.methods.includes(id)), id);
  }
});

test('Evidence and financial semantics survive migration without making every test compulsory', () => {
  for (const principle of migration.principles) for (const term of principle.terms) {
    assert.ok(content(principle.target).includes(term), `${principle.id}: ${term}`);
  }
  const volatility = fields('fields-volatility-pricing');
  assert.match(JSON.stringify(volatility.iv_rank), /最低|最小|极值/);
  assert.match(JSON.stringify(volatility.iv_percentile), /比例|占比|百分位/);
  assert.match(content('evidence-and-judgment'), /历史条件频率.*风险中性.*校准/);
  assert.match(JSON.stringify(fields('fields-forecast-record').original), /当时|事前|原始/);
  assert.match(content('factor-evaluation'), /因子值.*信号.*策略/);
  assert.match(content('factor-evaluation'), /因子库.*因子池/);
  assert.match(content('review-and-recovery'), /不阻塞/);
  assert.match(content('strategy-evaluation'), /完整参数试验/);
});

test('Task-specific answer structures support mixed, novel and visual-only requests', () => {
  const examples = json('examples/adaptation.json');
  assert.equal(examples.length, 8);
  assert.equal(new Set(examples.map(item => item.spine)).size, examples.length);
  assert.ok(examples.some(item => item.methods.length >= 3));
  assert.ok(examples.some(item => item.methods.length === 0 && item.spine.includes('Reports')));
  assert.ok(examples.some(item => item.omit.includes('目录未命中就停止')));
  for (const item of examples) for (const id of item.methods) assert.equal(entries.get(id)?.kind, 'method');
  const methodContents = catalog.entries.filter(item => item.kind === 'method').map(item => content(item.id));
  assert.equal(new Set(methodContents).size, 21);
  assert.match(content('earnings-preview'), /事前|公布前/);
  assert.match(content('earnings-review'), /实际.*预期/);
  assert.match(content('adapt-and-compose'), /主回答线/);
  assert.match(content('adapt-and-compose'), /不拼接|不是.*拼接|避免拼接/);
});

test('The shipping package is clean, self-contained and passes the existing package builder', t => {
  const source = mkdtempSync(join(tmpdir(), 'sesame-research-package-'));
  t.after(() => {
    assert.equal(dirname(resolve(source)), resolve(tmpdir()));
    assert.ok(source.startsWith(join(tmpdir(), 'sesame-research-package-')));
    rmSync(source, { recursive: true, force: true });
  });
  mkdirSync(join(source, 'packages'));
  cpSync(root, join(source, 'packages/research'), { recursive: true });
  const lock = buildLock(source);
  assert.equal(lock.packages.length, 1);
  assert.equal(lock.packages[0].id, 'sesame/research');
  const files = packageFiles(root);
  assert.ok(files.every(file => !/migration|legacy|archive|backup|module-catalog|analysis-questions/.test(file.path)));
  assert.ok(files.every(file => file.bytes < 128 * 1024));
  assert.deepEqual(readdirSync(join(root, 'skills')), ['research']);
  assert.ok(read('prompt.md').length < 1000);
  assert.ok(read('skills/research/SKILL.md').length < 2000);
});
