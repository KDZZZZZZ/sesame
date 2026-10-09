---
name: analyze-data
description: 使用真实后端输入，在 bwrap 中编写与执行可追溯分析，并登记报告数据。
---

工具回复是有界预览；原始 MT5 响应可能把数万根 K 线放在一个 result.content[0].text JSON 字符串内。data_read 会把完整行数据写入返回的只读 path。在 bwrap 中解析并只输出范围、字段、计数、少量样本和所需统计；不要用 read/cat 或 print 将完整行情回灌模型。_tool_output_truncated 表示预览截断，不表示原始文件缺失。

先用 data_read 查询或加载实际 dataset ID，记录列名、类型、行数、缺失值与数据范围。CSV 数值通常是字符串，转换失败和缺失不能静默当作零。

用 write/edit 编写独立 Python 分析脚本，从 inputs 读取数据。明确单位、样本筛选、分母与时间口径；必要时输出诊断数据。不使用写死的样本或结论来代替输入计算。

用 bash 执行；检查退出状态和输出。输出保存为 JSON 对象数组，避免 NaN/Infinity。统计方法、随机种子和限制写在代码与说明中。

调用 research_register，传入本次 execution_id、输出文件、title、description 和实际 input_ids。登记失败时查明输入绑定或格式问题，不伪造执行 ID。

将返回的 dataset ID 交给报告插件。报告需要解释方法和局限；没有 MT5 Tester 数据时明确这是研究分析，不是已验证交易策略。
