---
name: report-design
description: 选择 Report 的通用组件与声明式样式，检查报告阅读、交互和视觉一致性。
---

# 报告设计

本指南的内容字段属于 sesame/reports。宿主选择其他提供者时遵循其 inputSchema，不套用本插件的组件或便利入口。

Report 统一拥有报告组件、样式、公式与交互渲染。先用 `host.reports.describe` 确认宿主所选提供者与输入契约，向 `host.reports.publish` 提交 `input:{content,style?}`；`report_publish` 仅是转接入口。不上传 HTML，不编写页面 CSS、JavaScript 或组件回调。模板、文档及组合 helper 只用于预览，不是发布前置步骤，也不产生可自由编辑后上传的页面。

先按本次问题组织已有结果，再选择呈现。多数任务使用 `content.kind: "document"`，将判断、关键数字、图表和简短推理组合为 `sections`。`modules` 用于已有业务模块结果，`backtest` 用于对应的固定回测数据，`signal-study` 用于已记录的研究运行；这些内容布局不规定研究方法，也不各自另建样式。

## 开始与按需参考

- 用 `report_styles` 查看统一默认、组件和已保存用户样式；不为使用默认排版额外查询样式。
- 省略 `style` 即使用统一蓝灰无框排版。按信息关系选择组件与 `group.layout: columns|stack`；不在几套预设之间选择。
- 用户明确要求样式调整时，使用 `style.custom` 的受控 token；需要复用时 `report_style_save` 保存，再以返回的 `saved_id`、`saved_version` 精确选择。用户要求优先，但扩展仍是声明式配置，不是上传 HTML、CSS 或脚本。
- 组件字段与数据限制见 [components.md](components.md)，通用组合和保存示例见 [style-guide.md](style-guide.md)。
- 先按 [first-screen.md](first-screen.md) 在 `document.overview` 给出短结论和直接答案；回撤、估值等金融名词保留，重复解释下移到正文。
- 按问题选图见 [chart-catalog.md](chart-catalog.md) 与 [visual-design.md](visual-design.md)。业务模块仅是可选组织方式，见 [module-layouts.md](module-layouts.md) 和 [module-visuals.md](module-visuals.md)。

## 正文与证据

正文只保留判断、主图、关键数字、帮助读图的短注解，以及可核查的简短推理。影响决策的适用、失效、触发和停用条件贴近判断；不在首屏展示哈希、字段、插件路由或操作过程。

原始数据、完整方法、参数、来源和样本明细放 `details`，或放入 `content.appendix` 中的 `details`。Report 统一集中到末尾附录并生成往返锚点；主要图表与必要条件留在正文。保留原值和引用，不复制样本或重新计算统计。

`judgment` 表达结论，`metrics` 展示原值，`range` 展示明确边界内的位置，`scores` 展示已有量表，`reasoning` 放精简证据摘要。不要把展示条形当作评分引擎，也不要把更多方法或更多图表当作更高置信度。需要公式时用 `formula` 的 `latex` 字段，Report 使用内置 KaTeX 渲染。

## 图表与交互

每张图回答一个问题，填写 `title`、`takeaway`、`source_note`。`chart.kind` 从现成图型中选择，字段映射放 `options`，数据通过固定 `data_id` 或已提供的 `rows` 二选一。来源、时间、单位、缺失、样本和原始精度保持可查。

图表、明细联动、筛选、缩放与键盘操作由 Report 组件提供。优先使用这些既有交互，不提交函数或自建页面运行时。现成图型不适合时，可以组合通用组件或选择表格并说明确切缺口，不能偷偷改成任意 HTML。

默认蓝灰；盈亏、收益及涨跌沿用 K 线的红绿：涨赚为绿，跌亏为红，零值为灰，同时保留数值、正负号及位置。按指标种类固定配色，不看本批数值分布：全赚仍绿、全亏仍红；回撤、净值及普通比较用蓝灰，不标为 negative。关系图布局不证明因果或强弱，条件树的判断放内部节点、条件放分支、结果或行动放叶子，没有依据不添加概率。

## 验收

1. 检查内容与本次用户要求一致；主动删除的字段不算缺失，不为填模板补算法或造数据。
2. 检查主图、数字、单位、精度、缺失和条件是否与固定成果一致，短注解是否真正解释图形。
3. 检查桌面与窄屏阅读、深浅主题、长标签、主要交互和附录锚点往返；不要把关键条件藏进明细。
4. 对发布后的当前完整 ref 调用 `report_check`。只有本次 `receipt.status: "rendered"` 表示渲染检查通过；修订内容或样式后发布新 revision 并重新检查，不沿用旧回执。
5. 用户需要 PDF/PNG 时，另走导出预检并核验实际文件；渲染通过不等于导出成功。

普通比较依次交替使用蓝色色阶和主题反差的中性色阶：浅色主题用深灰/黑，深色主题用浅灰/白；多序列保持相同顺序，图例、线条和数据点同步。盈亏与涨跌的红绿优先，不把中性色替换成亏损色。
选图时积极组合适合不同问题的内置图型，见 [完整图表目录](chart-catalog.md) 与 [构成与比较图](composition-charts.md)。不为凑图数重复结论，不把历史频率当成已经校准的未来概率；分析方法与图形选择独立。
