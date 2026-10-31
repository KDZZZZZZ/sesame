# 目标仓位执行

独立的账户执行能力。它可供任何满足冻结任务契约的工作流调用，不调度模型、不决定研究来源、不生成报告。

1. 显式加载已配置的 MT5 或 QMT 与本插件。
2. 主会话调用 `portfolio_execution_configure({backend:"mt5"})`，获得包含插件、context/apply 工具和 binding_id 的通用执行引用。
3. 工作流调用 context identity，并冻结返回的 account、taskContext、tools/readTools、quantityRules。执行角色的 task.input.execution 保存该引用，tradingPlan 保存 id、ownerConversationId、account。
4. 工作流工具调用 apply，传入保存的 run、plan 和目标仓位；后端由不可变绑定解析。主会话或模型直接调用 apply 会失败。

MT5 绑定要求 MT5 2.1.0+，`readTools` 明确包含账户上下文、纯读取的 `mt5_catalog` 和 `mt5_call`。先用目录取得当前行情/K线/指标及 Python `order_calc_profit` / `order_calc_margin` 的准确参数，再通过只读原生路由调用；目录查询不启动编辑器，计算不初始化或切换账户。包含连接关闭、订阅修改的 `mt5_python` 不授予研究角色。工作流还应按能力声明的 `effects` 核验绑定返回的读取工具。

执行层核验宿主提供的实际调用链，而不是模型传来的权限声明。后端也核验冻结账户、配置版本、活动任务、executor 角色及 workflow → execution.apply → backend 的调用来源。

原生行为保持：MT5 精确 lots/ticket、QMT 整数 shares/T+1，账户全来源平仓/减仓，目标不变不发单；M5+、源报价时效、最终一跳头寸/价格校验；策略停止须确认；未知或部分成交停止该批次。一个应用意图写入后不重放，读取回执和真实成交后由新一轮工作流重新判断。仅同一原生账户的交易写入与完整目标批次串行；不同账户、研究和观察继续并发，已有回执只读查询无需等交易锁。

主会话可用 `portfolio_execution_status` 按 binding_id/run_id 查询保存的执行进度及 operation_id，再用 `manual_trade_status` 读取对应命令。操作 ID 在发送前写入进度，进程中断后也可恢复查询；状态查询不恢复执行或重新发送。

MT5 状态刷新对已确认的原生订单先并行读取当前订单和持仓；存在唯一同品种、同 ticket 的活动订单时使用当前证据，当前订单缺失才精确查询历史订单。通过订单中真实的 `position_id` 读取成交并仅保留该订单的成交；订单 ID 不等于持仓 ID，成交票也不作为订单 ID。`evidence.historicalOrders` 保留已核验历史订单的原生终态，独立于原提交的 `execution_reported` 等回执状态；空数组不证明已撤单，未查询历史时也为空。查不到持仓标识时明确保留成交查询缺口，不能把缺失记录当作未发送或未成交。必需的原生查询失败继续返回错误；不靠扩大历史时间窗或重报订单恢复。

主会话手动交易入口：

- 意图待整理时，立即调用 `manual_trade_prepare({backend:"mt5",symbol:"EURUSD",operation_id:"prepare-1",user_authorized:true})`。返回既有观察结构、`observation_id` 和 `preparation`；不发订单。MT5 2.1.7+ 内部只做一次配置身份读取和一次 `mt5_trading_prepare`，在精确账户锁中准备权限与 Python 连接，按需正常重启原终端，再采集品种规则、持仓、挂单和最后报价。QMT 使用既有只读快照，不修改权限或连接。
- 意图已完整时，`manual_trade_execute` 传 `backend + symbol`，在一次调用内准备并执行，避免模型的第二次往返。其余 `action`、`side`、`quantity`、`price_limit` 和适用的 `limit_price` / `position_id` 保持原合同，不能省略或推断。已有 `observation_id` 路径仍保留，不能与 `backend + symbol` 混用。
- 准备有独立 180 秒上限，行情与决策有效期从最后原生 tick 开始计算。最终发送前再次核对准确账户和新配置版本，原生进程仍读取最新行情并校验持仓、价格、5 秒源行情时效与 1 秒报价到发送间隔。保留原始 tick 时间及 MT5 `quote_clock` 依据；使用后端归一的 UTC 验龄，异常保留原值、规则版本、实测 age、source 和 receivedAt。观察与发送绑定同一时钟规则版本；未知时钟或规则变化停止发送，不由执行插件推算时区。
- 准备和订单意图在副作用前写入私有回执库。同一 operation_id 与相同原输入返回原结果，不再次准备或发送；快捷执行生成的 observation_id 不参与调用者指纹。发送前失败保留根因并返回 `submission_attempted:false`；券商收到请求后拒绝可同时返回 `status:"rejected"` 与 `submission_attempted:true`，不能只凭状态判断没有发送，`null` 表示发送情况尚不能确认。未确认结果继续阻止同账户新订单。准备入口仅主会话可用，不扩大工作流后台权限。

`manual_trade_observe` 继续纯读。手动交易无需先运行 research、team、deployment 或遍历历史；原生权限与 SDK 恢复有顺序依赖，接口减少模型往返不代表这些原生步骤并行。

合成夹具验证不等于真实券商验收。QMT 原生券商接受路径未在此变更中实盘验证。
