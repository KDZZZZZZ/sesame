import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const host = process.env.SESAME_HOST_ROOT;
const root = new URL('../packages/reports/', import.meta.url);
// Deliberately non-financial demonstration records: no invented market data.
const fixture = {
  kind: 'decision-tree', title: '演示：资料核验决策树',
  rows: [
    { id: 'root', parentId: null, label: '核验本阶段引用的资料', detail: '演示用例：先对照原始记录，判断引用的证据与适用范围。' },
    { id: 'match', parentId: 'root', condition: '原始记录与引用文字一致，记录时间可以核对', label: '时间、样本和定义是否一致？', detail: '对照原始记录与引用对象。\n保留核验使用的来源版本。' },
    { id: 'mismatch', parentId: 'root', condition: '如果原始记录与引用不同', label: '回到资料来源重新核对', detail: '保留原始差异，不把不一致解释成任何市场信号。' },
    { id: 'missing', parentId: 'root', condition: '暂时无法取得完整原文', label: '记录待补材料，暂停引用', detail: '待补项目：原始来源、记录时间、引用段落。' },
    { id: 'usable', parentId: 'match', condition: '如果记录时间、样本和定义都能对齐', label: '保留为本阶段证据', detail: 'Follow the documented source revision and preserve every relevant condition. LongIdentifierWithoutAnySpacesMustWrapWithoutBeingClippedOrHiddenFromTheReader' },
    { id: 'bounds', parentId: 'match', condition: '定义或样本范围不同', label: '记录差异，修正引用范围', detail: '这是一段用于验证完整换行的长中文说明：完整记录资料名称、来源版本、样本定义与已查明的引用差异，方便读者沿着证据链核对本阶段处理结果。' },
  ],
};

test('compact decision trees retain full topology, zoom/pan without changing rows, and print the complete tree', { skip: !host, timeout: 90000 }, async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const [base, extension, css] = await Promise.all([
    readFile(new URL('assets/editorial-charts.js', root), 'utf8'),
    readFile(new URL('assets/charts-decision.js', root), 'utf8'),
    readFile(new URL('assets/editorial.css', root), 'utf8'),
  ]);
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, hasTouch: true }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<html lang="zh-CN"><head></head><body><main id="chart"></main></body></html>');
  await page.addStyleTag({ content: css });
  await page.addStyleTag({ content: 'body{padding:24px}#chart{max-width:1040px;margin:auto}' });
  await page.addScriptTag({ content: base }); await page.addScriptTag({ content: extension });
  const draw = spec => page.evaluate(spec => {
    window.decisionHandle?.destroy(); window.decisionSelections = []; window.decisionSpec = spec;
    spec.rows.forEach(Object.freeze); Object.freeze(spec.rows);
    window.decisionOriginal = JSON.stringify(spec);
    window.decisionHandle = SesameCharts.chart('#chart', { ...spec, onSelect(row, index) { window.decisionSelections.push({ row, index, original: row === spec.rows[index] }); } });
    if (JSON.stringify(spec) !== window.decisionOriginal) throw Error('Renderer mutated fixed rows');
  }, spec);
  const reject = async (rows, pattern) => {
    const message = await page.evaluate(rows => { try { SesameCharts.chart('#chart', { kind: 'decision-tree', rows }); return null; } catch (error) { return error.message; } }, rows);
    assert.match(message, pattern);
  };
  assert.ok(await page.evaluate(() => SesameCharts.kinds().includes('decision-tree')));
  await draw(fixture);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('[data-decision-kind=node] [data-decision-part=condition]').count(), 0, 'Entry conditions belong to branches outside result boxes');
  assert.equal(await page.locator('[data-decision-kind=condition]').count(), fixture.rows.filter(row => row.condition).length);
  assert.equal(await page.locator('[data-decision-kind=node]').count(), fixture.rows.length);
  const links = await page.locator('[data-decision-kind=link]').evaluateAll(items => items.map(item => [item.dataset.sourceId, item.dataset.targetId]));
  assert.deepEqual(links, [['root', 'match'], ['match', 'usable'], ['match', 'bounds'], ['root', 'mismatch'], ['root', 'missing']]);
  await page.locator('[data-node-id=usable]').focus(); await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => decisionSelections.at(-1)), { row: fixture.rows[4], index: 4, original: true });
  await page.locator('[data-node-id=bounds]').focus(); await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => decisionSelections.at(-1).index), 5);
  await page.getByRole('button', { name: '显示全貌' }).click();
  await page.locator('[data-node-id=mismatch]').click();
  assert.equal(await page.evaluate(() => decisionSelections.at(-1).index), 2);
  await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement?.blur());

  async function assertGeometry(label) {
    const result = await page.evaluate(() => {
      const svg = document.querySelector('#chart svg'), view = svg.viewBox.baseVal;
      const nodes = Array.from(svg.querySelectorAll('[data-decision-kind=node]'));
      const boxes = nodes.map(group => { const b = group.querySelector('rect').getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
      const bad = [];
      const conditionBoxes = Array.from(svg.querySelectorAll('[data-decision-kind=condition]')).map(group => {
        const b = group.getBBox();
        const element = group.querySelector('text');
        if (parseFloat(getComputedStyle(element).fontSize) < 11.9) bad.push('condition text shrunk instead of viewport zoom');
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      });
      conditionBoxes.forEach((a, i) => {
        if (a.x < 0 || a.y < 0 || a.x + a.w > view.width + .2 || a.y + a.h > view.height + .2) bad.push(`condition outside view: ${i}`);
        [...boxes, ...conditionBoxes.slice(i + 1)].forEach(b => {
          if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > .2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > .2) bad.push(`condition overlaps box or condition: ${i}`);
        });
      });
      boxes.forEach((a, i) => {
        if (a.x < 0 || a.y < 0 || a.x + a.w > view.width + .2 || a.y + a.h > view.height + .2) bad.push(`box outside view: ${i}`);
        boxes.forEach((b, j) => { if (i < j && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > .2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > .2) bad.push(`overlap: ${i},${j}`); });
        for (const element of nodes[i].querySelectorAll('text')) {
          const textBox = element.getBBox(), size = parseFloat(getComputedStyle(element).fontSize);
          if (size < 11.9) bad.push(`unreadable text: ${i}`);
          if (textBox.x < a.x - .2 || textBox.y < a.y - .2 || textBox.x + textBox.width > a.x + a.w + .2 || textBox.y + textBox.height > a.y + a.h + .2) bad.push(`clipped text: ${i}`);
        }
      });
      for (const path of svg.querySelectorAll('[data-decision-kind=link],[data-decision-kind=condition-link]')) {
        const length = path.getTotalLength();
        for (let i = 1; i < 200; i++) {
          const p = path.getPointAtLength(length * i / 200);
          if (boxes.some(b => p.x > b.x + .3 && p.x < b.x + b.w - .3 && p.y > b.y + .3 && p.y < b.y + b.h - .3)) { bad.push(`link crosses node: ${path.dataset.targetId}`); break; }
          if (conditionBoxes.some(b => p.x > b.x + .3 && p.x < b.x + b.w - .3 && p.y > b.y + .3 && p.y < b.y + b.h - .3)) { bad.push(`link crosses condition: ${path.dataset.targetId}`); break; }
        }
      }
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('page overflows horizontally');
      if (/(NaN|Infinity)/.test(svg.outerHTML)) bad.push('non-finite geometry');
      const normalize = value => value.replace(/\s/gu, '');
      for (const record of decisionSpec.rows) for (const part of ['label', 'condition', 'detail']) {
        if (!record[part]) continue;
        const element = part === 'condition'
          ? Array.from(svg.querySelectorAll('[data-decision-kind=condition]')).find(n => n.dataset.targetId === record.id)?.querySelector('text')
          : nodes.find(n => n.dataset.nodeId === record.id)?.querySelector(`[data-decision-part=${part}]`);
        if (!element || normalize(element.textContent) !== normalize(record[part])) bad.push(`missing full text: ${record.id}.${part}`);
      }
      if (JSON.stringify(decisionSpec) !== decisionOriginal) bad.push('source rows changed');
      return { bad, layout: svg.dataset.decisionLayout, sameSvgHandle: decisionHandle.svg === svg };
    });
    assert.deepEqual(result.bad, [], label); assert.equal(result.sameSvgHandle, true);
    return result.layout;
  }
  for (const width of [1100, 850, 390, 360]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, theme);
    const expected = 'horizontal';
    await page.waitForFunction(expected => {
      const chart = document.querySelector('#chart'), svg = chart.querySelector('svg');
      return svg?.dataset.decisionLayout === expected && svg.dataset.decisionStyle === 'compact' && Math.abs(svg.getBoundingClientRect().width - chart.clientWidth) <= 1;
    }, expected);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await assertGeometry(`${width}px ${theme}`), expected);
    const naturalSize = await page.evaluate(() => {
      document.querySelector('.sc-decision-viewport').dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
      return [...document.querySelectorAll('[data-decision-part]')].every(el => parseFloat(getComputedStyle(el).fontSize) * el.getScreenCTM().a >= 11.9);
    });
    assert.equal(naturalSize, true, '100% restores readable type regardless of viewport width');
    await page.getByRole('button', { name: '显示全貌' }).click();
    if (process.env.SESAME_DECISION_SCREENSHOTS) {
      await mkdir(process.env.SESAME_DECISION_SCREENSHOTS, { recursive: true });
      await page.locator('#chart').screenshot({ path: join(process.env.SESAME_DECISION_SCREENSHOTS, `decision-tree-${width}-${theme}.png`) });
    }
  }
  const viewState = () => page.locator('svg').evaluate(svg => ({ zoom: Number(svg.dataset.decisionZoom), pan: svg.dataset.decisionPan }));
  const fit = await viewState();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  assert.ok((await viewState()).zoom > fit.zoom);
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  assert.ok(Math.abs((await viewState()).zoom - fit.zoom) < .0001);
  const viewport = page.locator('.sc-decision-viewport');
  await viewport.scrollIntoViewIfNeeded();
  const bounds = await viewport.boundingBox(), anchor = { x: Math.round(bounds.x + bounds.width * .65), y: Math.round(bounds.y + bounds.height * .45) };
  const anchorPoint = () => page.locator('.sc-decision-scene').evaluate((g, p) => {
    const point = new DOMPoint(p.x, p.y).matrixTransform(g.getScreenCTM().inverse()); return { x: point.x, y: point.y };
  }, anchor);
  const beforeAnchor = await anchorPoint();
  await page.mouse.move(anchor.x, anchor.y); await page.mouse.wheel(0, -180);
  await page.waitForFunction(initial => Number(document.querySelector('svg').dataset.decisionZoom) > initial, fit.zoom);
  const afterAnchor = await anchorPoint();
  assert.ok(Math.hypot(beforeAnchor.x - afterAnchor.x, beforeAnchor.y - afterAnchor.y) < .1, `wheel zoom remains anchored at the cursor: ${JSON.stringify({beforeAnchor,afterAnchor})}`);
  const beforeDrag = await viewState(), selectionCount = await page.evaluate(() => decisionSelections.length);
  await page.mouse.move(bounds.x + 18, bounds.y + 18); await page.mouse.down();
  await page.mouse.move(bounds.x + 75, bounds.y + 50, { steps: 5 }); await page.mouse.up();
  assert.notEqual((await viewState()).pan, beforeDrag.pan);
  assert.equal(await page.evaluate(() => decisionSelections.length), selectionCount, 'panning never selects a row');
  await viewport.focus(); await page.keyboard.press('0');
  assert.deepEqual(await viewState(), fit, 'keyboard reset restores the complete tree');
  await page.keyboard.press('1'); assert.ok(Math.abs((await viewState()).zoom - 1) < .0001);
  await page.keyboard.press('ArrowLeft'); assert.notEqual((await viewState()).pan, fit.pan);
  await page.keyboard.press('0');
  // Real Chromium touch input: pinch/pan affects only the viewport.
  const cdp = await page.context().newCDPSession(page);
  const touch = (offset, y = 0) => [{ x: anchor.x - offset, y: anchor.y + y, id: 1 }, { x: anchor.x + offset, y: anchor.y + y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(22) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(44, 20) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok((await viewState()).zoom > fit.zoom * 1.5, 'two-finger gesture zooms');
  assert.equal(await page.evaluate(() => decisionSelections.length), selectionCount);
  await cdp.detach();
  await page.emulateMedia({ media: 'print' });
  const print = await page.evaluate(() => {
    const svg = document.querySelector('svg'), b = svg.getBoundingClientRect(), scene = svg.querySelector('.sc-decision-scene');
    return { transform: getComputedStyle(scene).transform, controls: getComputedStyle(document.querySelector('.sc-decision-controls')).display,
      allVisible: [...scene.querySelectorAll('[data-decision-kind="node"],[data-decision-kind="condition"]')].every(n => { const r = n.getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1; }) };
  });
  assert.deepEqual(print, { transform: 'none', controls: 'none', allVisible: true }, 'printing ignores interactive pan/zoom and includes every branch');
  await page.emulateMedia({ media: 'screen' });
  // A partially visible node must not jump when pointer focus precedes drag.
  await viewport.focus(); await page.keyboard.press('1');
  await page.locator('[data-node-id=root]').focus();
  await viewport.focus(); await page.keyboard.press('ArrowRight');
  const rootRect = page.locator('[data-node-id=root] rect'), partiallyVisible = await rootRect.boundingBox();
  const visible = await viewport.boundingBox();
  assert.ok(partiallyVisible.x < visible.x && partiallyVisible.x + partiallyVisible.width > visible.x + 10);
  await page.mouse.move(visible.x + 10, partiallyVisible.y + partiallyVisible.height / 2);
  await page.mouse.down();
  assert.ok(Math.abs((await rootRect.boundingBox()).x - partiallyVisible.x) < .1, 'pointer focus must not recenter an in-progress gesture');
  await page.mouse.move(visible.x + 25, partiallyVisible.y + partiallyVisible.height / 2, { steps: 3 }); await page.mouse.up();
  assert.ok(Math.abs((await rootRect.boundingBox()).x - partiallyVisible.x - 15) < 1, 'node follows the pointer continuously');
  assert.equal(await page.evaluate(() => decisionSelections.length), selectionCount, 'dragging a node does not select it');
  // Late fonts update the same chart and destruction removes that callback.
  await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
  await assertGeometry('font reflow');
  await page.evaluate(() => decisionHandle.destroy());
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
  assert.equal(await page.locator('#chart svg').count(), 0, 'destroyed charts do not resurrect on font/viewport changes');
  assert.equal(await page.locator('.sc-decision-controls,.sc-decision-viewport').count(), 0);
  await reject([{ id: 'a', parentId: null }, { id: 'a', parentId: 'a' }], /duplicate/);
  await reject([{ id: 'a', parentId: 'missing' }], /missing/);
  await reject([{ id: 'a', parentId: 'a' }], /self parent/);
  await reject([{ id: 'a', parentId: null }, { id: 'b', parentId: null }], /one root/);
  await reject([{ id: 'a', parentId: null }, { id: 'b', parentId: 'c' }, { id: 'c', parentId: 'b' }], /cycle/);

  await draw({ kind: 'decision-tree', id: 'key', parent: 'previous', label: 'heading', condition: 'trigger', detail: 'notes', rows: [
    { key: 'source', previous: null, heading: '映射标题', notes: '映射说明' },
    { key: 'child', previous: 'source', trigger: '映射条件', heading: '后续节点', notes: '完整保留说明' },
  ] });
  assert.equal(await page.locator('[data-decision-kind=condition][data-target-id=child] [data-decision-part=condition]').textContent(), '映射条件');
  assert.equal(await page.locator('[data-node-id=child] [data-decision-part=condition]').count(), 0);
  assert.match(await page.locator('[data-node-id=child]').getAttribute('aria-label'), /映射条件/);
  await page.locator('[data-node-id=child]').focus(); await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => decisionSelections.at(-1)), { row: { key: 'child', previous: 'source', trigger: '映射条件', heading: '后续节点', notes: '完整保留说明' }, index: 1, original: true });
  const pdf = await page.pdf({ format: 'A4', printBackground: true }); assert.ok(pdf.length > 1000, 'static SVG can be printed without a chart runtime interaction');
  assert.deepEqual(errors, []);
});

test('recorded R03 eight-node tree stays horizontal at1000/720/390 and keeps its relationships, text and following appendix', { skip: !host, timeout: 30000 }, async t => {
  // Exact presentational rows from the published R03 report, revision_df725202.
  // These are recorded conditions, not simulated market data or new analysis.
  const rows = [
    { id: 'root', parentId: null, label: '官方时间、环境与同口径价格是否齐备？' },
    { id: 'missing', parentId: 'root', condition: '不齐备', label: '补齐证据，暂不类比' },
    { id: 'd1', parentId: 'root', condition: '齐备', label: '后1天价格是否高于公告前？' },
    { id: 'notup', parentId: 'd1', condition: '否', label: '分别记录后续反转与风险环境', detail: '首日下跌不能机械推断第5天结果。' },
    { id: 'd5', parentId: 'd1', condition: '是', label: '后5天是否仍高于公告前？' },
    { id: 'maintain', parentId: 'd5', condition: '是', label: '保留两期限净上涨的描述', detail: '不转化为未来概率或连续上涨证明。' },
    { id: 'reverse', parentId: 'd5', condition: '否', label: '停用延续上涨的描述' },
    { id: 'wait', parentId: 'd5', condition: '观察期未结束', label: '等待第5天观察点' },
  ];
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<html lang="zh-CN"><body><main><section id="chart"></section><section id="following">后续判断保持原位</section><section id="appendix"><details><summary>证据附录</summary>原始记录</details></section></main></body></html>');
  await page.addStyleTag({ content: await readFile(new URL('assets/editorial.css', root), 'utf8') });
  await page.addStyleTag({ content: 'body{padding:24px 48px}body>main{max-width:904px;margin:auto}@media(max-width:720px){body{padding:24px 36px}}@media(max-width:600px){body{padding:18px}}' });
  for (const file of ['assets/editorial-charts.js', 'assets/charts-decision.js']) await page.addScriptTag({ content: await readFile(new URL(file, root), 'utf8') });
  await page.evaluate(rows => {
    window.recordedRows = rows; rows.forEach(Object.freeze); Object.freeze(rows); window.selections = [];
    SesameCharts.chart('#chart', { kind: 'decision-tree', title: '条件与后续行动', height: 430, rows, onSelect(row, index) { selections.push({ row, index, original: row === rows[index] }); } });
  }, rows);
  for (const width of [1000, 720, 390, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    const expected = 'horizontal';
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(() => {
      const svg = document.querySelector('svg'), bounds = svg.getBoundingClientRect(), normalize = x => x.replace(/\s/gu, '');
      const parts = [...svg.querySelectorAll('[data-decision-part]')];
      return {
        links: [...svg.querySelectorAll('[data-decision-kind=link]')].map(p => [p.dataset.sourceId, p.dataset.targetId]),
        nodes: svg.querySelectorAll('[data-decision-kind=node]').length,
        completeText: recordedRows.every(row => ['label', 'condition', 'detail'].every(part => {
          if (!row[part]) return true;
          const selector = part === 'condition' ? `[data-decision-kind=condition][data-target-id="${row.id}"] text` : `[data-node-id="${row.id}"] [data-decision-part="${part}"]`;
          return normalize(svg.querySelector(selector)?.textContent ?? '') === normalize(row[part]);
        })),
        minFont: Math.min(...parts.map(p => parseFloat(getComputedStyle(p).fontSize) * p.getScreenCTM().a)),
        allInView: parts.every(p => { const b = p.getBoundingClientRect(); return b.left >= bounds.left && b.right <= bounds.right + .2 && b.top >= bounds.top && b.bottom <= bounds.bottom + .2; }),
        followingTop: document.querySelector('#following').getBoundingClientRect().top,
        appendixTop: document.querySelector('#appendix').getBoundingClientRect().top,
        chartBottom: document.querySelector('#chart').getBoundingClientRect().bottom,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        rows: recordedRows,
        layout: svg.dataset.decisionLayout,
        chartWidth: bounds.width,
      };
    });
    assert.deepEqual(result.links, rows.filter(r => r.parentId).map(r => [r.parentId, r.id]));
    assert.equal(result.nodes, 8); assert.equal(result.completeText, true); assert.equal(result.allInView, true); assert.equal(result.overflow, false);
    assert.ok(result.followingTop >= result.chartBottom - 1 && result.appendixTop >= result.followingTop, 'Growing the chart preserves normal document/appendix order');
    assert.deepEqual(result.rows, rows);
    assert.equal(result.chartWidth, width === 720 ? 648 : width === 390 ? 354 : 904);
    assert.equal(result.layout, expected);
    if (process.env.SESAME_DECISION_SCREENSHOTS) {
      await mkdir(process.env.SESAME_DECISION_SCREENSHOTS, { recursive: true });
      await page.locator('#chart').screenshot({ path: join(process.env.SESAME_DECISION_SCREENSHOTS, `decision-tree-R03-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForFunction(() => Math.abs(document.querySelector('#chart svg').getBoundingClientRect().width - 354) < 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('[data-node-id=maintain]').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => selections.at(-1)), { row: rows[5], index: 5, original: true });
  assert.deepEqual(await page.locator('[data-decision-kind=node].sc-decision-active').evaluateAll(nodes => nodes.map(n => n.dataset.nodeId)), ['root', 'd1', 'd5', 'maintain']);
  assert.deepEqual(errors, []);
});

test('narrow and short viewports keep the same horizontal tree without a second layout', { skip: !host, timeout: 30000 }, async t => {
  const rows = [
    { id: 'root', parentId: null, label: '核对？' },
    { id: 'yes', parentId: 'root', condition: '是', label: '保留' },
    { id: 'no', parentId: 'root', condition: '否', label: '待补' },
  ]; // Non-financial component fixture.
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.setContent('<html lang="zh-CN"><body><main id="chart"></main></body></html>');
  await page.addStyleTag({ content: await readFile(new URL('assets/editorial.css', root), 'utf8') });
  await page.addStyleTag({ content: 'body{padding:24px 48px}@media(max-width:720px){body{padding:24px 36px}}@media(max-width:600px){body{padding:18px}}' });
  for (const file of ['assets/editorial-charts.js', 'assets/charts-decision.js']) await page.addScriptTag({ content: await readFile(new URL(file, root), 'utf8') });
  await page.evaluate(rows => {
    window.shortRows = rows; rows.forEach(Object.freeze); Object.freeze(rows);
    window.shortTree = SesameCharts.chart('#chart', { kind: 'decision-tree', rows, height: 200 });
  }, rows);
  for (const width of [1000, 720, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.locator('svg').evaluate(svg => ({
      layout: svg.dataset.decisionLayout,
      boxes: [...svg.querySelectorAll('[data-decision-kind=node] rect')].map(r => { const b = r.getBBox(); return [b.x, b.y, b.width, b.height]; }),
      minimumFont: Math.min(...[...svg.querySelectorAll('[data-decision-part]')].map(p => parseFloat(getComputedStyle(p).fontSize) * p.getScreenCTM().a)),
    }));
    assert.equal(result.layout, 'horizontal', 'Readable horizontal layouts do not depend on a width breakpoint');
    assert.deepEqual(result.boxes, [[24,54,112,40],[212,24,112,40],[212,84,112,40]], 'Existing horizontal layout coordinates stay unchanged');
    assert.ok(result.minimumFont >= 11.9);
  }
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.evaluate(() => { shortTree.destroy(); shortTree = SesameCharts.chart('#chart', { kind: 'decision-tree', rows: shortRows, height: 120 }); });
  const compactHeight = await page.locator('svg').evaluate(svg => ({ layout: svg.dataset.decisionLayout, height: svg.getBoundingClientRect().height, minimumFont: Math.min(...[...svg.querySelectorAll('[data-decision-part]')].map(p => parseFloat(getComputedStyle(p).fontSize) * p.getScreenCTM().a)) }));
  assert.equal(compactHeight.layout, 'horizontal'); assert.equal(compactHeight.height, 120);
  assert.deepEqual(await page.locator('svg [data-decision-kind=node] rect').evaluateAll(items => items.map(r => { const b = r.getBBox(); return [b.x, b.y, b.width, b.height]; })), [[24,54,112,40],[212,24,112,40],[212,84,112,40]]);
  assert.deepEqual(await page.evaluate(() => shortRows), rows);
});

test('report_template inlines the decision tree and reads its fixed rows through the report/1 bridge', { skip: !host, timeout: 60000 }, async t => {
  const { createCapabilities } = await import('../packages/reports/index.js');
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const writes = [];
  const template = createCapabilities({ capabilities: { invoke: async (id, input) => {
    assert.equal(id, 'sesame/workspace#write'); writes.push(input);
    return { type: 'result', value: { path: input.path } };
  } } }).find(item => item.name === 'report_template');
  const result = await template.execute({
    output_path: 'decision-tree-demo.html', title: fixture.title, locale: 'zh-CN', demo: true,
    summary: '核验资料后，再决定下一步。组件演示，不含市场研究数据。',
    data_id: 'fixed-decision-demo', chart_title: '条件、后续观察与失效',
    takeaway: '每一分支只表示已写明的条件关系，不表示概率或权重。', source_note: '固定的非金融组件演示节点。',
    kind: 'decision-tree', chart_options: { id: 'id', parent: 'parentId', label: 'label', condition: 'condition', detail: 'detail' },
    columns: ['id', 'parentId', 'condition', 'label', 'detail'],
  });
  assert.equal(result.binding, 'fixed-decision-demo'); assert.equal(writes.length, 1);
  assert.match(writes[0].content, /SesameCharts\.register\('decision-tree'/);
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(rows => {
    window.fixedRows = rows; rows.forEach(Object.freeze); Object.freeze(rows);
    window.bridgeReads = [];
    window.report = {
      async readData(dataId, options) {
        if (dataId !== 'fixed-decision-demo') throw Error('Unexpected data binding');
        window.bridgeReads.push({ dataId, cursor: options.cursor ?? null });
        return options.cursor === 'second-page' ? { rows: rows.slice(3), page: {} } : { rows: rows.slice(0, 3), page: { nextCursor: 'second-page' } };
      },
      track(promise) { window.reportReady = promise; return promise; },
    };
  }, fixture.rows);
  await page.setContent(writes[0].content);
  await page.evaluate(() => window.reportReady);
  assert.equal(await page.locator('[data-decision-kind=node]').count(), fixture.rows.length);
  assert.equal(await page.locator('[data-decision-kind=link]').count(), fixture.rows.length - 1);
  assert.equal(await page.locator('html').getAttribute('data-report-palette'), null);
  assert.equal(await page.evaluate(() => {
    const probe=document.createElement('i');probe.style.color='var(--report-accent)';document.body.append(probe);
    const color=getComputedStyle(probe).color;probe.remove();return color;
  }), 'rgb(51, 78, 172)', 'Default palette works without root metadata');
  assert.deepEqual(await page.evaluate(() => bridgeReads), [
    { dataId: 'fixed-decision-demo', cursor: null },
    { dataId: 'fixed-decision-demo', cursor: 'second-page' },
  ]);
  assert.deepEqual(await page.evaluate(() => fixedRows), fixture.rows);
  await page.evaluate(() => document.querySelector('.module-chart-plot').addEventListener('chartselect', event => { window.selectedTreeRow = event.detail; }));
  await page.locator('[data-node-id=usable]').focus(); await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => selectedTreeRow), { row: fixture.rows[4], index: 4 });
  const evidence = page.locator('details[data-report-evidence]');
  assert.equal(await evidence.count(), 1);
  await evidence.locator('summary').click();
  assert.equal(await evidence.getAttribute('open'), '');
  assert.deepEqual(JSON.parse(await evidence.locator('pre').textContent()).rows, fixture.rows);
  assert.deepEqual(errors, []);
});
