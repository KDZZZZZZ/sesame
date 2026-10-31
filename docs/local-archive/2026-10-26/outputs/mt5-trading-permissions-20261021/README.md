# MT5 交易权限能力修复与实测

结果：`sesame/mt5` 2.1.5 已正式更新到正在使用的本地工作区。真实主 Agent 使用 `openai/gpt-6.1-sol` 完成读取、启用、重复命令和最终读回；MT5 算法交易开关已开启。此次宿主代码没有修改。

## 原因与实现

当前 FTMO-Demo 模拟账户尾号 4344 不是只读账户。Sesame `allow_trading=true`、原生 `mcp_trade_allowed=true`，但终端 `experts_trade_allowed=false`，因此原生程序交易被拒绝。不能将这种拒绝概括为“用户没有授权交易”或“账户不能交易”。

新增 `mt5_trading_permissions` 主 Agent 能力，分别提供 `action=read` 和带稳定 `command_id`、配置版本的 `action=enable`。实现复用既有 `prepareTerminal`，正常重启符合条件的空闲终端，沿用绑定账户、安装目录与数据目录，并重新读取权限。重复命令只返回保存的结果；账户、版本或连接变化时不会报告成功。提示词已指导 Agent 在用户已有授权范围内自行处理此算法交易开关。

该能力不提交订单、不重放旧交易请求，也不能把券商账户只读或 MCP 未授权状态变为有效授权。终端准备失败时既有流程会尝试恢复连接；恢复结果必须以实际回执为准。

实现文件：`backend/trading-permissions.js`、`tools/configuration.js`、`backend/plugin-runtime.js`；同时更新能力声明、配置依赖绑定、插件清单、提示词、连接指南、接口文档、MT5 lock/inventory 记录及能力责任表。没有增加依赖。

## 验证证据

- 定向自动化测试 **51/51 通过**，见 `targeted-tests.log`。覆盖权限准备、配置版本与账户一致性、命令去重、失败结果、公开分发边界、既有终端启动及部署行为。
- 安装前已确认全局空闲并备份主数据库；正式插件管理 API 仅更新 MT5，见 `installed.json`。打包摘要为 `sha256:180f85555cd5a69fdb6db56fd96ee00bd4a7ff712eebea67cba20afdb0129893`。
- 真实主 Agent 在 2026-10-21 06:12–06:14 UTC 执行四次权限调用，见 `live-progress.json` 与 `verified-live.json`。
- 首次读取：算法交易关闭。启用回执：`status=applied`、`restarted=true`、`verified=true`。重复调用得到完全相同的回执；最终独立读取确认算法交易和 MCP 权限都开启，账户连接正常。
- 配置版本始终为 8，账户始终为同一个模拟账户。全部原 Run、14 个历史暂停任务及其关联、报告与产物均保留；没有打开活动子任务数据库。
- 模型选择及模型配置文件保持原样。`auth.json` 在模型本轮调用开始后、首个 MT5 调用前发生 OAuth 凭据存储更新，未将其错误计为“字节完全不变”；时间与元数据见 `verified-live.json`。
- 本次没有发送订单或挂载策略。此前下单闭环及报价时间问题不因权限测试成功而自动计为通过。

## 本地提交记录

当前仓库包含本轮之前尚未提交的架构改动。权限后端与专项回归已独立提交为 **`73dc565`**，没有推送。在 HEAD 导出目录中的隔离验证为 **30/30 通过**；本轮其余集成变更的精确差分保存在 `commit-delta/`，18 个文件均经补丁重建和逐字节比对，提交回执另见 `commit-core.json`。运行中的 2.1.5 已包含完整集成。

## 上游依据

终端算法交易与账户、MCP 权限分开检查。启动配置沿用已有实现及 [MetaTrader 5 官方启动配置说明](https://www.metatrader5.com/en/terminal/help/start_advanced/start)，权限语义参照 [MQL5 交易权限说明](https://www.mql5.com/en/docs/runtime/tradepermission)。
