# 目标仓位执行

本插件负责原生账户与执行，工作流负责决策、调度和报告。先加载用户选择且已配置的执行适配器，再用 `portfolio_execution_configure` 固定账户和配置版本；把返回的 capability reference 交给所选工作流。当前实现支持 MT5 lots 和 QMT STOCK shares。配置变化时创建新绑定，不自动启动终端或切换账户。

`portfolio_execution_context` 返回完整账户持仓、历史覆盖范围和已挂载策略。持仓包含手动与量化策略来源，目标为零可以平仓；`unchanged:true` 保持仓位。继续挂载有极大风险时，工作流可在目标中提出有原因的暂停；MT5 原生动作为移除 EA，不会自动恢复或自动平仓。QMT 不提供策略挂载控制。

`portfolio_execution_apply` 必须由工作流代码在匹配 executor 任务的真实调用链中调用。模型直接调用或伪造 JSON 来源无效。每个工作流 run 保存一份执行回执；未知提交、未确认暂停或挂单竞争会阻止后续发送。主会话用 `portfolio_execution_status` 查找运行及 operation_id，再用 `manual_trade_status` 核对已有命令；不使用新 operation_id 重发未知结果。同账户的目标批次串行，不同账户和研究任务继续并发。

主会话仍可使用 `manual_trade_*` 处理用户明确要求的单次操作。观察、执行、状态、撤单均保留精确账户、原生单位、时效与幂等保护。旧 manual-trading 已安装时先加载提供只读导出桥的新版本，导入旧命令回执；没有该旧插件的新安装可独立使用本执行能力。
