import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { reportHTML } from '../report.js';

for (const kind of ['demo', 'derived', null]) {
  test(`report labels ${kind ?? 'unspecified'} input without inventing historical or role execution`, async () => {
    const script = [...reportHTML().matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
    let initialized, rendered;
    runInNewContext(script, {
      reportKit: {
        rows: async () => [
          { type: 'summary', status: 'created_paused', model: null, decisionCount: 0, fillCount: 0 },
          { type: 'source', provenance: kind ? { kind } : {}, digests: {} },
        ],
        render: (_selector, report) => { rendered = report; },
      },
      window: { report: { track: promise => (initialized = promise) } },
      document: { getElementById: () => ({ textContent: '' }) },
    });
    await initialized;
    assert.ok(rendered);
    assert.doesNotMatch(rendered.subtitle, /真实历史行情|真实角色/);
    assert.equal(rendered.method.sources[0].label, kind === 'demo' ? '演示数据与哈希' : '数据来源与哈希');
    if (kind === 'demo') assert.match(rendered.subtitle, /演示合成行情/);
  });
}
