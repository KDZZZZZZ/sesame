---
name: vnpy-backtest
description: Run an authored VeighNa CtaTemplate on fixed bar data with explicit time authority, matching assumptions and native result evidence.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/vnpy",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

本插件是计算与验证层：对一份固定数据、一份策略及明确参数执行一次原生回测，交付引擎证据。工作流负责提出研究问题、选择候选、比较方法和综合结论；本插件不选择新市场、不重新抓取输入，也不另开最终报告。可用能力是环境核验/准备、原生回测和读取冻结结果，具体形状在 INTERFACES.md。已验证环境可复用；缺依赖时才使用已知Python路径或prepare准备私有环境，不扫描全机、不升级共享环境。

固定输入可由 market_read 或 data_snapshot 发布；已有适用DataRef直接复用。工作区计算结果只有具备宿主成功执行及冻结输入/输出证据时才能用 research_register 发布，普通文件路径本身不是登记凭据。data_read({ref})读取固定内容。DataRef必须原样传递，不能只传datasetId或猜digest。策略是工作区已编写的单文件原生Python，执行在当前用户宿主权限下，并非OS沙箱；本插件不连接实盘网关。输入、源代码、环境、成本和结果分别冻结；向工作流交接结果ref、原始输入ref、统计、诊断和撮合假设，便于同口径比较。

status=completed 只确认引擎完成；failed按diagnostics修正实际问题，unknown保留执行不确定，不用新operation_id自动重放。新数据/源码/参数是一项新的研究操作。data中的表ref可直接交data_read或reports能力；保留demo、时间与数量单位、浮点精度和撮合假设，不把一次回测推成盈利保证或SVL等价。

vnpy_environment inspect要求本机64位Python3.10–3.13、vnpy4.5.0/CTA1.4.1。ready:true但configured:false时，同一已验证python_path的prepare只保存私有选择；回测需两者为true。准备可能返回phase/progress/retryable且ready:false；相同base路径和保留下载缓存能续传。retryable:false或相同失败无进度时不继续盲试。

vnpy_backtest接受已写CtaTemplate、2–100000行固定OHLCV、明确config={vt_symbol,interval,rate,slippage,size,pricetick,capital}；interval=1m|1h|d|w。可保留来源wall时间，但必须给原始wall_time_authority，不猜UTC偏移。data返回daily/trades/orders。示例数据是demo，不代表真实市场。


单文件接口与可运行形状在本包examples/strategy.py；原生CtaTemplate及BacktestingEngine说明可参考 https://www.vnpy.com/docs/cn/community/app/cta_strategy.html 。config形状例 {vt_symbol:"TEST.LOCAL",interval:"d",rate:"0.001",slippage:"0",size:"1",pricetick:"0.01",capital:"100000"}，示例单位仅工程验证，实际研究按来源合约设置。若on_init调用load_bar，固定数据须包含所需预热覆盖，config.start从预热后开始；不可补造预热柱或隐式连接数据库。

策略源≤512KiB，固定输入≤16MiB。unknown/missing行情字段不能填0；原始价格文本与wall authority应保留。完整能力形状、状态和恢复边界在INTERFACES.md；result工具读取的是固定manifest，不重跑策略。
