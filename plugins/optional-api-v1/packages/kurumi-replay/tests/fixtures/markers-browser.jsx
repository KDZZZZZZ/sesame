    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { PriceChart } from '/src/features/trading/price-chart.tsx';
    import { cleanIndicatorFrame } from '/src/features/canvas/plot-series.ts';
    /*__CASE_IMPORTS__*/
    const cases = /*__CASES__*/[];
    const evaluators = [compute0, compute1];
    window.browserCases = cases.map((c, i) => ({ ...c,
      output: evaluators[i]({ inputs: { price: { rows: c.bars } } }),
      chartBars: c.bars.map(b => ({ time: b.openTime.unixMs / 1000, open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: NaN })),
    }));
    function App() {
      const [broken, setBroken] = useState(false); window.setBroken = setBroken;
      return React.createElement('div', { className: 'test-grid' }, ...window.browserCases.map(c => {
        const frame = structuredClone(c.output.series);
        if (broken) frame.find(s => s.seriesId === 'original-events').markers[0].time.unixMs = c.at;
        const plotSeries = cleanIndicatorFrame(frame, c.definition);
        return React.createElement(PriceChart, { key: c.name, symbol: c.name, bars: c.chartBars,
          plotSeries, trades: [], period: 'H1', digits: 6, style: 'candles', volume: false,
          averages: false, logarithmic: false, showTrades: false, onSelect: () => {}, onLatest: () => {}, onEarlier: () => {} });
      }));
    }
    createRoot(document.getElementById('root')).render(React.createElement(App));
    window.settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80))));
    window.inspectPixels = () => window.realCharts.map(({ chart, series }, i) => {
      const canvas = chart.takeScreenshot(), data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = { event: 0, buy: 0, sell: 0, interval: 0 }, nearMarker = { event: 0, buy: 0, sell: 0 };
      const markerSeries = { event: series[7], buy: series[4], sell: series[5] };
      const positions = Object.fromEntries(Object.entries(markerSeries).map(([key, s]) => { const p = s.data()[0]; return [key, p ? { x: chart.timeScale().timeToCoordinate(p.time), y: s.priceToCoordinate(p.value) } : null]; }));
      const colors = Object.fromEntries(Object.entries({ event: 'original-events', buy: 'actual-buy', sell: 'actual-sell', interval: 'original-intervals' }).map(([key, id]) => [key, window.browserCases[i].definition.series.find(s => s.id === id).style.color.slice(1).match(/../g).map(hex => parseInt(hex, 16))]));
      for (let p = 0; p < data.length; p += 4) for (const [key, rgb] of Object.entries(colors)) {
        if (data[p] === rgb[0] && data[p+1] === rgb[1] && data[p+2] === rgb[2] && data[p+3] > 240) {
          counts[key]++; const point = positions[key], x = (p / 4) % canvas.width, y = Math.floor(p / 4 / canvas.width);
          if (point && Math.abs(x - point.x) < 14 && y > point.y - 38 && y < point.y + (key === 'event' ? 0 : 30)) nearMarker[key]++;
        }
      }
      const event = series[7], buy = series[4], sell = series[5], interval = series[6];
      return { name: window.browserCases[i].name, initialBars: series[0].data().length,
        eventPoints: event.data(), intervalPoints: interval.data(), buyPoints: buy.data(), sellPoints: sell.data(), counts, nearMarker,
        markers: window.realMarkerPlugins.filter(p => series.includes(p.series)).map(p => p.api.markers()),
        anchorX: chart.timeScale().timeToCoordinate(window.browserCases[i].anchor / 1000),
        eventRealAt: new Date(window.browserCases[i].at).toISOString(),
        eventDisplayAnchor: new Date(window.browserCases[i].anchor).toISOString(),
      };
    });
