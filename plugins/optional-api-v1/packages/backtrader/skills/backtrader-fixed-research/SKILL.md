---
name: backtrader-fixed-research
description: Run an authored Backtrader Strategy against frozen OHLCV, with explicit cost/feed settings and native execution evidence.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/backtrader",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

原生参数搜索用 backtrader_optimize，与backtest相同冻结输入并加parameter_space；实际调用Cerebro.optstrategy，64组合/200000 pass-bars以内、单进程，保留全部完成/失败/未完成回执。只在开发输入搜索，目标先固定，holdout另用固定参数实测。恢复先backtrader_operation读同op；未知结果不重发。没有默认交易算法或自动选参结论。

本插件是计算与验证层：对一份固定数据、一份策略及明确参数执行一次原生回测，交付引擎证据。工作流负责提出研究问题、选择候选、比较方法和综合结论；本插件不选择新市场、不重新抓取输入，也不另开最终报告。可用能力是环境核验/准备、原生回测和读取冻结结果，具体形状在 INTERFACES.md。已验证环境可复用；缺依赖时才使用已知Python路径或prepare准备私有环境，不扫描全机、不升级共享环境。

固定输入可由 market_read 或 data_snapshot 发布；已有适用DataRef直接复用。工作区计算结果只有具备宿主成功执行及冻结输入/输出证据时才能用 research_register 发布，普通文件路径本身不是登记凭据。data_read({ref})读取固定内容。DataRef必须原样传递，不能只传datasetId或猜digest。策略是工作区已编写的单文件原生Python，执行在当前用户宿主权限下，并非OS沙箱；本插件不连接实盘网关。输入、源代码、环境、成本和结果分别冻结；向工作流交接结果ref、原始输入ref、统计、诊断和撮合假设，便于同口径比较。

status=completed 只确认引擎完成；failed按diagnostics修正实际问题，unknown保留执行不确定，不用新operation_id自动重放。新数据/源码/参数是一项新的研究操作。data中的表ref可直接交data_read或reports能力；保留demo、时间与数量单位、浮点精度和撮合假设，不把一次回测推成盈利保证或SVL等价。

backtrader_environment inspect返回ready:true会保存选择；要求本机64位Python>=3.11、Backtrader1.9.78.123，不需要broker/API Key。backtrader_backtest要求backtrader.Strategy、明确UTC/offset时间与完整OHLCV十进制文本。config={capital,commission,slippage,feed:{timeframe,compression}}；commission/slippage是比例；股票现金模拟不等于衍生品保证金。回测data含equity/trades/orders。


config例：{capital:"100000",commission:"0.001",slippage:"0",feed:{timeframe:"days",compression:1}}；1小时柱为minutes/60，依据固定来源定义，不猜时间间隔。class_name必须是工作区源文件的实际类名。输入2–100000行、≤16MiB，source文件≤512KiB，默认列datetime/open/high/low/close/volume；有别名用columns声明。

最小原生类形状为 import backtrader as bt / class ResearchStrategy(bt.Strategy):，next(self) 是逐bar策略回调，参数由类params与调用parameters对应。是否入场、仓位和退出应由研究目标决定，不将示例策略当默认金融逻辑。官方参考 https://www.backtrader.com/docu/strategy/ 。准确调用/回执形状、限制与恢复方式在INTERFACES.md。
