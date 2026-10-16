import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilities as reportTools } from '../packages/reports/index.js';

test('report template escapes authored text and retains only local chart assets and the read-only bridge', async () => {
  // Schema generation is validated by the application. This source test exercises
  // template output with a narrow host port and no private application modules.
  const writes = [];
  const tools = reportTools({ capabilities: { invoke: async (id, input) => { assert.equal(id, 'sesame/workspace#write'); writes.push(input); return { type: 'result', value: { path: input.path } }; } } });
  const template = tools.find(tool => tool.name === 'report_template');
  await template.execute({ output_path: 'report.html', title: '</title><script>invalid()</script>', summary: '<strong>Untrusted text</strong>', data_id: '</script><script>invalid()</script>', chart_title: 'Demo', takeaway: 'Fictional sample', source_note: 'Demo only', kind: 'line', x: 'month', y: 'value', unit: '%', columns: ['month', 'value'], demo: true });
  const html = writes[0].content;
  assert.match(html, /&lt;script&gt;invalid\(\)&lt;\/script&gt;/); assert.match(html, /\\u003c\/script>/);
  assert.doesNotMatch(html, /<script>invalid\(\)/); assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/i);
  assert.match(html, /reportKit\.render/); assert.match(html, /reportKit\.rows\(config.dataId\)/);
  assert.match(html, /kit-verdict-headline/); assert.match(html, /kit-appendix/);
  assert.match(html, /window\.report\.track\(initialize\(\)\)/); assert.match(html, /readData\(dataId/); assert.match(html, /DEMO SAMPLE/);
  await assert.rejects(template.execute({ kind: 'matrix' }), /value column/);
});
