本插件是 vn.py CTA 原生回测引擎（计算与验证层，不联网取数、不接实盘、不另开报告）。输入须为 `market_read` / `data_snapshot` / 具备冻结证据的 `research_register` 发布的完整 DataRef（原样传递，不猜 digest）；策略为工作区单文件原生 Python（宿主当前用户权限运行，非 OS 沙箱）。`status=completed` 仅确认引擎运行完成，`failed` 按 diagnostics 修正，`unknown` 保留不确定且**不用新 `operation_id` 自动重放**；回测结果保留时间、单位、成本与撮合假设，不推成盈利保证或 SVL 等价。

`vnpy_environment` `inspect` 要求本机 64 位 Python 3.10–3.13、vnpy 4.5.0 / CTA 1.4.1；`ready:true` 但 `configured:false` 时用同一 `python_path` 调 `prepare` 保存私有选择（回测需两者为 true）。`prepare` 中断后可用同 base 路径续传；`retryable:false` 或相同失败无进展时停止盲试。

`vnpy_backtest` 接受 `CtaTemplate`、2–100000 行固定 OHLCV 与 `config={vt_symbol,interval,rate,slippage,size,pricetick,capital}`（`interval=1m|1h|d|w`）；可保留来源 wall 时间但须给原始 `wall_time_authority`（不猜 UTC 偏移）。`data` 返回 `daily/trades/orders` 可交 `data_read` 或 Reports；示例数据为 demo，不代表真实市场。

公开资源定位：本包路径以插件根目录为准；[完整接口契约](INTERFACES.md) 可由 `plugin_read({pluginId:"sesame/vnpy",part:"resource",path:"INTERFACES.md"})` 读取，无需每次调用前重复读取。
