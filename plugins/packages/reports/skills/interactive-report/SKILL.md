---
name: interactive-report
description: 编写从后端加载数据的交互 HTML 报告：绑定已登记结果、用 reportKit 读取数据与渲染、发布不可变 revision 并通过发布检查。
---

先确认实际已登记的 dataset ID 或 backtest ID、字段、单位与数据量。使用 report_read 检查更新目标和当前 revision，不能覆盖其他会话的报告。

页面结构按 report-design skill 的 outline 用 `reportKit.render` 生成，文字按 report-writing skill 编写。只在 outline 表达不了的交互上写自定义代码（`{type:'custom', render(el)}`），使用原生 HTML/CSS/JS，不依赖外部网络。所有数值都从查询所得 rows 计算和展示。

读取数据用 `await reportKit.rows(sourceTitleOrId, parameters)`：它等待 `reportData.ready`、按 ID 或标题找到数据源并读完全部 `page.next_cursor`。也可直接调用 `reportData.query(sourceId, {parameters:{}, limit:5000})` 并自行分页，不能把第一页冒充全部结果。异步初始化放进 `reportData.track(async()=>{...})`。加载问题交给发布检查并修复，不能留下异常文字或假数值。Research 源参数为空；客户端交互只操作已加载的真实数据。

Strategy 新报告传 backtest_ids（实际完成的 mt5_backtest 任务），不用为内置回测组件重复生成 dataset。HTML 保留唯一的 `<section data-report-component="backtest"></section>`，并在 outline 中用 `{type:'backtest'}` 指定它出现的章节；组件自动渲染热图、参数比较、权益、原生统计、分页成交账本和逐笔决策，不要自行重写。其数据源 title 分别为 Strategy · grid、Strategy · optimization、Strategy · passes、Strategy · pass、Strategy · trades：grid 用空参数；optimization / passes 用 `{optimization_id}`；pass / trades 用 `{optimization_id, pass_id}`，ID 来自返回行。可以查询这些源为自己的结论、指标和图表取数，不要硬编码回测统计。交易时间为券商服务器墙上时间，未声明 UTC。

给交互控件可访问名称，保持窄屏可用。不要访问 parent DOM、Node、文件、认证或交易接口。

用 write 保存完整 HTML，再调用 report_publish。Research 新报告传 title / html_path / dataset_ids，Strategy 传 title / html_path / backtest_ids；更新时加 report_id / expected_revision。浏览器检查（布局、数据、交互、字面颜色、首屏文字量、reportKit 结构错误）未通过会作为工具结果返回，修复后重新发布。成功的发布响应才是完成依据。
