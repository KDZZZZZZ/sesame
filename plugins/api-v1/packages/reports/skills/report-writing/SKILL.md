---
name: report-writing
description: 编写基于固定证据的 report/1 研究与策略报告，登记数据、保存来源并发布可重开的 HTML 成果。
---

# 从证据到报告

1. 明确读者的问题、结论和可用的真实数据。来源可以是已登记 dataset、固定 DataRef 或版本化策略成果；不使用凭空补齐的行情。演示输入必须显眼标注。
2. 对原始资料进行可重现计算，保存执行与来源。用 report_data 冻结 dataset；这个工具保留登记快照，不验证上游计算正确性。已生成的 data ArtifactRef 可直接使用。传递完整引用，不能只传 ID 或 latest。派生数据注明来源和计算，精确数值保留字符串。
3. Agent 自己编写 HTML/CSS/JS。默认用 report_template 生成起点后自由编辑；沿用宿主字体和主题变量，避免另造全局字体与底色，布局和图形按问题设计。先给主结论，再给图形证据、差异、边界和原始数值。来源、日期、单位与计算口径贴近图表。源记录里没有的属性不能推断成事实。
4. 报告里用 `await window.report.readData('binding-id',{limit:1000,cursor})` 读固定数据，返回 `{rows,page:{nextCursor}}`。显式分页、检测重复 cursor、设置行数预算。自定义初始化用 `window.report.track(initialize())`，错误须可见，不能伪造成功。
5. report_publish 绑定 data `[{id,ref,usage}]`，related 关联固定策略、翻译、结果或 run 的确切版本；references 补充证据。代码、样式和图片全在成果 blobs 中。runtime 是 sesame-report/1，runtimeRevision 是 1.0.0。报告没有交易或任意宿主访问能力。
6. 对 report_publish 返回的完整 ref 调用 report_check，检查实际视口和 diagnostics；失败就修改 HTML、发布新 revision，再检查新 ref。发布返回 renderStatus:not_checked 时只能说已保存；receipt 为 rendered 后才可说通过渲染。用 report_read.include_checks 查看该版本历史，旧报告仍可读取原始快照。

## 策略结果

策略源、目标翻译、原生 run 与结果各自是独立证据。引用选定后端实际返回的固定 DataRef、版本化结果和确切运行记录；明确来源、适用账户、样本区间、成本、参数与验证范围。已安装 MT5 时，可使用它返回的真实 DataRef 或 mt5_report_data；其他后端使用自身已支持的固定结果接口，报告不要求安装某个特定后端。不能把 SVL 固定事件 replay、编译通过或 JSON 样本写成原生回测。禁止默认补充盈利假设；原生或历史格式的策略保留真实身份，不自动标成 SVL。

## 完整性

缺失数据保持 null 与说明。筛选只是查看已固定输入，不能暗中重新拉行情。精确统计在代码计算阶段完成并登记；SVG 数值转换只用于坐标，不可重新计算最终收益或风控金额。表格/tooltip 显示原始字符串。
