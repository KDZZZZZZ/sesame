# 目标仓位执行

从 manual-trading 分离出的执行能力，要求 Sesame **0.2.3-dev.8 或更新版本**，使用带祖先调用活性校验的宿主调用来源证明。它可供任何满足冻结任务契约的工作流调用，不调度模型、不决定研究来源、不生成报告。

工作流绑定要求 `sesame/mt5` **1.6.0+** 或 `sesame/qmt` **1.4.0+**。直接单次交易工具仍按 `manual_trade_inspect` 返回的原生能力要求核验：MT5 需要带 `execution_guard` 的 Python SDK 通道（插件 1.3.0+），QMT 需要带原生执行校验的 1.2.0+。已有连接和账户由后端配置，执行插件不自动连接或切换账户。

1. 显式加载已配置的 MT5 或 QMT 与本插件。
2. 主会话调用 `portfolio_execution_configure({backend:"mt5"})`，获得包含插件、context/apply 工具和 binding_id 的通用执行引用。
3. 工作流调用 context identity，并冻结返回的 account、taskContext、tools/readTools、quantityRules。执行角色的 task.input.execution 保存该引用，tradingPlan 保存 id、ownerConversationId、account。
4. 工作流工具调用 apply，传入保存的 run、plan 和目标仓位；后端由不可变绑定解析。主会话或模型直接调用 apply 会失败。

执行层核验宿主提供的实际调用链，而不是模型传来的权限声明。后端也核验冻结账户、配置版本、活动任务、executor 角色及 workflow → execution.apply → backend 的调用来源。旧 manual-trading 的短期 Ed25519 授权仍受后端支持。

原生行为保持：MT5 精确 lots/ticket、QMT 整数 shares/T+1，账户全来源平仓/减仓，目标不变不发单；M5+、源报价时效、最终一跳头寸/价格校验；策略停止须确认；未知或部分成交停止该批次。一个应用意图写入后不重放，读取回执和真实成交后由新一轮工作流重新判断。仅同一原生账户的交易写入与完整目标批次串行；不同账户、研究和观察继续并发，已有回执只读查询无需等交易锁。

主会话可用 `portfolio_execution_status` 按 binding_id/run_id 查询保存的执行进度及 operation_id，再用 `manual_trade_status` 读取对应命令。操作 ID 在发送前写入进度，进程中断后也可恢复查询；状态查询不恢复执行或重新发送。

旧数据通过已安装 manual-trading 的主会话只读 `manual_trading_execution_export` 导入，不申请跨插件私有存储权限。仅导入当前所有者回执，其他所有者的未知提交保留为账户阻断项；不复用旧观察。身份不同或冲突的 operation_id 拒绝。已安装旧插件但未加载/未升级时先报出迁移前置条件，避免把丢失旧账误当成可发送新订单。

合成夹具验证不等于真实券商验收。QMT 原生券商接受路径未在此变更中实盘验证。
