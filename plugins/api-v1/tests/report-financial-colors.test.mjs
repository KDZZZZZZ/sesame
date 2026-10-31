import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderStructuredReport } from '../packages/reports/report-content.js';

// Synthetic software fixtures; these are not market results.
const content = blocks => ({ kind: 'document', sections: [{ title: '颜色测试', blocks }] });
const render = blocks => renderStructuredReport({}, { title: '合成样本', summary: '仅测试显示', locale: 'zh-CN', provenance_kind: 'demo', data: [], content: content(blocks) });

test('financial content colours are explicit and never inferred from labels or formatted numbers', async () => {
  const html = await render([
    { type: 'metrics', items: [{ label: '收益', value: -2.3, tone: 'auto' }, { label: '亏损金额', value: 12, tone: 'negative' }, { label: '回撤', value: 12 }, { label: '持平', value: 0, tone: 'auto' }, { label: '价格', value: 100 }] },
    { type: 'table', columns: ['名称', '收益', '回撤'], column_tones: [null, 'auto', null], rows: [['A', 2, 3], ['B', -2, 0], ['C', null, 0]] },
  ]);
  assert.match(html, /data-tone="negative"><dt>收益<\/dt><dd>-2.3/);
  assert.match(html, /data-tone="negative"><dt>亏损金额<\/dt><dd>12/);
  assert.match(html, /class="report-metric"><dt>回撤<\/dt><dd>12/);
  assert.match(html, /data-tone="neutral"><dt>持平<\/dt><dd>0/);
  assert.match(html, /class="report-metric"><dt>价格/);
  assert.match(html, /<td data-tone="positive">2<\/td><td>3/);
  assert.match(html, /<td data-tone="neutral">—/);
  await assert.rejects(render([{ type: 'metrics', items: [{ label: '收益', value: '+2%', tone: 'auto' }] }]), /numeric value/);
  await assert.rejects(render([{ type: 'table', columns: ['A'], column_tones: ['auto','auto'], rows: [[1]] }]), /match the columns/);
});

test('financial visuals retain red/green across themes, grouped series, zero, heatmaps and loss magnitudes', { skip: !process.env.SESAME_HOST_ROOT, timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(process.env.SESAME_HOST_ROOT, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 720, height: 1100 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const kit = await readFile(new URL('../packages/reports/assets/report-kit.js', import.meta.url), 'utf8');
  await page.setContent(await render([{ type: 'metrics', items: [{ label: '上涨', value: 2, tone: 'auto' }, { label: '下跌', value: -2, tone: 'auto' }, { label: '持平', value: 0, tone: 'auto' }] }]));
  await page.addScriptTag({ content: kit });
  const original = [{ label: 'A', value: -10.123456789012, peer: 6 }, { label: 'B', value: 0, peer: -1 }, { label: 'C', value: 20, peer: null }];
  await page.evaluate(data => {
    window.colourRows = data; data.forEach(Object.freeze); Object.freeze(data);
    for (const [id, kind, tone, y] of [['signed','hbar','signed','value'],['grouped','bar','signed',['value','peer']],['comparison','hbar',undefined,['value','peer']],['loss','hbar','negative','value'],['lossline','line','negative','value'],['signedline','line','signed','value'],['heat','heatmap','signed','label'],['heatplain','heatmap',undefined,'label']]) {
      const target = document.createElement('div'); target.id = id; document.body.append(target);
      reportKit.chart(target, { kind, title: id, caption: '合成样本', data, x: 'label', y, value: 'value', tone });
    }
    for (const [id, values, tone] of [['allgain',[1,2],'signed'],['allloss',[-1,-2],'signed'],['drawdown',[1,2],'neutral'],['drawdownnegative',[-1,-2],'neutral']]) {
      const target = document.createElement('div'); target.id = id; document.body.append(target);
      reportKit.chart(target, { kind:'hbar', title:id, caption:'合成样本', data:values.map((value,i)=>({label:String(i),value})), x:'label', y:'value', tone });
    }
  }, original);
  for (const [theme, gain, loss] of [['light', 'rgb(36, 115, 74)', 'rgb(178, 67, 67)'], ['dark', 'rgb(95, 227, 169)', 'rgb(255, 122, 143)']]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const fills = selector => page.locator(selector).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill));
    const signed = await fills('#signed .kit-bar');
    assert.equal(signed[0], loss); assert.equal(signed[2], gain);
    assert.notEqual(signed[1], gain); assert.notEqual(signed[1], loss);
    assert.deepEqual(await fills('#grouped .kit-bar'), [loss,gain,signed[1],loss,gain]);
    assert.deepEqual(await fills('#loss .kit-bar'), [loss,signed[1],loss]);
    assert.equal(await page.locator('#lossline .kit-line').evaluate(n => getComputedStyle(n).stroke), loss);
    const neutral = await fills('#comparison .kit-bar'); assert.ok(neutral.every(c => c !== gain && c !== loss));
    assert.equal(neutral[0], theme === 'light' ? 'rgb(51, 78, 172)' : 'rgb(155, 179, 255)');
    assert.equal(neutral[1], theme === 'light' ? 'rgb(52, 52, 52)' : 'rgb(228, 228, 231)');
    assert.deepEqual(await fills('#allgain .kit-bar'), [gain,gain], 'All-positive P&L keeps its financial palette');
    assert.deepEqual(await fills('#allloss .kit-bar'), [loss,loss], 'All-negative P&L keeps its financial palette');
    assert.deepEqual(await fills('#drawdown .kit-bar'), [neutral[0],neutral[0]]);
    assert.deepEqual(await fills('#drawdownnegative .kit-bar'), [neutral[0],neutral[0]], 'Changing drawdown signs cannot choose the palette');
    assert.match(await page.locator('#heat .kit-cell').first().getAttribute('fill'), /chart-down/);
    assert.match(await page.locator('#heat .kit-cell').nth(4).getAttribute('fill'), /heat-neutral/);
    assert.match(await page.locator('#heat .kit-cell').last().getAttribute('fill'), /chart-up/);
    assert.doesNotMatch((await page.locator('#heatplain').innerHTML()), /chart-up|chart-down/);
    assert.equal(await page.locator('.report-metric').first().locator('dd').evaluate(n => getComputedStyle(n).color), gain);
    assert.equal(await page.locator('.report-metric').nth(1).locator('dd').evaluate(n => getComputedStyle(n).color), loss);
    assert.deepEqual(await page.evaluate(() => colourRows), original);
  }
  await page.locator('#grouped .kit-legend button').nth(1).click();
  assert.equal(await page.locator('#grouped .kit-bar').count(), 3);
  await page.locator('#grouped .kit-legend button').nth(1).click();
  assert.equal(await page.locator('#grouped .kit-bar').count(), 5);
  assert.deepEqual(errors, []);
});
