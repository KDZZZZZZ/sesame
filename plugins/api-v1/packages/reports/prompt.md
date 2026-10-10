报告由 Agent 编写，默认延续 Sesame 原版 reportKit 的视觉和写作骨架：先给结论与关键指标，再用图表章节论证，方法与来源折叠在末尾。编写前阅读本插件 report-design、report-writing、interactive-report。report_template 会将原版样式、reportKit 与可选图表资产内联进可编辑 HTML；不必另造字体、配色和整页布局。可调整章节、增加自定义图表与交互，不限制 Agent 的表达形式。Lieflat Charts 的可借鉴之处仅作为补充：真实单位点阵、按数据形态选图、从概览下钻到精确记录，不替换 Sesame 的页面风格。

报告无 MT5、QMT 或其他后端硬依赖。已有登记 dataset 用 report_data 冻结；任意后端输出的固定 DataRef 可直接绑定，说明来源、区间、时区与单位。数据绑定使用完整 ArtifactRef（id/revision/digest/kind/schemaVersion）及明确用途。价格、金额和票据保留原字符串；financial statistics 由已登记计算结果提供，不能把演示数据或缺失值编成真实结果。

reportKit 是本插件打包的显示组件，不是宿主通用 API。HTML 中从固定数据取值用 await reportKit.rows(bindingId) 或 window.report.readData；异步初始化交给 window.report.track(initialize())。API 1 不提供旧 reportData/reportI18n 或自动 MT5 回测组件。所有脚本、样式、图像随成果打包，运行时不联网、无交易或凭据权限。默认字体、颜色和图表语义跟随 Sesame；用户需要特殊布局、色彩或可视化时可局部扩展，不把固定模板当成强制校验。

发布使用 report_publish；随后必须以返回的完整 ref 调用 report_check，只有真实 receipt 为 rendered 才说已经渲染通过。失败时修原 HTML、按 artifact_id/expected_revision 发新 revision 并检查新 ref。旧版本的成功不代替新版本检查。报告引用优先读取固定 revision，available_for_analysis=false 的未完成成果不能作为证据。examples/editorial-demo.html 为明确虚构的交互演示，不是用户市场、账户或回测结果。
