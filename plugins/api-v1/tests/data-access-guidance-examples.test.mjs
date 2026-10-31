import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Value } from '@sesame/plugin-sdk/schema/value';

const root = new URL('../packages/data-access/', import.meta.url);
test('data guidance examples use the current public capability input contracts', async () => {
  const declarations = JSON.parse(await readFile(new URL('capabilities.json', root), 'utf8'));
  const cases = [
    ['skills/market-discovery/references/source-queries.md', '查询一页：data_query', 'data_query'],
    ['skills/market-discovery/references/source-queries.md', '固定数据：data_snapshot', 'data_snapshot'],
    ['skills/market-discovery/references/market-history.md', '读取历史：market_read', 'market_read'],
    ['skills/analyze-data/references/execution-evidence.md', '读取登记输入：data_read', 'data_read'],
    ['skills/analyze-data/references/execution-evidence.md', '登记计算：research_register', 'research_register'],
  ];
  for (const [path, heading, id] of cases) {
    const content = (await readFile(new URL(path, root), 'utf8')).replaceAll('\r\n', '\n');
    const section = content.split(`### ${heading}\n`)[1]?.split('\n### ')[0];
    const json = /^```json\n([\s\S]*?)^```/m.exec(section ?? '')?.[1];
    assert.ok(json, `${path}: ${heading}`);
    const input = JSON.parse(json);
    assert.equal(Value.Check(declarations.capabilities.find(item => item.id === id).inputSchema, input), true, `${id}: documented arguments must match the actual schema`);
  }
});
