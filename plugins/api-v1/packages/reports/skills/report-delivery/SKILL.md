---
name: report-delivery
description: 发布、修订、检查和按需导出一个已组成的报告。
---

1. 用户指定位置时实际发布报告到该位置；只登记数据或在回复贴引用不算生成报告。单文件不另包同名文件夹。
2. 先按 visual-compose 完成视觉设计，再一次 components_show 提交 title、lead、highlights 和有内容的正文。长输入可写完整 UTF-8 JSON，再 report_prepare 返回固定输入，避免重抄；lead 和 highlights 位于宿主发布请求的 input 内。
3. 修订用原 artifact_id、当前 expected_revision 与新 operation_id，保留固定数据和附件身份。
4. 对返回的完整 ref 调用 report_check，核对当前修订的渲染与统一视觉；有变化才重做受影响检查。需导出时另执行宿主导出并确认文件。

交付前对照初稿核对原意不变，首屏关键结果简明突出，主要数据关系已设计成合适图表，多条件路径已实际画成决策树；精确明细才用表格，不能用指标格或数值列表代替关系图。检查读者能否直接看出关键差异和判断路径，不能只验 schema 或页面是否能打开。完成分别记录已发布、当前修订渲染检查通过、请求文件已导出，三者不可替代。仅阅读或检查历史固定 HTML 时直接读取；用户要求重生成或改版时按当前视觉规范重新组织。细则见 references/delivery.md，具体报错修复见 references/repair.md。
