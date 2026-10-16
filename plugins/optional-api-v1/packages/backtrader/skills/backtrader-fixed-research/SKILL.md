---
name: backtrader-fixed-research
description: Run an authored Backtrader Strategy against frozen OHLCV, with explicit cost/feed settings and native execution evidence.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/backtrader",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

可用能力是环境核验/准备、固定数据原生回测、读取冻结结果，具体输入输出和最小例在 INTERFACES.md。环境检查是证据入口，不要求先扫描全机。可使用任务已知的实际Python路径；错误明确指出缺失依赖时，prepare可在授权任务内创建私有环境。安装器不安装解释器、不升级共享环境；读取失败不能把样本冒充真实数据。

固定输入可由 market_read 或 data_snapshot 发布；工作区已有研究文件用 research_register 保留来源后取得ref。data_read({ref})读取固定内容。DataRef必须原样传递，不能只传datasetId或猜digest。策略是工作区已编写的单文件原生Python，执行在当前用户宿主权限下，并非OS沙箱；本插件不连接实盘网关。输入、源代码、环境、成本和结果分别冻结，使结论可追溯。

status=completed 只确认引擎完成；failed按diagnostics修正实际问题，unknown保留执行不确定，不用新operation_id自动重放。新数据/源码/参数是一项新的研究操作。data中的表ref可直接交data_read或reports能力；保留demo、时间与数量单位、浮点精度和撮合假设，不把一次回测推成盈利保证或SVL等价。

backtrader_environment inspect返回ready:true会保存选择；要求本机64位Python>=3.11、Backtrader1.9.78.123，不需要broker/API Key。backtrader_backtest要求backtrader.Strategy、明确UTC/offset时间与完整OHLCV十进制文本。config={capital,commission,slippage,feed:{timeframe,compression}}；commission/slippage是比例；股票现金模拟不等于衍生品保证金。回测data含equity/trades/orders。


config例：{capital:"100000",commission:"0.001",slippage:"0",feed:{timeframe:"days",compression:1}}；1小时柱为minutes/60，依据固定来源定义，不猜时间间隔。class_name必须是工作区源文件的实际类名。输入2–100000行、≤16MiB，source文件≤512KiB，默认列datetime/open/high/low/close/volume；有别名用columns声明。

最小原生类形状为 import backtrader as bt / class ResearchStrategy(bt.Strategy):，next(self) 是逐bar策略回调，参数由类params与调用parameters对应。是否入场、仓位和退出应由研究目标决定，不将示例策略当默认金融逻辑。官方参考 https://www.backtrader.com/docu/strategy/ 。准确调用/回执形状、限制与恢复方式在INTERFACES.md。
