---
name: visual-compose
description: 将已有文字、数值和关系组织为报告或回答的统一视觉组件。
---

1. 先看已有数据要说明什么：变化、差距、分布、贡献、关联或条件。关键的数据关系优先实际用图呈现，不等用户要求，也不只交数字表格；单个事实可用文字/指标，精确查数才另配表格。不熟悉时查询 components_list，再 describe 所需组件。
2. 直接提供 component、components 或 document.sections。每份报告在标题后先呈现直接回答用户问题的关键结论，再展开证据；无需另设固定摘要章节。图表与对应解释相邻，正文补充主要发现、原因和意义，不复述整张图。说明只放 paragraph/markdown，图内只留必要标签。数据用实际 rows 或已声明固定 data_id，图文同源。
3. components_show 一次展示；target=answer 用于对话内组件，默认 report。需要先检查时用 components_validate。
4. 修改沿用原数据与报告，只修复诊断指出的字段或布局；缺少分析交回生产者，不在视觉层补算或虚构。

完成：要说明的数据关系确实可见，图型与单位匹配，数值准确、图文一致、布局可读；不能只检查发布成功。无需每节一图，也不为增加图数重复同一证据。组合见 references/composing.md，数据见 data-binding.md，交互见 interactions.md，文字见 text.md。
