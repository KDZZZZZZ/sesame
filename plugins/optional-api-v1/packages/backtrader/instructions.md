本插件是计算与验证层：对一份固定数据、一份策略及明确参数执行一次原生回测，交付引擎证据。工作流负责提出研究问题、选择候选、比较方法和综合结论；本插件不选择新市场、不重新抓取输入，也不另开最终报告。可用能力是环境核验/准备、原生回测和读取冻结结果，具体形状在 INTERFACES.md。已验证环境可复用；缺依赖时才使用已知Python路径或prepare准备私有环境，不扫描全机、不升级共享环境。

已有策略需参数搜索时可用 backtrader_optimize：它实际调用 Cerebro.optstrategy，附 parameter_space，最多64组合和200000 pass-bars，单进程保留所有完成/失败/未完成组。只用开发数据，目标与选择规则先冻结，随后独立holdout使用固定参数。backtrader_operation只读同operation原收据；unknown不换ID重跑。此处不规定研究方法、指标或默认策略。

固定输入可由 market_read 或 data_snapshot 发布；已有适用DataRef直接复用。工作区计算结果只有具备宿主成功执行及冻结输入/输出证据时才能用 research_register 发布，普通文件路径本身不是登记凭据。data_read({ref})读取固定内容。DataRef必须原样传递，不能只传datasetId或猜digest。策略是工作区已编写的单文件原生Python，执行在当前用户宿主权限下，并非OS沙箱；本插件不连接实盘网关。输入、源代码、环境、成本和结果分别冻结；向工作流交接结果ref、原始输入ref、统计、诊断和撮合假设，便于同口径比较。

status=completed 只确认引擎完成；failed按diagnostics修正实际问题，unknown保留执行不确定，不用新operation_id自动重放。新数据/源码/参数是一项新的研究操作。data中的表ref可直接交data_read或reports能力；保留demo、时间与数量单位、浮点精度和撮合假设，不把一次回测推成盈利保证或SVL等价。

backtrader_environment inspect返回ready:true会保存选择；要求本机64位Python>=3.11、Backtrader1.9.78.123，不需要broker/API Key。backtrader_backtest要求backtrader.Strategy、明确UTC/offset时间与完整OHLCV十进制文本。config={capital,commission,slippage,feed:{timeframe,compression}}；commission/slippage是比例；股票现金模拟不等于衍生品保证金。回测data含equity/trades/orders。

公开资源定位：本包路径以插件根目录为准；[完整接口契约](INTERFACES.md) 可由 plugin_read({pluginId:"sesame/backtrader",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。
