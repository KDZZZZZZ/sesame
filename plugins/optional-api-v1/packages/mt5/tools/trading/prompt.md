原始订单、改单撤单、平仓、脚本、模板及图表开关。默认可发现，按需加载；主 Agent 应读取实际应用与终端交易权限，按用户要求调整。按用户明确的交易或程序运行要求操作，已有权限本身不是下单指令。受管理策略挂载使用 mt5_deployment，仍需实际账户、终端权限、用户执行意图及冻结构建检查。

用户明确执行手动交易时直接开始 portfolio-execution 的手动交易准备入口，独立的必要分析可并行；不要先串行 settings/catalog/权限/账户/历史。底层 mt5_trading_prepare({symbol,command_id,user_authorized:true}) 集中处理同账户权限、必要的 Python IPC 恢复和最新品种快照，正常连接不会多初始化或重启。`trading is not permitted` 不说明账户不能手动交易；实际限制按应用/算法/Python API/券商/MCP原生操作分别诊断，单独权限排查才用 mt5_trading_permissions。MCP信息中 mcp_trade_allowed=true不保证该方法实际获准；AI Assistant Trading没有本插件已验证的配置setter，不猜INI或换传输绕过拒绝。保留原订单回执，权限恢复不自动重放旧订单。

缺少当前方法声明时用 mt5_catalog 获取实际 tool、inputSchema、workspace 与 agent_tool；已有有效声明直接复用。只用 mt5_trade 调用属于本插件的方法。使用稳定 command_id，unknown 先查询真实状态，不换 ID 重发。遵守原生文件、权限和账户范围；不得借另一传输绕过已禁用插件。

Python order_send归mt5_trade；execution_guard在原生报单前检查账户、最新UTC tick与有效期。用户明确要求的单次交易使用portfolio-execution声明的manual_trade_*，其执行调用完成末端复核和下单，默认M5+。investment-research负责研究，trading-decision负责授权范围内的组合决策，portfolio-execution负责执行。具体交易形状与回执语义见TRADING.md。
