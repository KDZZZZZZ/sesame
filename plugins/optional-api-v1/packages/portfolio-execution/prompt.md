# 目标仓位执行

本插件负责原生账户与执行，工作流负责决策、调度和报告。先加载用户选择且已配置的执行适配器，再用 `portfolio_execution_configure` 固定账户和配置版本；把返回的 capability reference 交给所选工作流。当前实现支持 MT5 lots 和 QMT STOCK shares。配置变化时创建新绑定，不自动启动终端或切换账户。

`portfolio_execution_context` 返回完整账户持仓、历史覆盖范围和已挂载策略。持仓包含手动与量化策略来源，目标为零可以平仓；`unchanged:true` 保持仓位。继续挂载有极大风险时，工作流可在目标中提出有原因的暂停；MT5 原生动作为移除 EA，不会自动恢复或自动平仓。QMT 不提供策略挂载控制。

`portfolio_execution_apply` 必须由工作流代码在匹配 executor 任务的真实调用链中调用。模型直接调用或伪造 JSON 来源无效。每个工作流 run 保存一份执行回执；未知提交、未确认暂停或挂单竞争会阻止后续发送。主会话用 `portfolio_execution_status` 查找运行及 operation_id，再用 `manual_trade_status` 核对已有命令；不使用新 operation_id 重发未知结果。同账户的目标批次串行，不同账户和研究任务继续并发。

MT5 准备要求 2.1.7+ 的 `mt5_trading_prepare`，按本次用户授权准备交易开关、算法权限和 Python 连接，必要时正常重启已配置终端；保持原账户。权限与 SDK 恢复有先后约束，不能称为原生 Python 真并行。准备有独立的 180 秒上限，结束时最后读取原生报价；原始 tick 时间、归一 UTC、时钟规则依据、接收时间和实测年龄保留。只消费 MT5 返回的 `quote_clock`，不手工减小时或用接收时间代替行情时间；归一后未来或过期报价仍拒绝，未知时钟与规则变化先修来源解释，不绕过校验。QMT 只读现有连接，不修改权限。

主会话仍可使用 `manual_trade_*` 处理用户明确要求的单次操作。观察、执行、状态、撤单均保留精确账户、原生单位、时效与幂等保护。旧 manual-trading 已安装时先加载提供只读导出桥的新版本，导入旧命令回执；没有该旧插件的新安装可独立使用本执行能力。
The public composition entry is portfolio_execution_configure({backend:"mt5"|"qmt",id?}) for an already configured native account. It returns {plugin_id,context_tool,apply_tool,arguments:{binding_id}}; workflows pass that whole reference as execution. portfolio_execution_context({binding_id,action:"identity"}) supplies account,tools,readTools,taskContext,accountProvider,fillSources,quantityRules. A native MT5/QMT account identity is not this composition contract. Supported backend/version prerequisites are in each capability declaration; missing optional packages can be located by plugin_catalog({plugin_id}), installed ones by plugin_discover/host.capabilities.list.

There are two caller paths. Main-session manual_trade_* capabilities execute an existing explicit user order intent after an observed account/position/quote. Workflow execution uses the workflow's own apply capability, which calls portfolio_execution_apply with host-verified executor provenance. Directly calling the adapter from a model cannot create that provenance. A fresh observation is not trading authority, and a run acceptance or native accepted order is not a confirmed fill. The declared receipt/status fields determine what happened.
