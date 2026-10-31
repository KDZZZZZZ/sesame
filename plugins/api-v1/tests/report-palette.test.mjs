import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const host = process.env.SESAME_HOST_ROOT;
test('report blue-gray data roles preserve the host backgrounds and readable light/dark contrast', { skip: !host }, async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const css = await readFile(new URL('../packages/reports/assets/editorial.css', import.meta.url), 'utf8');
  const themeCss = await readFile(join(host,'modules/frontend/report-runtime/theme.css'),'utf8');
  const baseCss = await readFile(join(host,'modules/frontend/report-runtime/report.css'),'utf8');
  const luminance = rgb => rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  const contrast = (a,b) => { const x=luminance(a), y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  for (const theme of ['light','dark']) {
    await page.setContent('<html><body><main class="report"><span id="ink" style="color:var(--report-ink)">文字</span><span id="muted" style="color:var(--report-muted)">轴标签</span><i id="data" style="color:var(--report-accent)"></i><i id="context" style="color:var(--report-context)"></i></main></body></html>');
    await page.addStyleTag({content:themeCss+baseCss});
    const original = await page.evaluate(theme => {
      const root=document.documentElement;
      root.dataset.theme=theme;
      return {background:getComputedStyle(document.body).backgroundColor,success:getComputedStyle(root).getPropertyValue('--success')};
    },theme);
    await page.addStyleTag({ content: css });
    const colors=await page.evaluate(()=>({
      background:getComputedStyle(document.body).backgroundColor,
      success:getComputedStyle(document.documentElement).getPropertyValue('--success'),
      hasPalette:document.documentElement.hasAttribute('data-report-palette'),
      ...Object.fromEntries(['ink','muted','data','context'].map(id=>[id,getComputedStyle(document.getElementById(id)).color]))
    }));
    assert.equal(colors.hasPalette,false,'Host reconstruction must not require a custom root attribute');
    assert.equal(colors.background,original.background,`${theme} background must remain unchanged`);
    assert.equal(colors.success,original.success,'status meaning is outside the report data palette');
    assert.equal(colors.data,theme==='light'?'rgb(51, 78, 172)':'rgb(155, 179, 255)');
    assert.equal(colors.context,theme==='light'?'rgb(52, 52, 52)':'rgb(228, 228, 231)');
    for(const role of ['ink','muted','data']) assert.ok(contrast(colors[role],colors.background)>=4.5,`${theme} ${role} text contrast`);
    assert.ok(contrast(colors.context,colors.background)>=3,`${theme} context graphical contrast`);
  }
});
