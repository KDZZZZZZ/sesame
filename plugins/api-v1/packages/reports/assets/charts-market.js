/* Default market candles, using the same Lightweight Charts runtime and theme
 * as Sesame's market workbench. No report-specific candle drawing algorithm. */
(function (global) {
  'use strict';
  const fail = message => { throw Error(`SesameCharts/candlestick: ${message}`); };
  global.SesameCharts.register('candlestick', ctx => {
    const { spec, rows, frame, svg, numeric, target } = ctx;
    const library = global.LightweightCharts;
    if (!library) fail('load assets/vendor/lightweight-charts.js before assets/charts-market.js');
    const field = name => {
      const value = spec[name] ?? (name === 'time' ? spec.x ?? 'time' : name);
      if (typeof value !== 'string' || !value.trim()) fail(`${name} must name a column`);
      return value;
    };
    const keys = Object.fromEntries(['time', 'open', 'high', 'low', 'close'].map(name => [name, field(name)]));
    const precision = spec.digits ?? 2;
    if (!Number.isInteger(precision) || precision < 0 || precision > 8) fail('digits must be an integer between 0 and 8');
    const parseTime = value => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) fail('time must be ISO text or Unix seconds');
      // Unzoned broker labels remain wall-time labels; browser locale must not
      // shift them. This coordinate is not a claim that the source used UTC.
      const stamp = value.replace(' ', 'T');
      const time = Date.parse(stamp.length === 10 ? `${stamp}T00:00:00Z` : /Z$|[+-]\d{2}:?\d{2}$/.test(stamp) ? stamp : `${stamp}Z`) / 1000;
      if (!Number.isFinite(time)) fail('invalid time');
      return time;
    };
    const mapped = rows.map((row, index) => {
      const time = parseTime(row[keys.time]);
      const values = Object.fromEntries(['open', 'high', 'low', 'close'].map(key => [key, numeric(row[keys[key]])]));
      if (Object.values(values).every(value => value === null)) return { time, row, index, data: { time } };
      if (Object.values(values).some(value => value === null)) fail(`row ${index}: OHLC requires all four prices, or all missing`);
      if (values.high < Math.max(values.open, values.close, values.low) || values.low > Math.min(values.open, values.close, values.high)) fail(`row ${index}: invalid OHLC bounds`);
      return { time, row, index, data: { time, ...values } };
    }).sort((a, b) => a.time - b.time);
    const byTime = new Map(mapped.map(record => [record.time, record]));
    if (byTime.size !== mapped.length) fail('duplicate candle times');

    const heading = document.createElement('div'); heading.className = 'sc-market-values';
    heading.style.cssText = 'font-size:12px;min-height:24px;color:var(--report-muted);font-variant-numeric:tabular-nums';
    const surface = document.createElement('div'); surface.className = 'sc-market-chart';
    surface.style.cssText = `height:${spec.height ?? 360}px;width:100%;min-width:0`;
    surface.setAttribute('role', 'img'); surface.setAttribute('aria-label', spec.title || 'Candlestick chart');
    surface.dataset.chartRuntime = 'lightweight-charts';
    // The library uses a table for axis layout. Report data-table rules must
    // not resize its cells or add borders that clip the price/time canvases.
    const style = document.createElement('style');
    style.textContent = '.sc-market-chart table{table-layout:auto;border-collapse:separate;border-spacing:0}.sc-market-chart td{padding:0;border:0}.sc-market-chart tr:hover{background:transparent}';
    svg.style.display = 'none'; svg.setAttribute('aria-hidden', 'true');
    frame.append(style, heading, surface);
    const probe = document.createElement('i'); probe.hidden = true; frame.append(probe);
    const color = token => {
      probe.style.color = `var(${token},var(--report-default-${token.slice(2)}))`;
      return getComputedStyle(probe).color;
    };
    const stamp = time => byTime.get(time)?.row[keys.time] ?? new Date(time * 1000).toISOString().slice(0, 16).replace('T', ' ');
    const chart = library.createChart(surface, {
      autoSize: true,
      // Attribution is already available in Sesame settings, like the workbench.
      layout: { background: { type: library.ColorType.Solid, color: 'transparent' }, textColor: color('--chart-text'), fontFamily: getComputedStyle(frame).fontFamily, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: color('--chart-grid') }, horzLines: { color: color('--chart-grid') } },
      crosshair: { mode: library.CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: .09, bottom: .06 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 8, minBarSpacing: 1, tickMarkFormatter: time => String(stamp(time)).replace('T', ' ').slice(5, 16) },
      localization: { locale: document.documentElement.lang || 'en', timeFormatter: time => String(stamp(time)) },
      // Keep ordinary page scrolling; dragging/pinching and axis scaling are
      // the chart's existing interactions, without a separate report toolbar.
      handleScroll: { mouseWheel: false }, handleScale: { mouseWheel: false, pinch: true },
    });
    let disposed = false;
    const themeObserver = new MutationObserver(() => applyTheme());
    ctx.onCleanup(() => { disposed = true; themeObserver.disconnect(); chart.remove(); });
    const series = chart.addSeries(library.CandlestickSeries, {
      upColor: color('--chart-up'), downColor: color('--chart-down'), wickUpColor: color('--chart-up'), wickDownColor: color('--chart-down'),
      borderVisible: false, priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
    });
    series.setData(mapped.map(record => record.data)); chart.timeScale().fitContent();
    const describe = record => {
      if (!record) return;
      heading.textContent = `${record.row[keys.time]}   O ${record.row[keys.open] ?? '—'}   H ${record.row[keys.high] ?? '—'}   L ${record.row[keys.low] ?? '—'}   C ${record.row[keys.close] ?? '—'}${spec.unit ? ` · ${spec.unit}` : ''}`;
    };
    describe(mapped.at(-1));
    chart.subscribeCrosshairMove(event => describe(byTime.get(event.time) ?? mapped.at(-1)));
    chart.subscribeClick(event => {
      const record = byTime.get(event.time); if (!record) return;
      target.dispatchEvent(new CustomEvent('chartselect', { bubbles: true, detail: { row: record.row, index: record.index } }));
      spec.onSelect?.(record.row, record.index);
    });
    function applyTheme() {
      if (disposed) return;
      chart.applyOptions({ layout: { textColor: color('--chart-text'), fontFamily: getComputedStyle(frame).fontFamily }, grid: { vertLines: { color: color('--chart-grid') }, horzLines: { color: color('--chart-grid') } } });
      series.applyOptions({ upColor: color('--chart-up'), downColor: color('--chart-down'), wickUpColor: color('--chart-up'), wickDownColor: color('--chart-down') });
    }
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    void document.fonts?.ready.then(applyTheme);
    const ready = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    global.report?.track?.(ready);
  });
})(window);
