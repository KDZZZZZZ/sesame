MT5 是按需安装的可选后端，要求 Sesame >=0.2.3-dev.8。安装/加载本身不导入旧应用内部集合或原生凭据；用户要求连接或使用 MT5 后，主动发现并复用本机已有配置，由插件保存、导入并验证，无需重复索取这项配置任务的授权。新配置只存本插件私有 storage；固定旧 Artifact 可由宿主读回，不代表旧可变工程集合已迁移。

先用 mt5_dependencies inspect 复用已有 MT5/MCP、Windows Python 和 Wine 配置；真实缺项再读 dependencies skill 并把下载/记录放插件私有目录。本体不内置 MT5 或编译镜像，默认本机编译无需虚拟机。

按 connection skill 先查脱敏设置和待导入引用，用 host_files 检查必要的安装路径与进程；找不到唯一安装不等于未安装。不要打开 Sesame 设置让用户手填。只有本机无法取得有效 MCP 凭据时，才请用户从 MT5「工具 → 选项 → MCP」复制当前连接导出发给 Sesame，随后用 source_message_id 导入、保存并验证。普通查询沿用已登录会话；真实 Tester 缺账户密码时按 connection skill 使用明确标记的账户凭据输入并按引用导入，不让用户重复填设置，不把密码放进工具参数，不把配置任务当持续交易授权。

MT5 的全部官方能力由 sesame/mt5 提供，各工具保留自己的 schema。先读取实际 mt5_catalog 定义，不猜测原生字段；Tester 官方能力可用 mt5_catalog({server:"tester"}) 发现，但调用仍使用目录返回的真实 server。使用交易能力时先读本插件声明的 TRADING.md，其中定义 MT5 的具体接口、传输前提、订单范围与恢复步骤；调度、研究与汇总沿用调用者选择的工作流。

采用调用者选择的策略语言和创作路线。选择 SVL→MQL5 翻译时，用 sesame/strategy-authoring 写 SVL、发布源并由宿主从源生成图，再读取 mt5_target，按目标 profile 翻译原生实现；长源码先在当前工作区写单个 JSON 清单（mt5_translation 参数去掉 operation_id，files 内嵌文本），再用 mt5_translation_file(operation_id, manifest_path) 固定源、文件、source_map、parameter_map 和差异，避免工具调用中全文重发。先读 target/translation-file.md；parameter_map 必须覆盖所有 SVL 参数，未验证差异写成 limited adaptation，不提前声明 equivalent；同 ID/路径重试复用首次快照，即使文件已清理；修改内容用新 ID。小内容也可用 mt5_translation 内联登记。随后按任务显式调用 mt5_compile、mt5_backtest 或 mt5_deployment。原生编译、真实 Tester、实盘运行与宿主 SVL 回放是各自独立的证据；不得把一层通过写成另一层已验证。FIX 为可选目标能力。

已有独立 MQL5/EX5 工程继续由 mt5_project 管理，保留原语言、修订和轨迹。它们没有 SVL 证明，不能用新的图解释旧运行。主 Agent 可管理配置、查看账本和运行状态；只有用户明确要求交易或运行策略，才执行对应原生动作。插件加载、研究或编译成功本身不构成交易指令。
# 工作流交易的账户与风险控制

`mt5_trading_context({action:"identity"})` 只返回已配置的 `{accountId,server,revision}`。`action:"snapshot"` 读取全账户资金、持仓、活动订单、指定最近天数的成交及历史订单、同账户原生挂载；不按 magic、comment 或手动/策略来源过滤。`history_days` 默认 7、范围 1–90；broker 保留的数据不代表全部历史，读取失败不能当作空仓。

计划入口可由主会话或满足冻结账户契约的受托工作流任务使用。任务固定 `{tradingPlan:{id,account,ownerConversationId},runId,role,execution}`，其中 `execution` 指定调用者选择的 `pluginId/contextTool/applyTool`、账户及执行上下文。任务必须仍在运行，账户及配置版本必须与当前连接一致；不能靠模型填写身份字段或指定插件名称获得授权。

`mt5_trading_pause({deployment_id,account,reason,authorization?})` 在事件任务中仅允许 `role:"executor"`。委托写入须经过宿主记录的工作流工具 → 冻结的执行能力 → MT5 工具调用链。它复用真实挂载停止路径：写入停止标记并移除对应图表的 EA，不关闭任何持仓，不承诺保留执行状态或自动恢复。回执明确 `nativeAction:"remove_expert"` 与真实 `status`；`unknown` 必须观察核实，不能改 ID 自动重放。

`mt5_trading_order({server:"python",tool:"order_send",arguments,command_id,authorization?})` 仅提交带原生执行/撤单保护的计划意图，工作流委托沿用上述调用链校验。兼容旧版 `sesame/manual-trading` 签名契约时，任务输入仍为 `{tradingPlan:{id,backend:"mt5",account,ownerConversationId},runId,role,executionPublicKey}`；模型只持有 Ed25519 公钥，私钥留在运行时内存。旧证明为 `{expiresAt,signature}`，消息为 `canonical({version:1,taskId,runId,action:工具名,args:去除authorization的原参数,expiresAt})`，UTF-8 字节以 Ed25519 签署，签名使用标准 base64；有效期在当前时间之后且不超过 60 秒。主会话可省略证明；现有普通交易工具不改变。

命令侧表固定账户、主会话拥有者和计划/运行/任务身份；原始回执归主会话持久化。`mt5_trading_command({command_id})` 只读取该拥有者与同一 login/server 的计划回执，允许配置版本更新后核对历史结果，不重新发送。`mt5_python` 的路由不能调用 `order_send` 等 trading 类方法。

计划订单的 `execution_guard.expected_positions` 必须包含观察时本品种全部持仓，数组项为 `{ticket,type,volume}`（ticket 和十进制 volume 为字符串，type 为 0/1）；无持仓也必须传 `[]`。原生 worker 在 order_check 后与最终发送前重新比较完整持仓，并拒绝任何本品种活动订单，防止其他策略改变净仓后仍按旧目标差量下单。旧主会话执行保护可省略此字段。
