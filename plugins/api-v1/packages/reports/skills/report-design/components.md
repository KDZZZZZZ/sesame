# 声明式内容组件

先从 `host.reports.describe` 读取宿主所选提供者与完整 inputSchema。此插件的内容放 `host.reports.publish.input.content`，用户样式放可选 input.style；`report_publish` 是同一宿主发布入口的便利转接。Report 负责页面、主题、图表运行时、公式和末尾附录；组件不接收 HTML、CSS、脚本或函数。可运行的通用内容与样式示例见 [style-guide.md](style-guide.md)，图型映射见 [chart-catalog.md](chart-catalog.md)。

## 文档结构

`content: {kind: "document", sections: [{title, blocks}], appendix: [...]}`。

- `sections` 最多 50 节；节标题尽量用读者能懂的话表达结论，下面用已有图表和短理由支撑。对象与期限可共用说明，不为每项判断新增整套栏目或重复卡片。
- `appendix` 放完整证据，通常以 `details` 分组。正文中的 `details` 也会集中到末尾；组件统一提供往返锚点。
- 每个文本字段最多 20,000 字符，这是输入上限，不是正文篇幅目标。正文仍只写判断、短注解和简短推理。
- 语言由 `report_publish.locale` 选择；固定结论的语言由作者提供，切换界面语言不会翻译研究结果。

## 通用组件

| `type` | 字段与用途 |
|---|---|
| `judgment` | `text`，可选 `note`；明确判断及影响判断的条件 |
| `logic` | `title/nodes/edges`，可选 `note`；复用应用现有的 Netron 风格 SVL 渲染，画出实际计算、条件与动作的依赖，支持分支和汇合。因子与策略报告默认使用，见 [逻辑图](logic-diagram.md) |
| `metrics` | `items: [{label, value, note?}]`，最多 12 项；value 为字符串或有限数值，单位随值或 note 写清 |
| `range` | `label, min, max, value`，可选 `unit, note`；明确有限边界且 min < max，原值在边界内 |
| `scores` | `min, max, items: [{label, value, note?}]`，可选 `unit`；最多 24 项，量表由来源给出，不生成新分数 |
| `chart` | 已有固定结果的图形，字段见下一节 |
| `reasoning` | `steps: [文字]`，最多 8 条；只保留可核查的观察、解释、历史对照及判断摘要 |
| `group` | `layout: "columns"` 或 `"stack"`，`blocks` 最多 12 项；递归深度最多 5，不新增边框卡片 |
| `paragraph` | `text`；必要的短说明 |
| `markdown` | `text`；安全 Markdown，不作为嵌入 HTML、CSS 或脚本的通道 |
| `attachments` | `items: [{label, path, description?}]`，1–64 项；链接本次发布 `input.assets` 中已有的惰性附件，通常放末尾 `details` |
| `formula` | `latex`，可选 `caption, display: "inline"或"block"`；由内置 KaTeX 渲染，不交付未渲染公式 |
| `table` | `columns: [标题]`、`rows: [[单元格…]]`，可选 `caption`；最多 24 列、2,500 行，行长须等于列数，单元格为有限数值、字符串、布尔或 null |
| `details` | `title, blocks`；完整证据放末尾折叠附录，正文保留引用锚点 |

`range` 和 `scores` 只显示输入位置与原量表，不把 0–5 自动换成 0–100。价格、金额等精确字符串保留在指标和表格中，不能为画图重新计算金融统计。必要统计由独立研究结果提供。

## 可下载附件

将完整 JSON、文本或静态图片声明在 `input.assets`，再用 `attachments` 生成真实附件链接。`path` 必须与一个已声明附件的包内路径完全一致，最多 256 字符；不能是网址、绝对路径、穿越路径，不能带查询参数、片段或百分号转义。允许的格式与附件发布一致：JSON、TXT/CSV/TSV/MD/LOG、PNG/JPEG/WEBP；不接受 HTML、CSS、脚本或 SVG。文件仍由提供者读取并校验，组件不生成或改写文件。

```json
{"type":"attachments","items":[{"label":"下载完整样本","path":"evidence/samples.json","description":"保留原始数值、缺失项与排除记录。"}]}
```

`label` 为 1–160 字符的非空名称，`description` 可选、最多 1,000 字符，两者按普通文字转义。优先为资产使用固定 `ref` 和 `entry`，并在发布 envelope 声明其引用。不能用 Markdown 相对链接代替此组件：Markdown 保留宿主的链接安全规则。附件组件用于完整提供者发布，包括固定 JSON `inputRef`；只输出独立 HTML 的 `report_document_template` 不打包附件，因此不声明此组件。查看附件不会改变研究结果或来源时间。

## 图表组件

`chart` 的字段为 `type, title, kind, columns, options, takeaway, source_note`，并选择 `rows` 或 `data_id`。`columns` 是 1–32 个原始字段名；这里的 `rows` 是对象数组，区别于 `table.rows` 的二维数组。

- `data_id` 必须对应 `report_publish.data` 中同名的固定 DataRef。绑定保持完整 ref、来源、时间、单位与原始字节。
- 内联 `rows` 为 1–2,500 条已有结果；不是免除来源引用的理由。大数据先使用有来源的聚合结果或按问题分图，不能把首批数据当全集。
- `options` 只放该图型支持的字段映射与安全 JSON 显示参数；不放 rows、data、nodes、回调或函数。
- 关系图可直接提供固定 `nodes`；或用 `chart_data: [{property: "nodes", data_id: "节点绑定ID"}]` 读取另一个已声明固定绑定，两者二选一。主边数据与节点数据都保持原来源。
- `takeaway` 简短说明图上的比较或理由，不复述标题和开篇结论；`source_note` 只补必要口径，共同信息不逐图重复。完整数据和来源明细由 Report 放末尾附录。
- 直方图、箱线图和密度图只接收已有分箱、分位或密度网格，并填写对应 `options.method`；报告不拟合 KDE、重算置信度或替研究选参数。

38 种现成图型为：`line`、`area`、`bar`、`hbar`、`scatter`、`heatmap`、`matrix`、`units`、`waterfall`、`dumbbell`、`strip`、`histogram`、`boxplot`、`ridgeline`、`violin`、`calendar`、`parallel`、`bump`、`lifecycle`、`treemap`、`threads`、`flow`、`network-circular`、`network-force`、`decision-tree`、`stream`、`stacked-rungs`、`dot-heatmap`、`funnel`、`category-links`、`outcome-tally`、`paired-rungs`、`rank-race`、`spectrum`、`tick-donut`、`barcode`、`bubble-ledger`、`candlestick`。全部通过同一个声明式 `chart` 入口；内部 reportKit/SesameCharts 不是另一个自由编码接口。

时间缺失留缺口，缺失值不能用零伪补。瀑布图需对账，流向需守恒，排名需固定全集与并列规则；这些是结果可解释性的要求，不是指定算法。各图数据契约见 [统计](statistical-charts.md)、[时序](temporal-charts.md)、[结构](structural-charts.md)、[K 线](market-charts.md) 和 [情景树](decision-tree.md)。

## 通用样式

样式独立于文档种类、品种和研究方法。默认无框、蓝灰、留白、宿主字体与深浅主题。只有一套默认排版，Agent 选择组件以及并排或上下组合；用户明确要求时可以调整受控 token 并保存复用。实际范围与 API 示例见 [style-guide.md](style-guide.md)。不在工作流插件各维护一套报告 CSS，不把每张图再包一层边框。

[Composition and comparison charts](composition-charts.md)
