# 现成图表完整目录

写报告前先查此表，优先调用现成组件及其默认样式。用户没有要求重新设计时，不手画已有图型。已有报告直接复用组件；仅当现成图型无法表达研究问题时，再在统一骨架的 `custom` 中补充。

## 两个调用入口

- **K = `reportKit.chart(el,{kind,data,...})`**，也可用 `reportKit.render` 的 `{type:'chart',kind,data,...}`。默认报告模板已内联。支持 6 个 kind：`line`、`area`、`bar`、`hbar`、`scatter`、`heatmap`。
- **S = `SesameCharts.chart(el,{kind,rows,...})`**，用于 `custom` 区块，数据仍来自固定绑定。支持 23 个 kind，见表中 S。`report_template({kind,...})` 接受这 23 个名称，并为 line/bar/scatter 选择 reportKit；其余调用 SesameCharts。
- `area`、`hbar`、`heatmap` 是 K 入口，不能直接填入 `report_template.kind`。先生成统一模板，再在 outline 中调用 K。不要把同一名称在两个入口的字段契约混用：K 用 `data`，S 用 `rows`。
- `report_template` 的 `chart_options` 只传映射与选项，主行来自 `data_id`；独立节点绑定通过 `chart_data`，不能把临时演示 rows 当成真实数据。

以下共 **26 种不同 kind**，相同名称在两个入口都存在时只计一次。

| 现成图型 / kind | 入口 | 主要字段 | 用途与详情 |
| --- | --- | --- | --- |
| 折线 `line` | K / S | `x`、`y`；K 支持 y 数组、series、xType | 时间趋势、主序列与参照；默认优先 K |
| 面积 `area` | K | `x`、`y`、xType | 强调一个累计或规模序列 |
| 柱形 `bar` | K / S | `x`、`y` | 类别比较；盈亏用 K 的 `tone:'signed'` |
| 横条 `hbar` | K | `x`、`y` | 长名称、排名、构成；盈亏用 `tone:'signed'` |
| 散点 `scatter` | K / S | `x`、`y` | 两个连续量的关系；默认优先 K |
| 热力图 `heatmap` | K | `x`、`y`、`value` | 两个参数或类别维度的数值对照 |
| 网格矩阵 `matrix` | S | `x`、`y`、`value` | 少量类别逐格检查；完整网格，缺失显式 null |
| 单位点阵 `units` | S | `x`、`y`、`unitValue` | 每点代表一个明确数量单位 |
| 蜡烛图 `candlestick` | S | `time/open/high/low/close`、`digits` | 默认行情样式；[行情图契约](market-charts.md)，无需手画 SVG |
| 瀑布 `waterfall` | S | `x`、`y`、`type` | 起点、增减、终点对账；[统计图契约](statistical-charts.md) |
| 哑铃 `dumbbell` | S | `x`、`before`、`after` | 同口径的前后或样本内外对照 |
| 逐笔点 `strip` | S | `y`，可选 `x`、`id` | 原始交易/事件分布 |
| 直方 `histogram` | S | `x/xEnd/y`、`sampleCount`、`method` | 已计算的分箱频数/密度 |
| 箱线 `boxplot` | S | `x`、`low/q1/median/q3/high/n/outliers`、`method` | 已计算的五数统计与异常值 |
| 山脊 `ridgeline` | S | `x/y/group/n`、`method` | 已计算密度的多组对照 |
| 小提琴 `violin` | S | `x/y/group/n`、`method` | 已计算密度的分布形状 |
| 日历 `calendar` | S | `date/value/status`、`timezone` | 盈亏、缺失、休市逐日区分；[时序图契约](temporal-charts.md) |
| 平行坐标 `parallel` | S | `label`、`dimensions` | 3–6 个真实维度比较与过滤 |
| 排名轨迹 `bump` | S | `time/item/rank`、`timezone/universe/ties` | 固定全集中的排名变化 |
| 生命周期 `lifecycle` | S | 真实状态事件、实体/版本 ID、证据 | 验证、停用、恢复的已发生过程；字段见时序图契约 |
| 矩形树图 `treemap` | S | `id/parentId/label/value/side` | 非负敞口或分配构成；[结构图契约](structural-charts.md) |
| 交易链路 `threads` | S | `recordId/signalId/orderId/fillId` | 信号 → 委托 → 成交的实际关联 |
| 流向 `flow` | S | rows 的 `id/source/target/value/batch`，独立 `nodes` | 同批次守恒流量 |
| 环形网络 `network-circular` | S | rows 的 `id/source/target/weight/sign`，独立 `nodes` | 固定节点关系对照 |
| 力导向网络 `network-force` | S | 与环形网络相同 | 探索关系群组；距离不代表统计强度 |
| 决策树 `decision-tree` | S | `id/parentId/label/condition/detail`、`height?` | 紧凑横向树，可缩放、拖拽和适配全图；内部节点判断、分支条件、叶子结果；[决策树契约](decision-tree.md) |

## 默认使用规则

K 的细节见 [report-design](SKILL.md)；S 的完整参数和示例见对应子文档。普通模板包含基础、统计、时序、结构与决策树资产；选 `candlestick` 时额外包含本地行情运行时。多图报告需要蜡烛时，按 [行情图](market-charts.md) 内联所需资产一次。运行时 `SesameCharts.kinds()` 可核对当前 HTML 实际已加载的 S 类型，不代表尚未内联的资产不存在。

所有图共用背景、字体与主题；普通强调蓝灰，涨跌和盈亏保留原红绿。统计数据先由研究/计算能力产生并固定；图表不替用户编造数据、概率、回测结果或连接关系。

`report_backtest_template` 另外提供组合报告：SVL 逻辑图、品种×周期选优矩阵、全部参数试验下钻、参数敏感性。这是已有专用报告入口，具体字段见 [回测写作契约](../report-writing/backtest.md)，不是新的 chart kind。

事件日程轴、价格位置区间尚无独立 kind，可在统一 `custom` 中实现；不能把它们当成可调用名称。示例均为 demo，禁止套用其数值替代真实证据。
