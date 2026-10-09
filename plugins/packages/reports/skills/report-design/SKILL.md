---
name: report-design
description: 用 reportKit 把 Research / Strategy 报告组织成「结论 → 关键指标 → 图表章节 → 折叠方法」的统一结构，并按问题选择图表、沿用产品视觉；编写或更新报告时使用。
---

宿主已注入 `theme.css`、`report.css` 和 `window.reportKit`。默认用 `reportKit.render(root, outline)` 生成整页：版式、图表、配色、悬停提示和窄屏适配由宿主负责，报告只提供结构化数据。不要写整页 `<style>`，不要手绘图表 SVG，不要使用字面颜色。语言规则见 report-writing skill。

## 页面骨架

```html
<main id="report"></main>
<!-- 仅 Strategy：保留这一行，用 {type:'backtest'} 块决定它在哪一节出现 -->
<section data-report-component="backtest"></section>
<script>
reportData.track(async () => {
  const rows = await reportKit.rows('数据源标题或 ID'); // 自动读完全部分页；Strategy 源可传 parameters
  reportKit.render('#report', { title, verdict, metrics, sections, method });
}).catch(() => {});
</script>
```

## outline 数据结构

长度单位：中文 1 字 = 1，其他非空白字符 = ½。超过上限或结构不合法时 reportKit 抛出 `reportKit: …`，发布检查把它作为可恢复问题返回；按提示精简 outline，不要绕开 render。

| 字段 | 内容 | 上限 |
|---|---|---|
| `title` | 研究对象，不含结论 | 40 |
| `eyebrow?` | `Research · 主题` 或 `Strategy · 品种 周期` | 24 |
| `subtitle?` | 一句范围：数据、区间、方法 | 80 |
| `meta?` | `[{label, value}]`：区间、样本量、单位、时区 | 6 项 |
| `verdict` | `{tone, headline, detail?}`，全文唯一结论 | 80 / 160 |
| `metrics?` | `[{label, value, format?, digits?, unit?, tone?, delta?, hint?}]` | 8 项，建议 4–6 |
| `sections` | `[{title, takeaway, blocks}]`，按论证顺序 | 6 节，建议 3–4 |
| `method?` | `{steps[], limits[], sources[{label, value}]}`，默认折叠 | 各 8 条，每条 100 |

block 类型（每节最多 6 块，第一块通常是图表）：

- `{type:'chart', …}`：见下文。
- `{type:'findings', items:[{claim, evidence, tone?, caveat?}]}`：evidence 是 `[{label, value, format?, digits?, unit?, tone?}]`（≤ 4 项）或一句话。
- `{type:'metrics', items}`：节内的局部指标。
- `{type:'table', columns, rows, limit?, caption?}`：columns 为字段名或 `{key, label, format, digits, unit, tone}`；默认显示 8 行，其余折叠。
- `{type:'note', text, tone?}`：一条影响解读的提醒。
- `{type:'backtest'}`：放置原生回测组件（Strategy）。
- `{type:'custom', render(el)}`：确实需要的自定义交互；在 el 内用宿主类和变量。

`tone` 取 `positive` / `negative` / `caution` / `neutral`；metric 与 evidence 可用 `'auto'` 按正负着色。`format`：`number`、`integer`、`percent`（值已是百分点：12.5 → 12.5%）、`ratio`（小数：0.125 → 12.5%）、`currency`（配合 `unit`）、`text`。`reportKit.format(value, {format, digits, unit, signed})` 用同一规则格式化写进句子的数字。

## 图表

`chart` 字段：`kind`、`title`（≤ 30）、`caption`（≤ 80，写读法：比较对象、单位或时区、口径）、`data`（对象数组）、`x`、`y`（字段名或字段数组）、可选 `series`（分组字段，需单个 y）、`xType`（time / number / category，默认推断）、`format` / `digits` / `unit`、`labels`（y 字段显示名）、`baseline`（参考线，如初始资金或 0）、`marks`（`[{x, label}]` 竖线，如训练 / 验证分界）、`tone:'signed'`（柱按正负着色）、`height`。heatmap 用 `x`、`y`、`value` 三个字段。

按问题选图：

- 随时间变化（权益、逐日统计、累计值）→ `line`；单一序列强调累积量 → `area`。
- 类别或参数组比较 → `bar`（类别 ≤ 12）；名称较长或需要排名 → `hbar`，先按数值排序。
- 盈亏、差值等有正负的量 → `bar` / `hbar` 加 `tone:'signed'`（只对单序列生效；多序列按序列颜色区分）。
- 两个连续变量的关系 → `scatter`。
- 两个参数的网格（如 Lookback × 止损）或 品种 × 区间 → `heatmap`。
- 构成用 `hbar` 显示各部分绝对值；不用饼图。
- 一张图回答一个问题，≤ 6 条序列；同一指标全文使用相同单位、精度和序列顺序。

每个含数字比较的章节至少一张图。表格只用于必须逐行查看的内容（被排除记录、逐笔明细），不要把图里已经表达的数字再列成表。

## 视觉

配色、字体、版式和间距来自宿主，与产品界面一致：浅色使用奶白背景、黑色正文和深绿到浅绿的渐变，深色使用近黑背景、白色正文和蓝紫渐变；跟随宿主切换，渐变只做强调，正负结果用 `--success` / `--danger`，不能把负收益着成正面颜色。版式是无框的：层级靠字号、字重、颜色和留白，少量全宽细线只用于统计数字上方、表格行和列表行之间；图表直接画在页面上。自定义内容同样不要加卡片、边框盒或色块背景，也不要把单个按钮放进 `.report-tabs`（它只用于真正的标签页切换）。必须补充样式时只写少量布局 CSS，颜色只引用变量：`var(--foreground)`、`var(--muted)`、`var(--surface)`、`var(--border)`、`var(--chart-series-1)`…`var(--chart-series-6)`、`var(--success)`、`var(--danger)`、`var(--warning)`。发布检查会拒绝 `<style>`、`style=""` 与 SVG 属性中的字面颜色（#hex、rgb()、hsl()、命名色）。

不用 reportKit 的手写页面仍可使用 `.report-header`、`.report-meta`、`.report-metrics` / `.report-metric`、`.report-section`、`.report-note`、`.report-table`、`.report-tabs`；结构与语言规则同样适用。

## 本地化

使用宿主 i18n：`reportI18n.locale` 为 zh-CN / en；`reportI18n.t({'zh-CN':'研究摘要', en:'Summary'})` 选择文字。静态节点可写 `<h2 data-i18n-zh="研究摘要" data-i18n-en="Summary"></h2>`，宿主会自动填充。长篇分析按当前任务语言撰写；切换界面语言不会凭空翻译已保存的研究结论。时间先明确来源时区，不能把券商墙上时间默认当作 UTC。

## 发布检查

`report_publish` 在隔离浏览器中检查桌面与窄屏布局、真实数据加载、可见交互、字面颜色，以及首屏可见文字量：上限 3000 单位，目标 ≤ 1500；折叠的 method、`<details>` 和原生回测组件不计入。超限时把过程、口径和长表移入 method 或折叠区，不要删掉支撑结论的图表。验证未通过不会发布；修改原 HTML 后重新调用，只有成功响应才可向用户宣告报告完成。
