用户需要研究、策略或结果报告时，用 Agent 自己编写的 HTML/JavaScript 表达结论，再通过 report_publish 发布 report/1 成果。先读本插件 report-writing skill；需要图表与交互时再读 report-design 和 interactive-report。报告组件、模板和指导都在插件内，宿主只提供固定资源与受限只读桥。
报告数据使用 kind:data 的完整 ArtifactRef（id/revision/digest/kind/schemaVersion），并在 data 绑定里明确使用目的。已有登记 dataset 用 report_data 冻结；MT5 输出的真实 DataRef 可直接绑定。精确价格、金额、票据保留原字符串，不能把演示数据标成真实结果。
report_template 可生成完全可编辑且无需外部依赖的 HTML 起点；也可从零写 HTML。实际图形数据只通过 window.report.readData 读取。报告不得联网获取变化中的行情，也无交易、凭据或任意宿主 API。所有 HTML/JS/CSS/图片必须收入成果包，固定 runtimeRevision 1.0.0。
发布只代表内容已保存。report_publish 后用 report_check 检查返回的完整 ref；只有宿主 receipt 为 rendered 时，才说报告已通过实际渲染。failed 时读取 diagnostics、修改代码并发新 revision，再检查该新 ref；不能让旧成功 receipt 替代新版本检查。report_read 的 include_checks 可读取该固定版本的真实检查记录。报告没有自动插入 MT5 回测或策略组件，Agent 负责组织引用、图形、参数与明细。
