可用能力是环境核验/准备、固定数据原生回测、读取冻结结果，具体输入输出和最小例在 INTERFACES.md。环境检查是证据入口，不要求先扫描全机。可使用任务已知的实际Python路径；错误明确指出缺失依赖时，prepare可在授权任务内创建私有环境。安装器不安装解释器、不升级共享环境；读取失败不能把样本冒充真实数据。

固定输入可由 market_read 或 data_snapshot 发布；工作区已有研究文件用 research_register 保留来源后取得ref。data_read({ref})读取固定内容。DataRef必须原样传递，不能只传datasetId或猜digest。策略是工作区已编写的单文件原生Python，执行在当前用户宿主权限下，并非OS沙箱；本插件不连接实盘网关。输入、源代码、环境、成本和结果分别冻结，使结论可追溯。

status=completed 只确认引擎完成；failed按diagnostics修正实际问题，unknown保留执行不确定，不用新operation_id自动重放。新数据/源码/参数是一项新的研究操作。data中的表ref可直接交data_read或reports能力；保留demo、时间与数量单位、浮点精度和撮合假设，不把一次回测推成盈利保证或SVL等价。

vnpy_environment inspect要求本机64位Python3.10–3.13、vnpy4.5.0/CTA1.4.1。ready:true但configured:false时，同一已验证python_path的prepare只保存私有选择；回测需两者为true。准备可能返回phase/progress/retryable且ready:false；相同base路径和保留下载缓存能续传。retryable:false或相同失败无进度时不继续盲试。

vnpy_backtest接受已写CtaTemplate、2–100000行固定OHLCV、明确config={vt_symbol,interval,rate,slippage,size,pricetick,capital}；interval=1m|1h|d|w。可保留来源wall时间，但必须给原始wall_time_authority，不猜UTC偏移。data返回daily/trades/orders。示例数据是demo，不代表真实市场。

公开资源定位：本包路径以插件根目录为准；[完整接口契约](INTERFACES.md) 可由 plugin_read({pluginId:"sesame/vnpy",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。
