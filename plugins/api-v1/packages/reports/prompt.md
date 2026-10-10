报告是默认通用成果能力，无 MT5、QMT 或其他后端硬依赖。延续包内 editorial/lieflat 风格：清晰标题、醒目主结论、单位、来源、图例与可检查明细；用筛选、比较和图表解释证据，保留空数据/错误状态。examples/editorial-demo.html 明确为虚构样本，可离线查看，不能冒充用户数据。

用户需要研究、策略或结果报告时，用 Agent 自己编写的 HTML/JavaScript 表达结论，再通过 report_publish 发布 report/1 成果。先读本插件 report-writing skill；需要图表与交互时再读 report-design 和 interactive-report。报告组件、模板和指导都在插件内，宿主只提供固定资源与受限只读桥。
报告数据使用 kind:data 的完整 ArtifactRef（id/revision/digest/kind/schemaVersion），并在 data 绑定里明确使用目的。已有登记 dataset 用 report_data 冻结；任意已安装后端输出的固定 DataRef 可直接绑定，并标明来源、引擎和获取时间。精确价格、金额、票据保留原字符串，不能把演示数据标成真实结果。
report_template 可生成完全可编辑且无需外部依赖的 HTML 起点；也可从零写 HTML。实际图形数据只通过 window.report.readData 读取。报告不得联网获取变化中的行情，也无交易、凭据或任意宿主 API。所有 HTML/JS/CSS/图片必须收入成果包，固定 runtimeRevision 1.0.0。
默认沿用 Sesame 的字体、浅深主题和排版基础。优先从 report_template 起步或复用 assets/editorial.css；自定义布局、图表和交互时使用宿主语义变量（--foreground、--muted、--surface-secondary、--border、--success、--danger、--chart-series-1…6、--sans、--serif、--mono），不要为每份报告重新定义全局字体与背景色。新版宿主会自动提供基础样式；插件模板保留离线后备值。用户指定视觉主题、内容需要特殊色彩编码时可覆盖局部样式，不要求所有报告采用同一布局。
发布只代表内容已保存。report_publish 后用 report_check 检查返回的完整 ref；只有宿主 receipt 为 rendered 时，才说报告已通过实际渲染。failed 时读取 diagnostics、修改代码并发新 revision，再检查该新 ref；不能让旧成功 receipt 替代新版本检查。report_read 的 include_checks 可读取该固定版本的真实检查记录。报告没有自动插入 MT5 回测或策略组件，Agent 负责组织引用、图形、参数与明细。
