本插件是 Backtrader 原生回测引擎（计算与验证层，不联网取数、不接实盘、不另开报告）。输入须为 `market_read` / `data_snapshot` / 具备冻结证据的 `research_register` 发布的完整 DataRef（原样传递，不猜 digest）；策略为工作区单文件原生 Python（宿主当前用户权限运行，非 OS 沙箱）。`status=completed` 仅确认引擎运行完成，`failed` 按 diagnostics 修正，`unknown` 保留不确定且**不用新 `operation_id` 自动重放**；回测结果保留时间、单位、成本与撮合假设，不推成盈利保证或 SVL 等价。

`backtrader_environment` `inspect` 返回 `ready:true` 即保存选择，要求本机 64 位 Python>=3.11、Backtrader 1.9.78.123（缺依赖才用已知路径或 `prepare` 建私有环境，不扫全机）。`backtrader_backtest` 要求 `backtrader.Strategy`、明确 UTC/offset 时间与完整 OHLCV 十进制文本，`config={capital,commission,slippage,feed:{timeframe,compression}}`（commission/slippage 为比例，现金模拟不等于保证金），返回 `data` 含 `equity/trades/orders` 可交 `data_read` 或 Reports。

参数搜索用 `backtrader_optimize`（调用 `Cerebro.optstrategy`，附 `parameter_space`，上限 64 组合 / 200000 pass-bars，仅用开发数据先冻结选择规则再做独立 holdout）；`backtrader_operation` 只读同 `operation_id` 原回执。

公开资源定位：本包路径以插件根目录为准；[完整接口契约](INTERFACES.md) 可由 `plugin_read({pluginId:"sesame/backtrader",part:"resource",path:"INTERFACES.md"})` 读取，无需每次调用前重复读取。
