from pathlib import Path
import os, json
from playwright.sync_api import sync_playwright

out=Path(__file__).resolve().parent
temp=out/'research-catalog-check-20261026'
temp.mkdir(exist_ok=True)
os.environ['TEMP']=str(temp)
os.environ['TMP']=str(temp)
path=out/'研究报告体系-Trading-Central-Autochartist与Sesame-20261026.html'
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1,color_scheme='light')
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(path.as_uri(),wait_until='load')
    page.screenshot(path=str(temp/'cover.png'))
    initial=page.locator('#field-count').inner_text()
    page.locator('#field-search').fill('analyst')
    filtered=page.locator('#field-count').inner_text()
    n=page.locator('[data-field-table] tbody tr:visible').count()
    page.locator('#field-search').fill('option.')
    option=page.locator('#field-count').inner_text()
    page.locator('#field-search').fill('')
    page.get_by_role('heading',name='10 期权合约、波动率与组合',exact=True).scroll_into_view_if_needed()
    page.screenshot(path=str(temp/'dictionary.png'))
    desktop=page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate('scrollTo(0,0)')
    page.screenshot(path=str(temp/'mobile.png'))
    mobile=page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
    assert not errors,errors
    total=page.locator('[data-field-table] tbody tr').count()
    assert initial==f'{total} / {total} 个业务字段组',initial
    assert n>=5,(filtered,n)
    assert desktop['scroll']<=desktop['width'],desktop
    assert mobile['scroll']<=mobile['width'],mobile
    result={'page_errors':errors,'dictionary_initial':initial,'analyst_search':filtered,'options_search':option,'desktop':desktop,'mobile':mobile}
    (temp/'render-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))
    browser.close()
