---
name: report-delivery
description: 发布、修订、检查和按需导出一个已组成的报告。
---

1. 用户指定位置时实际发布报告到该位置；只登记数据或在回复贴引用不算生成报告。单文件不另包同名文件夹。
2. 通常一次 components_show 即可，完整报告提供 title、lead 和有内容的正文。长输入可写完整 UTF-8 JSON，再 report_prepare 返回固定输入，避免重抄；lead 位于宿主发布请求的 input 内。
3. 修订用原 artifact_id、当前 expected_revision 与新 operation_id，保留固定数据和附件身份。
4. 对返回的完整 ref 调用 report_check，核对当前修订的渲染与统一视觉；有变化才重做受影响检查。需导出时另执行宿主导出并确认文件。

交付前确认开篇已回答核心问题，主要数据关系已有对应图表、区间或数值组件；表格只承担精确查数，复杂条件路径使用决策树。完成分别记录已发布、当前修订渲染检查通过、请求文件已导出，三者不可替代。历史固定 HTML 直接读取，不为检查重生成。细则见 references/delivery.md，错误定位见 references/repair.md。
