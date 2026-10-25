# 默认行情蜡烛图

报告里的 OHLC 使用 `candlestick`。组件直接复用行情工作台已安装的 Lightweight Charts 及同一组主题色；实体、影线、价格轴、时间轴和十字线均由默认库绘制。不要在报告里重画 SVG 蜡烛、另做空心蜡烛样式或自行拼接坐标轴。图内不重复展示 logo，统一署名位于 Sesame 设置。

## 直接生成

```js
report_template({
  output_path: 'research.html', title: '行情研究', locale: 'zh-CN',
  summary: '填写已有证据支持的结论', data_id: 'fixed-ohlc',
  chart_title: '研究标的 · H4', takeaway: '填写本图回答的问题',
  source_note: '填写来源、固定时点、原始时区与实际范围',
  kind: 'candlestick', unit: 'USD/盎司',
  chart_options: { time: 'time', open: 'open', high: 'high', low: 'low', close: 'close', digits: 2 },
  columns: ['time', 'open', 'high', 'low', 'close']
});
```

模板仅在选用 `candlestick` 时内联其本地运行时。已有多图报告生成上述临时模板取得完整资产，再将组件放进原 `reportKit.render` 的 `custom` 区块。大型库是插件内部资产，不作为给模型阅读的独立资源公开；无需逐行读取或改写库源码。

```js
{ type: 'custom', render(el) {
  SesameCharts.chart(el, {
    kind: 'candlestick', rows: fixedH4Rows, title: '研究标的 · H4',
    time: 'time', open: 'open', high: 'high', low: 'low', close: 'close',
    digits: 2, height: 360, unit: 'USD/盎司',
    onSelect: (row, originalIndex) => inspectOriginal(row, originalIndex)
  });
} }
```

模板已按顺序内联 `assets/editorial-charts.js`、`assets/vendor/lightweight-charts.js`、`assets/charts-market.js`，样式来自 `assets/editorial.css`。已有组件不重复加载。所有资产随报告发布，不引用 CDN 或本机绝对路径。

## 字段与行为

| 选项 | 要求 |
| --- | --- |
| `rows` | 固定 OHLC 原始行；单图最多 2,500 条。保留原始金额字符串，坐标使用 Number |
| `time` | 时间字段名，默认 `time`，也可用 `x`。接受 ISO 日期/时间或 Unix **秒** |
| `open/high/low/close` | 四个价格字段名，默认同名。全缺失保留时间空位，部分缺失或高低范围矛盾报错，不补零 |
| `digits` | 显示精度，默认 2，范围 0–8；不更改原始值 |
| `height` | 图高，默认 360px；宽度跟随容器 |
| `unit` | 数值单位，显示于 OHLC 读数旁 |
| `onSelect(row,index)` | 点击返回固定原行与输入索引；排序只用于画图，不改源行 |

无时区的券商日期/时间保持原墙时标签，不按浏览器时区挪动。带 offset 的时间使用实际瞬时坐标，悬停保留原始标签；报告必须说明时间口径。重复时点需要先核对来源，不静默合并。

涨跌沿用 `--chart-up` / `--chart-down`，明暗主题自动更新；普通主题蓝灰不覆盖涨跌。支持拖动、缩放轴、触控缩放和十字线，鼠标滚轮保持报告页面滚动。明细由报告表格提供，也支持键盘阅读。PDF/图片由报告的统一静态导出流程捕获 Canvas，交付前检查当前版本。替换视图时调用句柄 `destroy()` 或 `SesameCharts.destroy(container)`。
