# 目标仓位执行

## 执行路由选择（行动前先定路径，二选一不绕路）

- **路径 A — 单笔明确意图（`manual_trade_execute`）**：用户已经明确给出标的、方向、数量与价格边界（或采纳了具体单笔方案）时，主会话直接调用 `manual_trade_execute({backend,symbol,operation_id,user_authorized:true,...})` 在单次调用内完成准备并带 `stop_loss`/`take_profit` 发送；无需先走 research、workflow 或读历史。
- **路径 B — 用户授权自主选单与执行（`trading_decision` → `portfolio_execution_apply`）**：用户授权由 Agent 自主决定标的、时机与仓位（例如“自己决定”“允许提交订单”“拿 pass”）时，使用 `trading_decision_plan`（`execute:true`）与 `trading_decision_run` 执行。MT5 绑定支持在目标中随单附带 `stop_loss` 与 `take_profit`（`supportsAttachedStops:true`），无需退回要求用户逐笔确认；QMT 不支持随单止损（`supportsAttachedStops:false`），若风控要求随单保护须在授权当下立即告知缺口。
- **禁止错误泛化**：不得把路径 A 的“必须来自用户完整意图”泛化为路径 B 不能自主下单，也不得在未查清 `supportsAttachedStops` 前向用户承诺“随后提交带止损订单”。

本插件按能力分为账户取证和交易执行：只读快照为方法与工作流提供账户事实，执行能力消费已经形成且获授权的交易意图。工作流负责选择方法、综合证据、决策、调度和报告；读取账户不会自动进入交易或生成报告。已有匹配账户与配置版本的绑定可直接复用；缺少绑定时用 `portfolio_execution_configure({backend:"mt5"|"qmt",id?})` 绑定用户选定且已配置的适配器，把返回的 `{plugin_id,context_tool,apply_tool,arguments:{binding_id}}` 整体作为 `execution` 交给工作流。当前支持 MT5 lots 和 QMT STOCK shares。配置变化时创建新绑定，不自动启动终端或切换账户。

`portfolio_execution_context` 返回完整账户持仓、历史覆盖范围和已挂载策略。持仓包含手动与量化策略来源，MT5 开仓和加仓的市价单可附 stop_loss、take_profit，减仓不更改已有保护，零目标平仓不带保护；`unchanged:true` 保持仓位。继续挂载有极大风险时，工作流可在目标中提出有原因的暂停；MT5 原生动作为移除 EA，不会自动恢复或自动平仓。QMT 不提供策略挂载控制。

`portfolio_execution_apply` 必须由工作流代码在匹配 executor 任务的真实调用链中调用。模型直接调用或伪造 JSON 来源无效。每个工作流 run 保存一份执行回执；未知提交、未确认暂停或挂单竞争会阻止后续发送。主会话用 `portfolio_execution_status` 查找运行及 operation_id，再用 `manual_trade_status` 核对已有命令；不使用新 operation_id 重发未知结果。同账户的目标批次串行，不同账户和研究任务继续并发。

主会话用 `manual_trade_*` 处理用户明确要求的单次操作。用户说要手动交易时，立即调用 `manual_trade_prepare({backend,symbol,operation_id,user_authorized:true})` 准备已配置的账户，同时整理独立的订单意图；意图参数已完整时，直接调用 `manual_trade_execute({backend,symbol,operation_id,user_authorized:true,action,side,quantity,price_limit,...})`，在同一次调用里完成准备和发送，避免取完报价后再等模型一轮。不要先走 research、team、deployment 或通读历史。symbol、方向、原生数量、价格边界以及平仓 ticket 等必须来自用户的完整意图，不从快照擅自猜单。

MT5 准备要求 2.1.7+ 的 `mt5_trading_prepare`，按本次用户授权准备交易开关、算法权限和 Python 连接，必要时正常重启已配置终端；保持原账户。权限与 SDK 恢复有先后约束，不能称为原生 Python 真并行。准备有独立的 180 秒上限，结束时最后读取原生报价；原始 tick 时间、归一 UTC、时钟规则依据、接收时间和实测年龄保留。只消费 MT5 返回的 `quote_clock`，不手工减小时或用接收时间代替行情时间；归一后未来或过期报价仍拒绝，未知时钟与规则变化先修来源解释，不绕过校验。QMT 只读现有连接，不修改权限。

`manual_trade_observe` 始终纯读。执行仍支持已有 `observation_id`，它与 `backend + symbol` 二选一；准备成功返回可供一个意图使用的 observation_id 和 preparation 摘要。相同 operation_id 与相同原输入只返回原回执，不重复准备或下单。是否尝试发送要看 `submission_attempted` 和原生回执：`false` 表示发送前停止，`true` 表示已经尝试原生发送，`null` 表示尚不能确认；`rejected` 既可能是发送前拒绝，也可能是券商收到请求后拒绝，不能只凭状态判定没有发送。失败先看具体 reason，未知订单先查原 ID，不换 ID 重发。已有工作流执行链不使用新的主会话授权入口，观察、执行、状态、撤单均保留精确账户、原生单位、时效与幂等保护。
