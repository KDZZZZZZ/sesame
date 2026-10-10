import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const host = process.env.SESAME_HOST_ROOT;
const root = new URL('../packages/reports/', import.meta.url);
test('structural charts preserve real records, exact conservation, selection, responsive layout and finite drag lifecycle', { skip: !host, timeout: 90000 }, async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const [base, extension, css, fixtureData] = await Promise.all([
    readFile(new URL('assets/editorial-charts.js', root), 'utf8'), readFile(new URL('assets/charts-structure.js', root), 'utf8'),
    readFile(new URL('assets/editorial.css', root), 'utf8'), readFile(new URL('examples/structural-fixtures.json', root), 'utf8').then(JSON.parse),
  ]);
  assert.equal(fixtureData.provenance.kind, 'demo');
  const fixtures = Object.fromEntries(fixtureData.charts.map(chart => [chart.id === 'network-circular' ? 'network' : chart.id, chart.spec]));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<html lang="en"><head></head><body><main id="chart"></main></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: base }); await page.addScriptTag({ content: extension });
  const draw = async spec => page.evaluate(spec => {
    window.structuralHandle?.destroy(); window.structuralSelections = [];
    const original = JSON.stringify(spec);
    window.structuralHandle = SesameCharts.chart('#chart', { ...spec, onSelect: (row, index) => window.structuralSelections.push({ row, index }) });
    if (JSON.stringify(spec) !== original) throw Error('Renderer changed fixed source records');
    return document.querySelector('#chart').innerText;
  }, spec);
  const reject = async (spec, pattern) => {
    const error = await page.evaluate(spec => { try { SesameCharts.chart('#chart', spec); return null; } catch (error) { return error.message; } }, spec);
    assert.match(error, pattern);
  };

  await draw(fixtures.treemap);
  assert.equal(await page.locator('[data-structure-kind=leaf]').count(), 3, 'parents and zero leaves do not create additional areas');
  const alpha = page.locator('[data-record-id=alpha]'); await alpha.focus(); await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => structuralSelections.at(-1)), { row: fixtures.treemap.rows[3], index: 3 });
  assert.match(await alpha.getAttribute('aria-label'), /Gross exposure › Long sleeve › Alpha.*40000.00 USD/);
  const areas = await page.locator('[data-structure-kind=leaf] rect').evaluateAll(elements => elements.map(element => (Number(element.getAttribute('width')) + 1.5) * (Number(element.getAttribute('height')) + 1.5)));
  assert.ok(Math.abs(areas[0] / areas[1] - 4 / 3) < 1e-8); assert.ok(Math.abs(areas[1] / areas[2] - 1) < 1e-8, 'parent labels do not distort leaf areas');
  assert.equal(await page.locator('[data-record-id=gamma]').getAttribute('data-side'), 'short');
  await page.getByText('1 zero-value records', { exact: true }).click();
  await page.getByRole('button', { name: 'Flat position [flat]: 0.00 USD', exact: true }).click();
  assert.equal(await page.evaluate(() => structuralSelections.at(-1).row.value), '0.00');
  await reject({ ...fixtures.treemap, rows: [{ id: 'negative', value: '-1' }] }, /nonnegative/);
  await reject({ ...fixtures.treemap, rows: [{ id: 'missing', value: null }] }, /nonnegative/);
  await reject({ ...fixtures.treemap, rows: [{ id: 'a', value: '1', parentId: 'b' }, { id: 'b', value: '1', parentId: 'a' }] }, /cycle/);
  await reject({ ...fixtures.treemap, rows: [{ id: 'parent', value: '2' }, { id: 'child', parentId: 'parent', value: '1' }] }, /parent total/);
  await reject({ ...fixtures.treemap, rows: [{ id: 'too-small', value: '0.' + '0'.repeat(330) + '1' }] }, /too small/);
  await draw({ kind: 'treemap', rows: [{ id: 'p', value: '0.3' }, { id: 'a', parentId: 'p', value: '0.1' }, { id: 'b', parentId: 'p', value: '0.2' }] });

  await draw(fixtures.threads);
  assert.equal(await page.locator('[data-structure-kind=thread]').count(), 4);
  assert.equal(await page.locator('[data-record-id=route-003] path').count(), 1, 'no fill is invented for an unfilled order');
  assert.equal(await page.locator('[data-record-id=route-004] path').count(), 1, 'a manual order has no invented signal');
  await page.locator('[data-record-id=route-002]').focus(); await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => structuralSelections.at(-1).row.fillId), 'fill-102');
  assert.equal(await page.locator('[data-record-id=route-001]').getAttribute('data-focused'), 'false');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('[data-record-id=route-001]').getAttribute('data-focused'), null);
  await reject({ ...fixtures.threads, rows: [{ recordId: 'bad', signalId: 'a', orderId: 'b' }] }, /explicitly null/);
  await reject({ ...fixtures.threads, rows: [fixtures.threads.rows[0], fixtures.threads.rows[0]] }, /duplicate route/);
  await reject({ ...fixtures.threads, rows: Array.from({ length: 201 }, (_, i) => ({ recordId: String(i), signalId: 'a', orderId: 'b', fillId: 'c' })) }, /200 routes/);

  await draw(fixtures.flow);
  const flowLink = page.locator('[data-record-id=pay-fees]'); await flowLink.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => structuralSelections.at(-1).row.value), '0.10');
  assert.match(await flowLink.getAttribute('aria-label'), /allocation-001.*0.10 USD/);
  const badFlow = structuredClone(fixtures.flow); badFlow.rows[3].value = '0.11'; await reject(badFlow, /conserve exactly/);
  const batches = structuredClone(fixtures.flow); batches.rows[0].batch = 'different'; await reject(batches, /one recorded batch/);
  const noSource = structuredClone(fixtures.flow); delete noSource.nodes[0].role; await reject(noSource, /source\/sink explicitly/);
  await reject({ kind: 'flow', nodes: [{ id: 'a' }, { id: 'b' }], rows: [{ id: 'a-b', source: 'a', target: 'b', value: '1', batch: 'x' }, { id: 'b-a', source: 'b', target: 'a', value: '1', batch: 'x' }] }, /cycle/);
  const precise = { kind: 'flow', nodes: [{ id: 's', role: 'source' }, { id: 'p' }, { id: 'a', role: 'sink' }, { id: 'b', role: 'sink' }], rows: [{ id: 'i', source: 's', target: 'p', value: '0.3', batch: 'x' }, { id: 'a', source: 'p', target: 'a', value: '0.1', batch: 'x' }, { id: 'b', source: 'p', target: 'b', value: '0.2', batch: 'x' }] };
  await draw(precise);
  assert.match(await draw({ ...fixtures.flow, rows: [] }), /No observed flows/);

  for (const kind of ['network-circular', 'network-force']) {
    await draw({ kind, nodes: [{ id: 'isolated' }], rows: [] });
    assert.equal(await page.locator('[data-node-id=isolated]').count(), 1, 'actual isolated nodes remain visible even with no links');
    await draw({ ...fixtures.network, kind });
    assert.equal(await page.locator('[data-structure-kind=network-node]').count(), fixtures.network.nodes.length);
    assert.equal(await page.locator('[data-structure-kind=network-link]').count(), fixtures.network.rows.length);
    await page.locator('[data-node-id=a]').focus(); await page.keyboard.press('Enter');
    const selected = await page.evaluate(() => structuralSelections.at(-1)); assert.equal(selected.index, -1); assert.deepEqual(selected.row, fixtures.network.nodes[0]);
    assert.equal(await page.locator('[data-record-id=a-c]').getAttribute('data-focused'), 'true');
    assert.equal(await page.locator('[data-record-id=b-d]').getAttribute('data-focused'), 'false');
    await page.getByRole('button', { name: 'Show all', exact: true }).click();
    const geometry = await page.locator('[data-node-id=a]').getAttribute('transform'); await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-node-id=a]').getAttribute('transform'), geometry, 'no background force simulation');
  }
  const dragged = page.locator('[data-node-id=a] circle'), before = await page.locator('[data-node-id=a]').getAttribute('transform'), box = await dragged.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 75, box.y + 45, { steps: 5 }); await page.mouse.up();
  const after = await page.locator('[data-node-id=a]').getAttribute('transform'); assert.notEqual(after, before);
  await page.mouse.move(box.x + 130, box.y + 90); assert.equal(await page.locator('[data-node-id=a]').getAttribute('transform'), after, 'pointerup ends dragging');
  const remainingPointers = await page.evaluate(() => {
    const add = window.addEventListener, remove = window.removeEventListener, active = new Set();
    window.addEventListener = function (name, listener, options) { if (name === 'pointermove') active.add(listener); return add.call(this, name, listener, options); };
    window.removeEventListener = function (name, listener, options) { if (name === 'pointermove') active.delete(listener); return remove.call(this, name, listener, options); };
    const element = document.querySelector('[data-node-id=a]');
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 55, button: 0, clientX: 100, clientY: 100 }));
    const installed = active.size;
    structuralHandle.destroy();
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 55, clientX: 300, clientY: 300 }));
    window.addEventListener = add; window.removeEventListener = remove;
    return { installed, remaining: active.size };
  });
  assert.deepEqual(remainingPointers, { installed: 1, remaining: 0 }, 'destroy removes the global pointer listener during an active drag');
  assert.equal(await page.locator('#chart svg').count(), 0, 'destroy releases an in-progress drag and its DOM');
  const missingEndpoint = structuredClone(fixtures.network); missingEndpoint.rows[0].target = 'unknown'; await reject(missingEndpoint, /endpoint/);
  const missingSign = structuredClone(fixtures.network); delete missingSign.rows[0].sign; await reject(missingSign, /sign/);
  const negativeWeight = structuredClone(fixtures.network); negativeWeight.rows[0].weight = '-1'; await reject(negativeWeight, /nonnegative/);
  await reject({ ...fixtures.network, nodes: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })) }, /1–100/);
  await reject({ ...fixtures.network, rows: Array.from({ length: 501 }, (_, i) => ({ ...fixtures.network.rows[0], id: String(i) })) }, /500/);
  await reject({ ...fixtures.network, directed: 'yes' }, /boolean/);
  await draw({ kind: 'network-circular', directed: true, nodes: [{ id: 'a' }, { id: 'b' }], rows: [{ id: 'forward', source: 'a', target: 'b', weight: '1', sign: 1 }, { id: 'reverse', source: 'b', target: 'a', weight: '1', sign: -1 }] });
  const opposing = await page.locator('[data-structure-kind=network-link] > path:first-child').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  assert.notEqual(opposing[0].split('Q')[1].split(' ')[0], opposing[1].split('Q')[1].split(' ')[0], 'opposing recorded edges have different arcs');

  for (const width of [1000, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1200 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, theme);
    for (const spec of [fixtures.treemap, fixtures.threads, fixtures.flow, fixtures.network, { ...fixtures.network, kind: 'network-force' }]) {
      await draw(spec);
      const bad = await page.evaluate(() => {
        const svg = document.querySelector('#chart svg'), frame = document.querySelector('#chart').getBoundingClientRect(), box = svg.getBoundingClientRect();
        return { malformed: /(?:NaN|Infinity)/.test(svg.outerHTML), tooWide: box.right > frame.right + 1, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      assert.deepEqual(bad, { malformed: false, tooWide: false, horizontalOverflow: false }, `${spec.kind} at ${width}px ${theme}`);
      if (process.env.SESAME_STRUCTURE_SCREENSHOTS) {
        await mkdir(process.env.SESAME_STRUCTURE_SCREENSHOTS, { recursive: true });
        await page.locator('#chart').screenshot({ path: join(process.env.SESAME_STRUCTURE_SCREENSHOTS, `${spec.kind}-${width}-${theme}.png`) });
      }
    }
  }
  assert.deepEqual(errors, []);
});
