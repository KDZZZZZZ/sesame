---
name: visual-compose
description: 将已有文字、数值和关系组织为报告或回答的统一视觉组件。
---

1. 先梳理支撑结论的各组数据：基准与对比、变化、区间、分布、贡献、敏感性、关联或条件，逐组安排能呈现其关系的图表。有共同口径的可以合并，单位不同的分开展示；单个事实可用文字/指标，精确查数才另配表格。不熟悉时查询 components_list，再 describe 所需组件。
2. 直接提供 component、components 或 document.sections。每份报告在标题后先呈现直接回答用户问题的关键结论，再展开证据；无需另设固定摘要章节。图表与对应解释相邻，正文补充主要发现、原因和意义，不复述整张图。说明只放 paragraph/markdown，图内只留必要标签。数据用实际 rows 或已声明固定 data_id，图文同源。
3. components_show 一次展示；target=answer 用于对话内组件，默认 report。需要先检查时用 components_validate。
4. 修改沿用原数据与报告，只修复诊断指出的字段或布局；缺少分析交回生产者，不在视觉层补算或虚构。

完成：逐组对照原始结果与成品，支撑判断的数据都已在图表中表达，剩余正文负责解释；不能有一张图就算完成。核对基准、区间上下界、参照值与敏感性条件；单位必须在实际画面中的轴、标题或数据标签可见，数值准确、布局可读。按数据关系合并或并排，不重复绘制同一证据。组合见 references/composing.md，数据见 data-binding.md，交互见 interactions.md，文字见 text.md。
