---
name: report-design
description: 延续 Sesame 原版 reportKit 的结论、指标、图表章节与折叠方法，按问题选图，并按需补充单位点阵和下钻交互；编写或更新研究、策略报告时使用。
---

默认从 `report_template` 起步，保留原版 reportKit 的字体、留白、无框图表和章节层级，再按研究问题编辑 outline。模板会将 `assets/editorial.css`、`assets/report-kit.js` 和可选的 `assets/editorial-charts.js` 内联，报告可独立运行。宿主提供数据桥与主题；reportKit 是本插件的组件，不是宿主自动注入的全局能力。从零写 HTML 时可复用这些资产并随成果打包。

## 页面骨架

```html
<main id="report"></main>
<!-- 使用 report_template 时组件已内联。以下内容替换模板中的 initialize。 -->
<script>
async function initialize() {
  const rows = await reportKit.rows('binding-id'); // 精确绑定 ID，读取全部分页
  reportKit.render('#report', { title, verdict, metrics, sections, method });
}
window.report.track(initialize()).catch(error => {
  document.getElementById('report').textContent = error.message;
});
</script>
```

建议顺序是「核心判断 → 支持判断的数字 → 证据章节 → 方法与来源」。这是原版的起点，不是只能使用的布局。章节数量、文字长度和自定义呈现不作主观硬限制；真正不同的问题可调整结构，避免填充空洞章节。

## outline 数据结构

| 字段 | 内容 |
|---|---|
| `title` | 研究对象 |
| `eyebrow?` | `Research · 主题` 或 `Strategy · 品种 周期` |
| `subtitle?` | 数据、区间与方法的一句话范围 |
| `meta?` | `[{label, value}]`：区间、样本量、单位、时区 |
| `verdict` | `{tone, headline, detail?}`：核心判断与可信度说明 |
| `metrics?` | `[{label, value, format?, digits?, unit?, tone?, delta?, hint?}]` |
| `sections` | `[{title, takeaway, blocks}]`，按论证顺序 |
| `method?` | `{steps[], limits[], sources[{label, value}]}`，默认折叠 |

block 类型：

- `{type:'chart', …}`：见下文。
- `{type:'findings', items:[{claim, evidence, tone?, caveat?}]}`：evidence 为 `[{label, value, format?, digits?, unit?, tone?}]` 或一句话。
- `{type:'metrics', items}`：节内局部指标。
- `{type:'table', columns, rows, limit?, caption?}`：columns 是字段名或 `{key, label, format, digits, unit, tone}`；默认显示 8 行，其余可展开。
- `{type:'note', text, tone?}`：影响解读的一条说明。
- `{type:'custom', render(el)}`：自定义可视化或交互，使用同一主题。也可直接组合组件，不用整页 render。

`tone`：`positive` / `negative` / `caution` / `neutral`；metric 和 evidence 可用 `'auto'` 按数值正负着色。`format`：`number`、`integer`、`percent`（数值 12.5 → 12.5%）、`ratio`（数值 0.125 → 12.5%）、`currency`（配合 unit）、`text`。`reportKit.format` 使用同一规则。原始字符串不会自动改写精度；金额等字符串请明确 unit，百分比字符串可用 unit:'%'。

## 图表

原版 `reportKit.chart` 支持 `line`、`area`、`bar`、`hbar`、`scatter`、`heatmap`。字段包括 `title`、`caption`（比较对象、读法、单位与时区）、`data`、`x`、`y`（一个字段或数组）、`series?`（分组字段，需单个 y）、`xType?`（time / number / category）、`format?` / `digits?` / `unit?`、`labels?`、`baseline?`、`marks?:[{x,label}]`、`tone:'signed'`、`height?`。heatmap 用 x/y/value 三个字段。

按问题选图：

- 权益、逐日统计、累计量随时间变化 → line；强调一个累积序列 → area。
- 类别或参数组比较 → bar；名称较长、需要排名 → hbar，明确排序规则。
- 盈亏、差值 → bar/hbar 加 `tone:'signed'`；多序列用系列色，保持图例一致。
- 两个连续量的关系 → scatter；两个参数网格或品种 × 区间 → heatmap。
- 构成可用 hbar 表达绝对量。其他更适合问题的图形可在 custom 中实现。
- 一图回答一个问题；同一指标保持单位、精度和顺序一致。时间缺失留缺口，不用零值伪补；网格重复先明确聚合。

图例可开关序列，悬停查看原值。SVG 数值坐标会转 Number；精确字符串保留在提示和表格。过大数据应先登记有来历的聚合结果。chart 最多 20,000 行、8 个序列以免卡住页面；更多数据可分图、筛选或自定义渐进绘制。重新渲染自定义容器前调用 `reportKit.destroy(container)` 释放旧图的 resize observer。

## 在原版基础上补充的图表与交互

借鉴 Lieflat 的「看得见的数据单位」与「概览 → 明细」思路，保留 Sesame 的页面视觉。以下是本插件独立实现的可选补充，不是必须全部使用：

- `SesameCharts.chart(el,{kind:'units',rows,x,y,unitValue,unit,title,onSelect})`：每个圆点对应实际数量。适合样本、事件或交易计数；只接受非负、完整单位，不能靠四舍五入生成虚假圆点，最多 1,000 点。
- `kind:'matrix'`：x/y/value 网格，缺失格显式留空，可键盘选择查看准确数值。适合需要逐格追问的少量分类，原版 heatmap 仍可直接使用。
- line/bar/scatter/matrix/units 的 mark 可以点击或键盘 Enter/Space 选中；`onSelect(row,index)` 连接 `SesameCharts.table(...).select(index)`，让概览和原始明细对应。不要把所有明细常驻主叙事。

```js
{ type:'custom', render(el) {
  const plot = document.createElement('div'), detail = document.createElement('div');
  el.append(plot, detail);
  const table = SesameCharts.table(detail, rows, ['period','trade_count']);
  SesameCharts.chart(plot, {
    kind:'units', rows, x:'period', y:'trade_count', unitValue:1,
    unit:'trades', title:'Trades by period', onSelect:(_,index)=>table.select(index)
  });
} }
```

可交互实例见 `examples/editorial-demo.html`。它只是虚构样本，不能用于金融结论。更多图型按数据问题选择并自行实现；不为了增加花样重复画同一组证据。Lieflat 上游当前为 PolyForm Noncommercial，不能把受限模板或资产直接拷入 MIT 成果。

## 视觉与本地化

保持原版的无框版式：层级靠字号、字重、颜色与留白；少量细线用于指标上方、表格行、证据列表和折叠区；图表直接画在页面。默认主题字体和背景沿用 Sesame，系列色由 `--chart-series-1…6` 提供，正负色用 `--success` / `--danger`。不把每张图再包一层大卡片。

自定义内容优先使用 `--foreground`、`--muted`、`--surface-secondary`、`--border`、`--sans`、`--serif`、`--mono` 等语义变量，不重新定义整页字体和背景。用户指定的主题、专门的色彩编码、不同版式和交互可局部扩展；这不是拒绝任意颜色或 HTML 的校验规则。

任务语言写进 `<html lang>` 和 report_publish.locale。reportKit 的通用标签及数字跟随 document.lang；长篇结论按用户任务语言编写，界面切换不会自动翻译固定研究结果。来源时间先明确时区，不把券商墙上时间默认当 UTC。

## 发布检查

`report_publish` 固定 HTML、数据和资源；随后 `report_check` 才会检查实际桌面/窄屏、脚本、数据和交互。修复真实失败后发布新 revision 并检查。美学选择、章节数和字数不作为发布硬门槛。只有当前版本 receipt 为 rendered，才宣告渲染通过。
