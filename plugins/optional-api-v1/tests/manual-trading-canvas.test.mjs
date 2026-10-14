import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { activityHTML } from '../packages/manual-trading/viewer.js';
import { hasElectron, launchPage } from './helpers/collaboration-electron.mjs';

const browserOptions = { skip: !hasElectron, timeout: 60000 };

const T0 = Date.parse('2026-10-13T12:00:00Z');
const roles = ['market', 'fundamentals', 'news', 'sentiment', 'bull', 'bear', 'risk', 'manager', 'executor', 'reporter'];
const workflow = {
  mode: 'team',
  stages: [
    { index: 0, name: '并行研究', roles: ['market', 'fundamentals', 'news', 'sentiment'] },
    { index: 1, name: '多空辩论', roles: ['bull', 'bear'] },
    { index: 2, name: '风险复核', roles: ['risk'] },
    { index: 3, name: '投资决策', roles: ['manager'] },
    { index: 4, name: '执行核对', roles: ['executor'] },
    { index: 5, name: '归档', roles: ['reporter'] },
  ],
};
const stageByRole = new Map(workflow.stages.flatMap(stage => stage.roles.map(role => [role, stage.index])));

function snapshot({ live = false, seq = 12, title = 'Canvas interaction fixture', reports = roles, events = [] } = {}) {
  const tasks = roles.map((role, index) => ({
    id: `task-${role}`,
    role,
    status: index < 8 ? 'completed' : 'running',
    stageIndex: stageByRole.get(role),
    round: stageByRole.get(role),
    provider: 'fixture',
    model: index % 2 ? 'gpt-canvas-b' : 'gpt-canvas-a',
    createdAt: T0 + index * 1000,
    startedAt: T0 + index * 1000 + 100,
    completedAt: index < 8 ? T0 + index * 1000 + 800 : undefined,
  }));
  const visibleReports = reports.map((role, index) => ({
    taskId: `task-${role}`,
    role,
    text: `${role} report visible in feed ${index + 1}\n\n${'Evidence paragraph for canvas scroll coverage. '.repeat(18)}`,
    createdAt: T0 + index * 1500,
  }));
  return {
    schemaVersion: 1,
    mode: 'live',
    feedUrl: live ? 'events' : undefined,
    run: { id: 'canvas-run', title, status: 'running', mode: 'team', createdAt: T0 },
    workflow,
    tasks,
    reports: visibleReports,
    events: [
      { id: 'event-1', seq: 1, at: T0, type: 'run.started' },
      { id: 'read-bull-market', seq: 2, at: T0 + 2000, type: 'report.read', fromTaskId: 'task-market', toTaskId: 'task-bull', message: 'Bull reviewed market evidence' },
      { id: `event-${seq}`, seq, at: T0 + seq * 1000, type: 'tool.started', taskId: 'task-executor', message: 'Execution check' },
      ...events,
    ],
  };
}

async function withPage(t, initial, action, { viewport = { width: 1280, height: 820 }, touch = false } = {}) {
  const html = activityHTML(initial);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { page, close } = await launchPage({ viewport, touch });
  await page.addInitScript(initial => {
    const snapshots = new Set(), connections = new Set();
    window.__liveSnapshotListeners = snapshots;
    window.__emitFixtureSnapshot = snapshot => { for (const callback of snapshots) callback(snapshot); };
    window.__emitFixtureConnection = state => { for (const callback of connections) callback(state); };
    if (initial.feedUrl) {
      window.reportLive = {
        subscribeSnapshot: callback => { snapshots.add(callback); return () => snapshots.delete(callback); },
        subscribeConnection: callback => { connections.add(callback); return () => connections.delete(callback); },
      };
      addEventListener('DOMContentLoaded', () => {
        window.__emitFixtureSnapshot(initial);
        window.__emitFixtureConnection('connected');
      }, { once: true });
    }
  }, initial);
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
    await waitForCanvas(page);
    return await action(page);
  } finally {
    await close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function waitForCanvas(page) {
  await page.waitForSelector('#diagram-viewport');
  await page.waitForFunction(() => document.querySelectorAll('#diagram .agent-node').length > 0);
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(250, 250, 250)');
}

async function camera(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('#diagram-viewport');
    const diagram = document.querySelector('#diagram');
    const zoom = document.querySelector('#graph-zoom-level');
    const matrix = new DOMMatrixReadOnly(getComputedStyle(diagram).transform === 'none' ? undefined : getComputedStyle(diagram).transform);
    const viewportBox = viewport.getBoundingClientRect();
    const diagramBox = diagram.getBoundingClientRect();
    return {
      x: matrix.m41,
      y: matrix.m42,
      scale: matrix.a,
      level: zoom?.textContent?.trim() ?? '',
      viewport: { left: viewportBox.left, top: viewportBox.top, width: viewportBox.width, height: viewportBox.height },
      diagram: { left: diagramBox.left, top: diagramBox.top, width: diagramBox.width, height: diagramBox.height },
      overflowX: getComputedStyle(viewport).overflowX,
      overflowY: getComputedStyle(viewport).overflowY,
      tabindex: viewport.getAttribute('tabindex'),
      transform: getComputedStyle(diagram).transform,
    };
  });
}

async function centerOf(page, selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${selector} should be visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function approx(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${actual} to be within ${tolerance} of ${expected}`);
}

async function wheelVisibleFeed(page, deltaY) {
  const point = await page.evaluate(() => {
    const feed = document.querySelector('.feed-report')?.getBoundingClientRect();
    if (!feed) return { x: 30, y: window.innerHeight - 30 };
    return {
      x: Math.max(20, Math.min(window.innerWidth - 20, feed.left + Math.min(24, feed.width / 2))),
      y: Math.max(20, Math.min(window.innerHeight - 20, feed.top + Math.min(30, feed.height / 2))),
    };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(50);
}

test('collaboration canvas renders as a clipped, focusable fitted viewport', browserOptions, async t => {
  await withPage(t, snapshot(), async page => {
    assert.equal(await page.locator('aside, #sidebar, video, audio, #player').count(), 0, 'canvas page should not render sidebar/player chrome');
    const state = await camera(page);
    assert.equal(state.tabindex, '0');
    assert.match(`${state.overflowX}/${state.overflowY}`, /(hidden|clip)\/(hidden|clip)/);
    assert.match(state.level, /%/);
    assert.ok(state.scale > 0 && state.scale <= 1, `initial fit should use a positive non-enlarging scale, got ${state.scale}`);
    assert.ok(state.diagram.left >= state.viewport.left - 1, 'fitted scene should not protrude past the left clip edge');
    assert.ok(state.diagram.top >= state.viewport.top - 1, 'fitted scene should not protrude past the top clip edge');
    assert.ok(state.diagram.left + state.diagram.width <= state.viewport.left + state.viewport.width + 1, 'fitted scene should fit horizontally');
    assert.ok(state.diagram.top + state.diagram.height <= state.viewport.top + state.viewport.height + 1, 'fitted scene should fit vertically');
  });
});

test('dragging the canvas pans after slop while ordinary node click still opens the feed', browserOptions, async t => {
  await withPage(t, snapshot(), async page => {
    await page.locator('#diagram-viewport').click();
    const start = await camera(page);
    const viewportPoint = await centerOf(page, '#diagram-viewport');
    await page.mouse.move(viewportPoint.x, viewportPoint.y);
    await page.mouse.down();
    await page.mouse.move(viewportPoint.x + 2, viewportPoint.y + 1);
    await page.mouse.up();
    const belowSlop = await camera(page);
    approx(belowSlop.x, start.x, 0.5, 'sub-slop movement should not pan on x');
    approx(belowSlop.y, start.y, 0.5, 'sub-slop movement should not pan on y');

    await page.mouse.move(viewportPoint.x, viewportPoint.y);
    await page.mouse.down();
    await page.mouse.move(viewportPoint.x + 80, viewportPoint.y + 42);
    await page.mouse.up();
    const panned = await camera(page);
    assert.ok(Math.abs(panned.x - start.x) > 20 || Math.abs(panned.y - start.y) > 20, 'dragging open canvas should pan the camera');

    await page.locator('.agent-node[data-role="market"]').click();
    await page.waitForFunction(() => document.activeElement?.matches('.feed-report[data-role="market"]'));
    assert.equal(await page.locator('.feed-report[data-role="market"].is-selected').count(), 1, 'ordinary node click should jump to the matching feed row');
  });
});

test('dragging an agent node pans but does not activate that node', browserOptions, async t => {
  await withPage(t, snapshot(), async page => {
    const before = await camera(page);
    const nodePoint = await centerOf(page, '.agent-node[data-role="bull"]');
    await page.mouse.move(nodePoint.x, nodePoint.y);
    await page.mouse.down();
    await page.mouse.move(nodePoint.x + 96, nodePoint.y + 10, { steps: 6 });
    await page.mouse.up();
    const after = await camera(page);
    assert.ok(Math.abs(after.x - before.x) > 20, 'node drag should pan the camera');
    assert.equal(await page.locator('.agent-node[data-role="bull"][aria-pressed="true"], .feed-report[data-role="bull"].is-selected').count(), 0,
      'a completed drag on a node must not activate node selection');
  });
});

test('wheel zoom is pointer anchored and page scroll remains natural outside the canvas', browserOptions, async t => {
  await withPage(t, snapshot(), async page => {
    const anchor = await centerOf(page, '.agent-node[data-role="risk"]');
    const before = await page.evaluate(({ x, y }) => {
      const node = document.querySelector('.agent-node[data-role="risk"]').getBoundingClientRect();
      return { scrollY, dx: node.left + node.width / 2 - x, dy: node.top + node.height / 2 - y, camera: getComputedStyle(document.querySelector('#diagram')).transform };
    }, anchor);
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.wheel(0, -420);
    const after = await page.evaluate(({ x, y }) => {
      const node = document.querySelector('.agent-node[data-role="risk"]').getBoundingClientRect();
      return { scrollY, dx: node.left + node.width / 2 - x, dy: node.top + node.height / 2 - y, camera: getComputedStyle(document.querySelector('#diagram')).transform };
    }, anchor);
    assert.notEqual(after.camera, before.camera, 'wheel over the canvas should zoom the scene');
    assert.equal(after.scrollY, before.scrollY, 'wheel over the canvas should not scroll the page');
    approx(after.dx, before.dx, 8, 'anchored zoom should keep the target node under the pointer on x');
    approx(after.dy, before.dy, 8, 'anchored zoom should keep the target node under the pointer on y');

    await wheelVisibleFeed(page, 700);
    assert.ok(await page.evaluate(() => scrollY) > before.scrollY, 'wheel outside the canvas should keep natural page scrolling');
  });
});

test('zoom controls, fit, reset, and keyboard shortcuts expose bounded camera changes', browserOptions, async t => {
  await withPage(t, snapshot(), async page => {
    const initial = await camera(page);
    await page.locator('#graph-zoom-in').click();
    const zoomedIn = await camera(page);
    assert.ok(zoomedIn.scale > initial.scale, 'zoom-in button should increase scale');

    for (let index = 0; index < 30 && !(await page.locator('#graph-zoom-out').isDisabled()); index++) await page.locator('#graph-zoom-out').click();
    const minZoom = await camera(page);
    assert.ok(minZoom.scale >= 0.099 && minZoom.scale < zoomedIn.scale, 'zoom-out button should clamp at a usable minimum');

    await page.locator('#graph-reset').click();
    const reset = await camera(page);
    approx(reset.scale, 1, 0.02, 'reset button should return to 100% scale');
    assert.match(reset.level, /100\s*%/);

    await page.locator('#graph-fit').click();
    const fitted = await camera(page);
    approx(fitted.scale, initial.scale, 0.03, 'fit button should restore the initial fitted scale');

    await page.locator('#diagram-viewport').focus();
    await page.keyboard.press('+');
    assert.ok((await camera(page)).scale > fitted.scale, '+ key should zoom in');
    await page.keyboard.press('-');
    const afterMinus = await camera(page);
    approx(afterMinus.scale, fitted.scale, 0.04, '- key should zoom out');
    await page.keyboard.press('ArrowRight');
    const moved = await camera(page);
    assert.ok(Math.abs(moved.x - afterMinus.x) > 5, 'arrow key should pan the camera');
    await page.keyboard.press('1');
    approx((await camera(page)).scale, 1, 0.02, '1 key should reset to 100%');
    await page.keyboard.press('Home');
    approx((await camera(page)).scale, initial.scale, 0.03, 'Home key should fit the scene');
    await page.keyboard.press('0');
    approx((await camera(page)).scale, initial.scale, 0.03, '0 key should fit the scene');
  });
});

test('touch pointer events pan, pinch zoom, and release cancelled gestures', browserOptions, async t => {
  await withPage(t, snapshot(), async page => {
    const viewport = await centerOf(page, '#diagram-viewport');
    const start = await camera(page);
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: viewport.x, y: viewport.y, id: 11, radiusX: 2, radiusY: 2, force: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: viewport.x + 74, y: viewport.y + 18, id: 11, radiusX: 2, radiusY: 2, force: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const panned = await camera(page);
    assert.ok(Math.abs(panned.x - start.x) > 20, 'one-finger touch drag should pan');

    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
      { x: viewport.x - 20, y: viewport.y, id: 21, radiusX: 2, radiusY: 2, force: 1 },
      { x: viewport.x + 20, y: viewport.y, id: 22, radiusX: 2, radiusY: 2, force: 1 },
    ] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { x: viewport.x - 70, y: viewport.y, id: 21, radiusX: 2, radiusY: 2, force: 1 },
      { x: viewport.x + 70, y: viewport.y, id: 22, radiusX: 2, radiusY: 2, force: 1 },
    ] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const pinched = await camera(page);
    assert.ok(pinched.scale > panned.scale, 'two-finger pinch-out should zoom in');

    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: viewport.x, y: viewport.y, id: 31, radiusX: 2, radiusY: 2, force: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: viewport.x + 50, y: viewport.y, id: 31, radiusX: 2, radiusY: 2, force: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: viewport.x + 150, y: viewport.y, id: 31, radiusX: 2, radiusY: 2, force: 1 }] }).catch(() => {});
    const cancelled = await camera(page);
    approx(cancelled.x, pinched.x, 70, 'pointer cancellation should release the active gesture');
  }, { viewport: { width: 390, height: 740 }, touch: true });
});

test('SVG routes stay attached to node geometry after zoom and snapshot events create pulses', browserOptions, async t => {
  await withPage(t, snapshot({ live: true }), async page => {
    await page.waitForFunction(() => window.__liveSnapshotListeners?.size === 1);
    const alignmentBefore = await page.evaluate(() => {
      const path = document.querySelector('#flow-lines path');
      const from = document.querySelector('.agent-node[data-role="market"]').getBoundingClientRect();
      const diagramElement = document.querySelector('#diagram');
      const diagram = diagramElement.getBoundingClientRect();
      const scale = new DOMMatrixReadOnly(getComputedStyle(diagramElement).transform === 'none' ? undefined : getComputedStyle(diagramElement).transform).a || 1;
      const first = path.getPointAtLength(0);
      return {
        pathCount: document.querySelectorAll('#flow-lines path').length,
        x: first.x,
        y: first.y,
        expectedX: (from.right - diagram.left) / scale,
        expectedY: (from.top - diagram.top + from.height / 2) / scale,
      };
    });
    assert.ok(alignmentBefore.pathCount > 0, 'workflow should draw SVG edges');
    approx(alignmentBefore.x, alignmentBefore.expectedX, 6, 'edge x should use untransformed scene coordinates');
    approx(alignmentBefore.y, alignmentBefore.expectedY, 6, 'edge y should use untransformed scene coordinates');

    await page.locator('#graph-zoom-in').click();
    await page.locator('#graph-zoom-in').click();
    const alignmentAfter = await page.evaluate(() => {
      const path = document.querySelector('#flow-lines path');
      const from = document.querySelector('.agent-node[data-role="market"]').getBoundingClientRect();
      const diagramElement = document.querySelector('#diagram');
      const diagram = diagramElement.getBoundingClientRect();
      const scale = new DOMMatrixReadOnly(getComputedStyle(diagramElement).transform === 'none' ? undefined : getComputedStyle(diagramElement).transform).a || 1;
      const first = path.getPointAtLength(0);
      return {
        x: first.x,
        y: first.y,
        expectedX: (from.right - diagram.left) / scale,
        expectedY: (from.top - diagram.top + from.height / 2) / scale,
      };
    });
    approx(alignmentAfter.x, alignmentAfter.expectedX, 6, 'edge x should remain attached after zoom');
    approx(alignmentAfter.y, alignmentAfter.expectedY, 6, 'edge y should remain attached after zoom');

    await page.evaluate(next => window.__emitFixtureSnapshot(next), snapshot({
      live: true,
      seq: 20,
      events: [{ id: 'read-risk-bull', seq: 20, at: T0 + 20000, type: 'report.read', fromTaskId: 'task-bull', toTaskId: 'task-risk', message: 'Risk reviewed bull evidence' }],
    }));
    await page.waitForSelector('#message-lines [data-event-id="read-risk-bull"] .message-route');
  });
});

test('mobile viewport clips the canvas without page overflow while the report feed still scrolls', browserOptions, async t => {
  await withPage(t, snapshot(), async page => {
    const metrics = await page.evaluate(() => ({
      bodyWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      viewportOverflow: `${getComputedStyle(document.querySelector('#diagram-viewport')).overflowX}/${getComputedStyle(document.querySelector('#diagram-viewport')).overflowY}`,
      feedCount: document.querySelectorAll('.feed-report').length,
    }));
    assert.equal(metrics.bodyBackground, 'rgb(250, 250, 250)');
    assert.ok(metrics.bodyWidth <= metrics.viewportWidth + 1, `mobile page should not expose horizontal overflow (${metrics.bodyWidth} > ${metrics.viewportWidth})`);
    assert.match(metrics.viewportOverflow, /(hidden|clip)\/(hidden|clip)/);
    assert.ok(metrics.feedCount >= 8, 'feed reports should remain present below the clipped canvas');
    await wheelVisibleFeed(page, 900);
    assert.ok(await page.evaluate(() => scrollY) > 100, 'mobile-sized page should still scroll naturally through the feed');
  }, { viewport: { width: 390, height: 740 }, touch: true });
});

test('live snapshots preserve the current camera across repeated updates', browserOptions, async t => {
  await withPage(t, snapshot({ live: true }), async page => {
    await page.waitForFunction(() => window.__liveSnapshotListeners?.size === 1);
    await page.locator('#graph-reset').click();
    const point = await centerOf(page, '#diagram-viewport');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 120, point.y + 44);
    await page.mouse.up();
    await page.locator('#graph-zoom-in').click();
    const before = await camera(page);

    await page.evaluate(next => window.__emitFixtureSnapshot(next), snapshot({ live: true, seq: 30, reports: roles.slice(0, 6), title: 'Canvas update one' }));
    await page.waitForFunction(() => document.querySelector('#run-title')?.textContent === 'Canvas update one');
    const afterOne = await camera(page);
    approx(afterOne.x, before.x, 1, 'first snapshot should preserve camera x');
    approx(afterOne.y, before.y, 1, 'first snapshot should preserve camera y');
    approx(afterOne.scale, before.scale, 0.005, 'first snapshot should preserve camera scale');

    await page.evaluate(next => window.__emitFixtureSnapshot(next), snapshot({ live: true, seq: 31, reports: roles.slice(0, 9), title: 'Canvas update two' }));
    await page.waitForFunction(() => document.querySelector('#run-title')?.textContent === 'Canvas update two');
    const afterTwo = await camera(page);
    approx(afterTwo.x, before.x, 1, 'second snapshot should preserve camera x');
    approx(afterTwo.y, before.y, 1, 'second snapshot should preserve camera y');
    approx(afterTwo.scale, before.scale, 0.005, 'second snapshot should preserve camera scale');
  });
});

test('only new successful handoffs animate, and completed work clears every actor', browserOptions, async t => {
  await withPage(t, snapshot({ live: true }), async page => {
    await page.waitForFunction(() => document.documentElement.dataset.connected === 'true');
    assert.equal(await page.locator('.handoff-agent').count(), 0, 'Initial historical reads do not replay');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.handoff-agent').count(), 0, 'Idle time cannot invent communication');
    const next = snapshot({ live: true, seq: 13, events: [
      { id: 'actual-read', seq: 14, at: T0 + 14000, type: 'report.read', fromTaskId: 'task-bull', toTaskId: 'task-risk', message: '实际成功读取' },
    ] });
    await page.evaluate(value => window.__emitFixtureSnapshot(value), next);
    const actor = page.locator('[data-event-id="actual-read"] .handoff-agent');
    await actor.waitFor(); const before = await actor.getAttribute('transform');
    await page.waitForTimeout(180); assert.notEqual(await actor.getAttribute('transform'), before);
    assert.equal(await actor.locator('svg').count(), 1, 'The moving actor carries the actual source model icon');
    next.events.push({ id: 'finish', seq: 15, at: T0 + 15000, type: 'run.finished' });
    next.run.status = 'completed'; next.tasks.forEach(task => { task.status = 'completed'; });
    next.run.report = { path: '手工交易日报/one-summary.html', state: 'archived' };
    await page.evaluate(value => window.__emitFixtureSnapshot(value), next);
    assert.equal(await page.locator('.handoff-agent, .is-receiving').count(), 0);
    assert.match(await page.locator('#summary-path').textContent(), /one-summary\.html/);
    assert.equal(await page.locator('input[type="range"], #player').count(), 0);
  });
});

test('disconnect and reconnect suppress accumulated history but preserve subsequent live handoffs', browserOptions, async t => {
  await withPage(t, snapshot({ live: true }), async page => {
    await page.waitForFunction(() => document.documentElement.dataset.connected === 'true');
    await page.evaluate(() => window.__emitFixtureConnection('reconnecting'));
    assert.equal(await page.locator('#connection-status').textContent(), '正在重连');
    const recovered = snapshot({ live: true, seq: 20, events: [{ id: 'old-read', seq: 21, at: T0, type: 'report.read', fromTaskId: 'task-bull', toTaskId: 'task-risk' }] });
    await page.evaluate(value => { window.__emitFixtureSnapshot(value); window.__emitFixtureConnection('connected'); }, recovered);
    assert.equal(await page.locator('.handoff-agent').count(), 0);
    recovered.events.push({ id: 'new-read', seq: 22, at: T0, type: 'report.read', fromTaskId: 'task-market', toTaskId: 'task-bull' });
    await page.evaluate(value => window.__emitFixtureSnapshot(value), recovered);
    await page.locator('[data-event-id="new-read"] .handoff-agent').waitFor();
    await page.evaluate(value => window.__emitFixtureSnapshot(value), snapshot({ live: true, seq: 10, title: 'Stale snapshot' }));
    assert.notEqual(await page.locator('#run-title').textContent(), 'Stale snapshot');
    await page.evaluate(() => window.__emitFixtureConnection('closed'));
    assert.equal(await page.locator('.handoff-agent').count(), 0);
    assert.equal(await page.locator('#connection-status').textContent(), '已断开');
  });
});

test('reduced motion highlights an actual handoff without walking or busy-node animation', browserOptions, async t => {
  await withPage(t, snapshot({ live: true }), async page => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.documentElement.dataset.connected === 'true');
    await page.evaluate(value => window.__emitFixtureSnapshot(value), snapshot({ live: true, seq: 13, events: [
      { id: 'reduced-read', seq: 14, at: T0, type: 'report.read', fromTaskId: 'task-market', toTaskId: 'task-bull' },
    ] }));
    await page.locator('[data-event-id="reduced-read"] .message-route').waitFor();
    assert.equal(await page.locator('.handoff-agent').count(), 0);
    assert.equal(await page.locator('.agent-node[data-status="running"] .model-icon').first().evaluate(node => getComputedStyle(node).animationName), 'none');
  });
});

test('factor directions have distinct real roles and stream Markdown in the same panel', browserOptions, async t => {
  const initial = snapshot({ live: true });
  const stages = [ ['supervisor'], ['researcher:0', 'researcher:1'], ['coder:0', 'coder:1'], ['reviewer:0', 'reviewer:1'], ['reporter'] ];
  initial.workflow = { mode: 'team', stages: stages.map((roles, index) => ({ index, name: ['计划', '并行假设', '公式实现', '独立评审', '总结'][index], roles })),
    roles: stages.flat().map(id => ({ id, name: id.includes(':0') ? `动量 · ${id.split(':')[0]}` : id.includes(':1') ? `反转 · ${id.split(':')[0]}` : id === 'supervisor' ? '研究主管' : '总结归档' })) };
  initial.tasks = stages.flatMap((roles, stageIndex) => roles.map(role => ({ id: 'factor-' + role, role, stageIndex, status: stageIndex === 1 ? 'running' : stageIndex < 1 ? 'completed' : 'queued', provider: 'fixture', model: role.endsWith(':1') ? 'claude-fixture' : 'gpt-fixture' })));
  initial.events = []; initial.reports = [];
  await withPage(t, initial, async page => {
    assert.equal(await page.locator('.agent-node').count(), 8);
    assert.match(await page.locator('.agent-node[data-role="researcher:0"]').textContent(), /动量/);
    assert.match(await page.locator('.agent-node[data-role="researcher:1"]').textContent(), /反转/);
    initial.tasks[1].publicOutput = { text: '## 当前证据\n\n- **动量** 有效\n- 继续核验' };
    initial.reports = [{ taskId: initial.tasks[1].id, role: initial.tasks[1].role, status: 'running', text: initial.tasks[1].publicOutput.text }];
    await page.evaluate(value => window.__emitFixtureSnapshot(value), initial);
    assert.equal(await page.locator('.feed-report h2').textContent(), '当前证据');
    assert.equal(await page.locator('.feed-report strong').textContent(), '动量');
  });
});
