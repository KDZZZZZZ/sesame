---
name: visual-compose
description: 将已有文字、数值和关系组织为报告或回答的统一视觉组件。
---

1. 按已有信息选择文字、表格、指标、图表或关系图；不熟悉时查询 components_list，再 describe 所需组件。
2. 直接提供 component、components 或 document.sections。说明只放 paragraph/markdown，图内只留必要标签。数据用实际 rows 或已声明固定 data_id。
3. components_show 一次展示；target=answer 用于对话内组件，默认 report。需要先检查时用 components_validate。
4. 修改沿用原数据与报告，只修复诊断指出的字段或布局；缺少分析交回生产者，不在视觉层补算或虚构。

完成：内容进入受控组件、数值与映射准确、布局可读。组合见 references/composing.md，数据见 data-binding.md，交互见 interactions.md，文字见 text.md。
