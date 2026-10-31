# 现成图表完整目录

按问题选择现成图型及默认样式。所有图型都通过 `document` 的 `chart` 内容块声明，由 Report 自动加载本地组件；不编写自定义 HTML、CSS 或绘图回调。

`chart` 提供 `title`、`kind`、`columns`、`takeaway`、`source_note`，字段映射与显示参数放 `options`；数据选固定 `data_id` 或已有 `rows`，二选一。节点可来自固定 `nodes` 或 `chart_data` 绑定。完整字段见 [components.md](components.md)。`report_template` 只作预览，不是发布前置步骤。

以下共 **38 种 kind**。底层可能使用不同组件，但公开内容入口一致。

| 现成图型 / kind | options 主要字段 | 用途与详情 |
| --- | --- | --- |
| 折线 `line` | `x`、`y`；支持 y 数组、series、xType | 时间趋势、主序列与参照 |
| 面积 `area` | `x`、`y`、xType | 强调一个累计或规模序列 |
| 柱形 `bar` | `x`、`y` | 类别比较；盈亏用 `tone:'signed'` |
| 横条 `hbar` | `x`、`y` | 长名称、排名、构成；盈亏用 `tone:'signed'` |
| 散点 `scatter` | `x`、`y` | 两个连续量的关系 |
| 热力图 `heatmap` | `x`、`y`、`value` | 两个参数或类别维度的数值对照 |
| 网格矩阵 `matrix` | `x`、`y`、`value` | 少量类别逐格检查；完整网格，缺失显式 null |
| 单位点阵 `units` | `x`、`y`、`unitValue` | 每点代表一个明确数量单位 |
| 蜡烛图 `candlestick` | `time/open/high/low/close`、`digits` | 默认行情样式；[行情图契约](market-charts.md)，无需手画 SVG |
| 瀑布 `waterfall` | `x`、`y`、`type` | 起点、增减、终点对账；[统计图契约](statistical-charts.md) |
| 哑铃 `dumbbell` | `x`、`before`、`after` | 同口径的前后或样本内外对照 |
| 逐笔点 `strip` | `y`，可选 `x`、`id` | 原始交易/事件分布 |
| 直方 `histogram` | `x/xEnd/y`、`sampleCount`、`method` | 已计算的分箱频数/密度 |
| 箱线 `boxplot` | `x`、`low/q1/median/q3/high/n/outliers`、`method` | 已计算的五数统计与异常值 |
| 山脊 `ridgeline` | `x/y/group/n`、`method` | 已计算密度的多组对照 |
| 小提琴 `violin` | `x/y/group/n`、`method` | 已计算密度的分布形状 |
| 日历 `calendar` | `date/value/status`、`timezone` | 盈亏、缺失、休市逐日区分；[时序图契约](temporal-charts.md) |
| 平行坐标 `parallel` | `label`、`dimensions` | 3–6 个真实维度比较与过滤 |
| 排名轨迹 `bump` | `time/item/rank`、`timezone/universe/ties` | 固定全集中的排名变化 |
| 生命周期 `lifecycle` | 真实状态事件、实体/版本 ID、证据 | 验证、停用、恢复的已发生过程；字段见时序图契约 |
| 矩形树图 `treemap` | `id/parentId/label/value/side` | 非负敞口或分配构成；[结构图契约](structural-charts.md) |
| 交易链路 `threads` | `recordId/signalId/orderId/fillId` | 信号 → 委托 → 成交的实际关联 |
| 流向 `flow` | rows 的 `id/source/target/value/batch`，独立 `nodes` | 同批次守恒流量 |
| 环形网络 `network-circular` | rows 的 `id/source/target/weight/sign`，独立 `nodes` | 固定节点关系对照 |
| 力导向网络 `network-force` | 与环形网络相同 | 探索关系群组；距离不代表统计强度 |
| 决策树 `decision-tree` | `id/parentId/label/condition/detail`、`height?` | 紧凑横向树，可缩放、拖拽和适配全图；内部节点判断、分支条件、叶子结果；[决策树契约](decision-tree.md) |

| 新增图型 / kind | options 主要字段 | 用途与详情 |
| --- | --- | --- |
| 构成变化 `stream` | `x/series/value`、`xType` | 同一总量的各部分随时间变化 |
| 堆叠刻度柱 `stacked-rungs` | `x/series/value/unitValue` | 比较多个账户或方案的非负构成 |
| 时段气泡 `dot-heatmap` | `x/y/value`、`tone?` | 面积表示数量或绝对值；正负另用红绿 |
| 筛选漏斗 `funnel` | `x/value` | 依次筛选后留下的真实数量 |
| 名单归属 `category-links` | `item/group` | 已有名单与分类一一对应 |
| 历史结果刻度 `outcome-tally` | `x/value/total/unitValue/overlap` | 实际出现次数与样本数；允许结果重叠 |
| 成对刻度柱 `paired-rungs` | `x/before/after/unitValue`、`tone?` | 两次观测的同口径比较 |
| 动态排名 `rank-race` | `time/item/value`、`frame?`、`tone?` | 固定时间序列的规模与排名；默认最新一期 |
| 多维位置 `spectrum` | `label/focus/dimensions` | 当前方案在有明确两端含义的尺度上的位置 |
| 刻度圆环 `tick-donut` | `x/value/unitValue` | 互斥、可相加的组成；每一格对应确定数量 |
| 密集观测 `barcode` | `x/value/xType`、`highlights?` | 长序列的实际观察值，突出已选时点 |
| 年度气泡 `bubble-ledger` | `x/y/value`、`status/event?` | 多类别逐年比较，区分零、缺失和资料不完整 |

以上十二种的完整数据要求见 [构成与比较图](composition-charts.md)。

## 默认使用规则

所有图共用 Report 的背景、字体与蓝灰主题。盈亏、收益及涨跌用红绿（涨赚绿、跌亏红、零值灰），同时保留数值和正负号。其他比较保持蓝灰。盈亏/涨跌的 reportKit 图表用 options.tone:"signed"；回撤、净值及普通比较省略 tone 或用 "neutral"。配色只由指标种类决定，全赚/全亏也保持盈亏红绿，不根据样本正负分布切换配色。热力图亦须显式选择，不能把估值、相关性或样本数当作盈亏。统计数据由研究侧产生并固定，图表不制造数据、概率、回测结果或连接关系。

图型对应子文档中的字段属于 `options` 映射；数据位于 `chart.rows` 或固定绑定，不把数据塞入 options。图例、筛选、缩放和明细联动由组件提供，不能上传回调函数。每图最多 2,500 行，更多记录使用有来源的聚合或分图并保留原数据。

`content.kind: "backtest"` 提供已有回测结果的组合呈现，不是新的 chart kind。它与通用 document 使用同一套样式，细则见 [回测写作契约](../report-writing/backtest.md)。`report_backtest_template` 仅用于预览。

已发生事件用 `lifecycle`，明确边界内的位置可用通用 `range` 块；这些内容组件不规定事件识别算法或价格目标方法。缺少适用图型时组合现成组件或使用表格，不发明可调用的 kind，不转向上传任意页面。所有演示数据仅用于展示，不能代替真实证据。
