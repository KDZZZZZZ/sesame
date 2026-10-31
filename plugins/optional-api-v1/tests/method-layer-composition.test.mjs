import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../packages/', import.meta.url);
const methods = ['behavioral-finance', 'dow-theory', 'elliott-wave', 'ict', 'institutional-analysis', 'narrative-analysis', 'price-action', 'wyckoff'];
const abu = JSON.parse(await readFile(new URL('../abu-plugins.json', import.meta.url), 'utf8'));
const read = (name, file) => readFile(new URL(`${name}/${file}`, root), 'utf8');

test('method knowledge can be selected by a workflow and returns a local finding instead of starting another full research process', async () => {
  for (const name of methods) {
    const prompt = await read(name, 'prompt.md');
    const skill = await read(name, `skills/${name}/SKILL.md`);
    const declaration = JSON.parse(await read(name, 'capabilities.json'));
    assert.doesNotMatch(prompt + skill, /仅在用户选择本方法|不自动加载其它方法|不加载其它方法|只执行用户指定/);
    assert.match(prompt, /工作流/);
    assert.match(skill, /已有.*证据|已固定.*证据/);
    assert.match(skill, /反证/);
    assert.match(skill, /缺口/);
    assert.match(skill, /调用者/);
    assert.match(skill, /pluginId/);
    assert.match(skill, /part: ?"resource"/);
    assert.doesNotMatch(skill, /plugin_id=/);
    const entry = declaration.knowledge.find(item => item.kind === 'skill');
    assert.match(entry.description, /输入/);
    assert.match(entry.description, /输出/);
    assert.deepEqual(declaration.capabilities, [], 'knowledge methods must not advertise invented executable tools');
  }
});

test('optional observation scripts use current public evidence and execution field names', async () => {
  for (const name of ['ict', 'price-action']) {
    const guide = await read(name, `skills/${name}/references/execution.md`);
    assert.doesNotMatch(guide, /dataset_id|execution_id|exit_code|snapshot_errors|input_ids|recipe_paths|ref\/raw/);
    assert.match(guide, /data_read\(\{ref/);
    assert.match(guide, /executionId/);
    assert.match(guide, /inputRefs/);
    assert.match(guide, /recipePaths/);
    assert.match(guide, /observedAt\.to/);
  }
});

test('all numerical methods declare how to reuse evidence and return it without duplicate independent votes', async () => {
  for (const { directory } of abu) {
    const declaration = JSON.parse(await read(directory, 'capabilities.json'));
    const { usage } = declaration.capabilities[0];
    assert.match(usage.outputs, /调用者/);
    assert.match(usage.outputs, /input_artifact/);
    assert.match(usage.outputs, /result_artifact/);
    assert.match(usage.limitations.join('\n'), /同源.*独立证据/);
    assert.match(await read(directory, 'prompt.md'), /复用/);
  }
});

test('the documented ATR reuse has identical values and availability on one fixed input', async () => {
  const { analyze: indicators } = await import('../packages/abu-indicators/scripts/baseline.mjs');
  const { analyze: volatility } = await import('../packages/abu-volatility/scripts/baseline.mjs');
  const input = JSON.parse(await read('abu-indicators', 'examples/input.json'));
  const before = structuredClone(input);
  const atr = result => result.observations.series.map(({ time, available_at, atr }) => ({ time, available_at, atr }));
  const left = indicators({ ...input, parameters: { atr_window: 3 } });
  const right = volatility({ ...input, parameters: { atr_window: 3 } });
  assert.deepEqual(atr(left), atr(right));
  assert.deepEqual(input, before, 'a shared evidence input stays unchanged across methods');
  assert.ok(atr(left).some(row => row.atr === null), 'warmup absence stays visible during composition');
});

test('the evaluator guide states its nested consumer boundary without dictating the caller workflow or final report', async () => {
  const prompt = await read('factor-evaluator', 'prompt.md');
  const protocol = await read('factor-evaluator', 'PROTOCOL.md');
  assert.match(prompt, /nested|嵌套/);
  assert.match(prompt, /caller|调用者/);
  assert.doesNotMatch(protocol, /Research Agent tasks use output:none|native controller publishes one final report/);
  assert.match(protocol, /workflow.*owns|caller.*owns/i);
});
