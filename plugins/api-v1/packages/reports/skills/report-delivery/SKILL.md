---
name: report-delivery
description: 发布、修订、检查和按需导出一个已组成的报告。
---

1. 用户指定位置时实际发布报告到该位置；只登记数据或在回复贴引用不算生成报告。单文件不另包同名文件夹。
2. 先按 visual-compose 完成统一图文编辑，再一次 components_show 提交 title、lead、highlights 和有内容的正文。长输入可写完整 UTF-8 JSON，再 report_prepare 返回固定输入，避免重抄；lead 和 highlights 位于宿主发布请求的 input 内。
3. 修订用原 artifact_id、当前 expected_revision 与新 operation_id，保留固定数据和附件身份。
4. 对返回的完整 ref 调用 report_check，核对当前修订的渲染与统一视觉；有变化才重做受影响检查。需导出时另执行宿主导出并确认文件。

交付前通读图文并核对原意：开篇是否完整回应主问题及关键条件，层次与段落是否清楚，图中是否呈现它要说明的重点，标题与正文的强度和时点是否一致。列表、表格与图表按阅读任务选用，用户明确指定的视觉已落实；不能只数图或验 schema。完成分别记录已发布、当前修订渲染检查通过、请求文件已导出，三者不可替代。仅阅读或检查历史固定 HTML 时直接读取；用户要求重生成或改版时按当前规范统一编辑。细则见 references/delivery.md，具体报错修复见 references/repair.md。
