# 统计与对照图

这些可选组件沿用 Sesame 原版报告的无框排版与主题色。按问题选图；无需为了使用组件增加章节或重复表达同一结论。它们是独立实现的 SVG，不依赖 Lieflat 模板、CDN 或外部图表运行时。

先加载 `assets/editorial-charts.js`，再加载 `assets/charts-statistics.js`。`report_template` 的整合以插件实际输出为准；从零写 HTML 时需要内联这两个本地资产。组件入口仍是 `SesameCharts.chart(element, spec)`。`spec.rows` 必须来自固定数据绑定：

```js
const rows = await reportKit.rows('registered-result');
const detail = SesameCharts.table(tableElement, rows, ['label', 'value']);
SesameCharts.chart(chartElement, {
  kind: 'strip', rows, x: 'label', y: 'value', unit: 'R',
  title: '逐笔盈亏', onSelect: (_row, index) => detail.select(index)
});
```

鼠标点击、Tab 后 Enter／空格均选择原始行；`onSelect(row,index)` 中的 index 是输入 rows 的原始索引，即使组件按区间或坐标排序也不变。图形坐标使用 Number，可见坐标轴采用短格式；悬停、键盘提示及原始表格保留十进制字符串。不要把格式化字符串写回可信数据。

统计和估计必须先由数据／回测／研究插件计算并登记。渲染器不从交易样本重新计算分箱、分位数或 KDE；不把 null 变为零。没有足够样本时优先显示逐笔点和样本数，而不是制作貌似稳定的分布。

## 字段映射

| kind | 字段与选项 | 用途 |
|---|---|---|
| `waterfall` | `x` 标签（默认 label）、`y` 金额（value）、`type` 类型字段（type）；可选 `balanceTolerance` | 余额、毛收益到净收益的可对账增减 |
| `dumbbell` | `x` 标签（label）、`before` / `after` 数值字段；可选 `beforeLabel` / `afterLabel` | 同指标的 IS/OOS 或前后对照 |
| `strip` | `y` 数值（value）；可选 `x` 分组字段、`id` 记录字段、`jitter` 0–0.4 | 每点一行的交易／事件分布 |
| `histogram` | `x` 下界（lower）、`xEnd` 上界（upper）、`y` 已登记频数／密度（count）、`sampleCount`、`method` | 已登记的连续区间分布 |
| `boxplot` | `x` 组（group）、`low/q1/median/q3/high/n/outliers` 各字段名；默认与选项名相同；`method` | 已登记五数概括与异常值 |
| `ridgeline` / `violin` | `x` 采样坐标（value）、`y` 已登记密度（density）、`group` 组（group）、`n` 样本量字段（n）、`method` | 比较真实登记的密度形状 |

通用选项包括 `rows`、`title`、`unit`、`height` 和 `onSelect`。未知或非法数值会明确报错；空数据由公共组件显示空状态。单图最多 2,500 行，分组图最多 40 组；箱线的箱体加异常值也最多 2,500 个可选择标记。大数据先登记可解释的筛选／汇总结果，或拆分图表。

## 可直接编辑的示例

```js
// 起点/变化/终点均来自已登记结果；首行 start，末行 end。
SesameCharts.chart(el, {
  kind: 'waterfall', rows: await reportKit.rows('cost-reconciliation'),
  x: 'component', y: 'amount', type: 'role', unit: 'USD'
});
// role 可为 start / delta / total / end。中间 total 是累计检查点。
// 例如 1000 + 25.30 - 1.10 = 1024.20；比较使用精确十进制。
```

瀑布不能漏掉成本再声称净收益。起点、变化与终点必须同币种同口径；没有成交前对照价格时，不能再把已经包含在成交价里的滑点扣一次。默认严格对账。只有登记结果明确存在舍入差时才设置 `balanceTolerance:'0.01'`，图下注记会指出容许差；不会悄悄改写终点。缺失金额无法对账，会要求先补齐证据。

```js
SesameCharts.chart(el, {
  kind: 'dumbbell', rows: await reportKit.rows('window-comparison'),
  x: 'strategy', before: 'is_return_pct', after: 'oos_return_pct',
  beforeLabel: 'IS', afterLabel: 'OOS', unit: '%'
});

SesameCharts.chart(el, {
  kind: 'strip', rows: await reportKit.rows('trades'),
  x: 'session', y: 'pnl_r', id: 'trade_id', unit: 'R'
});
```

哑铃只连接两个都存在的端点。逐笔点的纵向错开仅减少遮挡，不代表概率或第二个数值维度。缺失点有明确数量说明；不会出现在零值位置。

```js
SesameCharts.chart(el, {
  kind: 'histogram', rows: await reportKit.rows('registered-bins'),
  x: 'lower', xEnd: 'upper', y: 'count', sampleCount: 243,
  method: '预先登记的等宽 0.5R 分箱；左闭右开，末箱右闭',
  lastBinClosed: true, unit: 'R'
});
// 已登记的不等宽区间需要预计算的密度：
// y:'density', valueType:'density'；sampleCount 和 method 仍必填。
```

直方图保留真实区间宽度和空隙，拒绝重叠区间。频数模式要求等宽、非负整数，完整频数之和必须等于 `sampleCount`。缺失频数不会假装成零；已知频数不能超过样本量。不同宽度的箱应使用已经登记的密度，且任何非缺失密度都必须有正样本量，不能用频数高度制造错误面积。`method` 要写清分箱和边界规则。

```js
SesameCharts.chart(el, {
  kind: 'boxplot', rows: await reportKit.rows('registered-quantiles'),
  x: 'regime', low: 'whisker_low', q1: 'q25', median: 'q50',
  q3: 'q75', high: 'whisker_high', n: 'sample_count', outliers: 'outlier_values',
  method: '已登记分位数方法与须线规则', unit: 'R'
});
```

箱线输入须满足 `low ≤ q1 ≤ median ≤ q3 ≤ high`。outliers 是原始数值数组，必须位于已声明须线之外。完整箱体必须有正样本量，异常点数必须小于样本量，至少保留一个非异常样本。缺少任何统计量就只显示缺失，不猜测箱形。点击异常点选择的是对应统计行，提示包含该异常值；若要追踪原始交易 ID，另用逐笔点与交易表。

```js
SesameCharts.chart(el, {
  kind: 'ridgeline', // 也可改为 'violin'
  rows: await reportKit.rows('registered-density-grid'),
  x: 'return_r', y: 'density', group: 'regime', n: 'sample_count',
  method: '计算产物中记录的 KDE 核、带宽、取样区间与归一化口径', unit: 'R'
});
```

每组密度使用同一横轴和密度缩放；山脊高度或小提琴半宽表示密度，不表示样本量。n 可以在同组各行重复，也可只写在一行，但非空值必须一致；单组时可用 `sampleCount`。每个坐标只能一行，不能有负密度；用明确坐标加 `density:null` 表达缺口。组件只连接已经提供的网格点，不估计 KDE、不额外平滑、不向未提供的尾部外推。分布比较须保持单位、估计方法和区间可比。

渲染验证用的全部小样本见 `examples/statistical-fixtures.json`。它们明确标记为 demo，不能用作任何市场或策略结论。
