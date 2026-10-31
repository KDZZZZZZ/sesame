# 统计与对照图

这些可选组件沿用 Sesame 原版报告的无框排版与主题色。按问题选图；无需为了使用组件增加章节或重复表达同一结论。它们是独立实现的 SVG，不依赖 Lieflat 模板、CDN 或外部图表运行时。

在 `document` 中使用 `chart` 内容块，`kind` 选择下表图型；字段映射、单位与显示参数放 `options`。Report 自动提供所需本地组件与交互，不加载外部库、不写 HTML 或回调。

以下是内容块示意，`registered-result` 必须是 `report_publish.data` 中的真实固定绑定；不是独立的发布请求。

```json
{
  "type": "chart",
  "kind": "strip",
  "title": "逐笔盈亏",
  "data_id": "registered-result",
  "columns": ["label", "value"],
  "options": {"x": "label", "y": "value", "unit": "R"},
  "takeaway": "填写原结果实际支持的分布判断。",
  "source_note": "填写原数据来源、样本范围与 R 的定义。"
}
```

鼠标点击或键盘选择保留原始行身份，即使组件为绘图排序也不改源记录。坐标轴可用短格式，原始十进制字符串保留在提示与末尾明细；不要把显示格式写回可信数据。

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

`unit`、`height` 属于 options；`title`、`rows` 或 `data_id` 位于 chart 顶层，不接收回调。未知或非法数值明确报错；没有可展示样本时用简短判断说明实际状态，不造零值图。单图最多 2,500 行，分组图最多 40 组；箱线的箱体加异常值也最多 2,500 个可选择标记。大数据先登记可解释的筛选／汇总结果，或拆分图表。

## 各图的结果要求


瀑布 `options` 映射示例为 `{x: "component", y: "amount", type: "role", unit: "USD"}`。类型为 start / delta / total / end；首行 start、末行 end，中间 total 为累计检查点。

瀑布不能漏掉成本再声称净收益。起点、变化与终点必须同币种同口径；没有成交前对照价格时，不能再把已经包含在成交价里的滑点扣一次。默认严格对账。只有登记结果明确存在舍入差时才设置 `balanceTolerance:'0.01'`，图下注记会指出容许差；不会悄悄改写终点。缺失金额无法对账，会要求先补齐证据。


哑铃可映射 `{x: "strategy", before: "is_return_pct", after: "oos_return_pct", beforeLabel: "IS", afterLabel: "OOS", unit: "%"}`；逐笔点可映射 `{x: "session", y: "pnl_r", id: "trade_id", unit: "R"}`，字段值均来自原结果。

哑铃只连接两个都存在的端点。逐笔点的纵向错开仅减少遮挡，不代表概率或第二个数值维度。缺失点有明确数量说明；不会出现在零值位置。


直方图必须提供真实 `sampleCount` 和 `method`；`lastBinClosed` 描述末箱是否右闭。已有不等宽分箱使用 `valueType: "density"` 并将 y 映射为已计算密度。不能照抄演示的样本量、分箱或边界。

直方图保留真实区间宽度和空隙，拒绝重叠区间。频数模式要求等宽、非负整数，完整频数之和必须等于 `sampleCount`。缺失频数不会假装成零；已知频数不能超过样本量。不同宽度的箱应使用已经登记的密度，且任何非缺失密度都必须有正样本量，不能用频数高度制造错误面积。`method` 要写清分箱和边界规则。


箱线输入须满足 `low ≤ q1 ≤ median ≤ q3 ≤ high`。outliers 是原始数值数组，必须位于已声明须线之外。完整箱体必须有正样本量，异常点数必须小于样本量，至少保留一个非异常样本。缺少任何统计量就只显示缺失，不猜测箱形。点击异常点选择的是对应统计行，提示包含该异常值；若要追踪原始交易 ID，另用逐笔点与交易表。


每组密度使用同一横轴和密度缩放；山脊高度或小提琴半宽表示密度，不表示样本量。n 可以在同组各行重复，也可只写在一行，但非空值必须一致；单组时可用 `sampleCount`。每个坐标只能一行，不能有负密度；用明确坐标加 `density:null` 表达缺口。组件只连接已经提供的网格点，不估计 KDE、不额外平滑、不向未提供的尾部外推。分布比较须保持单位、估计方法和区间可比。

渲染验证用的全部小样本见 `examples/statistical-fixtures.json`。它们明确标记为 demo，不能用作任何市场或策略结论。
