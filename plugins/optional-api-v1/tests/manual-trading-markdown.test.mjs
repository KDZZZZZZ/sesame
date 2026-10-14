import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { hasElectron, launchPage } from './helpers/collaboration-electron.mjs';

const hasPlaywright = hasElectron;
const assetPath = fileURLToPath(new URL('../packages/manual-trading/assets/collaboration-markdown.js', import.meta.url));

async function withPage(run) {
  const { page, close } = await launchPage();
  try {
    await page.setContent('<!doctype html><main id="root"></main>');
    await page.addScriptTag({ path: assetPath });
    await run(page);
  } finally {
    await close();
  }
}

test('collaboration Markdown renders the supported DOM subset', { skip: !hasPlaywright }, async () => withPage(async page => {
  const actual = await page.evaluate(() => {
    window.SesameMarkdown.render(document.getElementById('root'), [
      '## Decision',
      '',
      'Alpha **strong** and *em* with `code`.',
      '',
      '- [x] checked task',
      '- parent',
      '  - child',
      '',
      '> quoted **note**',
      '',
      '| Symbol | Bias |',
      '| --- | ---: |',
      '| EURUSD | Long |',
      '',
      '```mql5',
      'Print("ok");',
      '```',
      '',
      '[source](https://example.com/report)',
    ].join('\n'));
    const root = document.getElementById('root');
    return {
      h2: root.querySelector('h2')?.textContent,
      strong: root.querySelector('strong')?.textContent,
      emphasis: root.querySelector('em')?.textContent,
      inlineCode: root.querySelector('.md-inline-code')?.textContent,
      taskChecked: root.querySelector('li.md-task input')?.checked,
      nested: root.querySelector('li ul li')?.textContent.trim(),
      quote: root.querySelector('blockquote')?.textContent.trim(),
      table: [...root.querySelectorAll('tbody td')].map(cell => cell.textContent),
      language: root.querySelector('.md-code-language')?.textContent,
      codeBlock: root.querySelector('pre code')?.textContent,
      link: root.querySelector('a')?.href,
      supported: window.SesameMarkdown.supported,
    };
  });
  assert.deepEqual(actual, {
    h2: 'Decision',
    strong: 'strong',
    emphasis: 'em',
    inlineCode: 'code',
    taskChecked: true,
    nested: 'child',
    quote: 'quoted note',
    table: ['EURUSD', 'Long'],
    language: 'mql5',
    codeBlock: 'Print("ok");',
    link: 'https://example.com/report',
    supported: actual.supported,
  });
  assert.match(actual.supported, /Raw HTML is text/);
}));

test('collaboration Markdown keeps HTML, SVG, images and unsafe URLs inert', { skip: !hasPlaywright }, async () => withPage(async page => {
  const actual = await page.evaluate(() => {
    window.SesameMarkdown.render(document.getElementById('root'), [
      '<img src=x onerror="window.compromised=1">',
      '<svg onload="window.compromised=2"></svg>',
      '[js](javascript:alert(1))',
      '[data](data:text/html,boom)',
      '[file](file:///etc/passwd)',
      '[relative](//tracker.example/pixel)',
      '[local](local/report.html)',
      '[mail](mailto:desk@example.com)',
      '![remote pixel](https://tracker.example/pixel.png)',
    ].join('\n'));
    const root = document.getElementById('root');
    return {
      compromised: window.compromised,
      images: root.querySelectorAll('img').length,
      svgs: root.querySelectorAll('svg').length,
      scripts: root.querySelectorAll('script').length,
      anchors: [...root.querySelectorAll('a')].map(anchor => ({ text: anchor.textContent, href: anchor.getAttribute('href'), rel: anchor.rel, target: anchor.target })),
      text: root.textContent,
    };
  });
  assert.equal(actual.compromised, undefined);
  assert.equal(actual.images, 0);
  assert.equal(actual.svgs, 0);
  assert.equal(actual.scripts, 0);
  assert.deepEqual(actual.anchors, [
    { text: 'mail', href: 'mailto:desk@example.com', rel: 'noopener noreferrer', target: '_blank' },
    { text: '[image: remote pixel]', href: 'https://tracker.example/pixel.png', rel: 'noopener noreferrer', target: '_blank' },
  ]);
  assert.match(actual.text, /<img src=x/);
  assert.match(actual.text, /js/);
  assert.match(actual.text, /local/);
  assert.match(actual.text, /\[image: remote pixel]/);
}));

test('collaboration Markdown keeps incomplete streamed text visible and rerenders cleanly', { skip: !hasPlaywright }, async () => withPage(async page => {
  const actual = await page.evaluate(() => {
    const root = document.getElementById('root');
    window.SesameMarkdown.render(root, '```js\nconst price = 1.09');
    const streaming = { pre: root.querySelector('pre code')?.textContent, text: root.textContent };
    window.SesameMarkdown.render(root, '# Finished\n\n- final item');
    return {
      streaming,
      heading: root.querySelector('h1')?.textContent,
      item: root.querySelector('li')?.textContent.trim(),
      staleCodeBlocks: root.querySelectorAll('pre code').length,
    };
  });
  assert.equal(actual.streaming.pre, 'const price = 1.09');
  assert.match(actual.streaming.text, /const price = 1\.09/);
  assert.deepEqual(actual, {
    streaming: actual.streaming,
    heading: 'Finished',
    item: 'final item',
    staleCodeBlocks: 0,
  });
}));

test('collaboration Markdown handles list boundaries, escapes, and large plain text efficiently', { skip: !hasPlaywright }, async () => withPage(async page => {
  const actual = await page.evaluate(() => {
    const root = document.getElementById('root');
    window.SesameMarkdown.render(root, [
      '4. fourth',
      '5. fifth',
      '',
      '- 第一条',
      '后续说明',
      '',
      'snake_case_id keeps underscores, escaped \\*literal\\* and real *em*.',
    ].join('\n'));
    const list = root.querySelector('ol');
    const unordered = root.querySelector('ul');
    const paragraphs = [...root.children].filter(node => node.tagName === 'P').map(node => node.textContent);
    const emphasized = [...root.querySelectorAll('em')].map(node => node.textContent);
    window.SesameMarkdown.render(root, 'plain '.repeat(1200));
    return {
      orderedStart: list?.getAttribute('start'),
      orderedItems: [...list.querySelectorAll('li')].map(node => node.textContent.trim()),
      unorderedItems: [...unordered.querySelectorAll('li')].map(node => node.textContent.trim()),
      paragraphs,
      emphasized,
      plainChildNodes: root.querySelector('p')?.childNodes.length,
      plainText: root.textContent.length,
    };
  });
  assert.deepEqual(actual, {
    orderedStart: '4',
    orderedItems: ['fourth', 'fifth'],
    unorderedItems: ['第一条'],
    paragraphs: ['后续说明', 'snake_case_id keeps underscores, escaped *literal* and real em.'],
    emphasized: ['em'],
    plainChildNodes: 1,
    plainText: 7200,
  });
}));

test('collaboration Markdown preserves trailing backslash and table pipes inside escapes or code spans', { skip: !hasPlaywright }, async () => withPage(async page => {
  const actual = await page.evaluate(() => {
    const root = document.getElementById('root');
    window.SesameMarkdown.render(root, 'ends with slash \\');
    const trailing = root.textContent;
    window.SesameMarkdown.render(root, [
      '| 条件 | 表达式 | 说明 |',
      '| --- | --- | --- |',
      '| 价格条件 | bid \\| ask > 1.09 | spread gate |',
      '| 代码条件 | `left|right` | code pipe stays |',
    ].join('\n'));
    return {
      trailing,
      rows: [...root.querySelectorAll('tbody tr')].map(row => [...row.children].map(cell => cell.textContent)),
      codeText: root.querySelector('tbody code')?.textContent,
      cellCounts: [...root.querySelectorAll('tbody tr')].map(row => row.children.length),
    };
  });
  assert.deepEqual(actual, {
    trailing: 'ends with slash \\',
    rows: [
      ['价格条件', 'bid | ask > 1.09', 'spread gate'],
      ['代码条件', 'left|right', 'code pipe stays'],
    ],
    codeText: 'left|right',
    cellCounts: [3, 3],
  });
}));
