本机终端和 MetaEditor 原生 MCP、MetaTrader.com 数据、官方 Python API 和启动器均使用已注册入口。按能力分工：读取交付事实，计算/Tester交付验证证据，执行消费明确授权意图。工作流负责选择与组合分析方法；同一份适用证据供多方法复用，不因读取另开报告。

Sesame 券商行情使用已声明的 `sesame/mt5#market` 数据源及本机 terminal MCP。`data_providers`、`market_instruments`、`canvas_binding` 和 `canvas_apply` 提供来源、品种与图表接口；实时订阅由宿主管理。MetaTrader.com 的 marketdata 是独立可选服务，disabled 不表示券商行情失效。`mt5_chart` 管理终端原生图表，不改变 Sesame 工作台。

`mt5_cache` 用于复用后端本地库的历史观察。symbols/inventory/bars/trades 可发现与读取已有数据，sync/sync_trades 在已验证的账户上分段下载并去重；大结果可用 save_as。时间是券商墙上时间编码，不作未知时区转换。remove 会清理指定行情系列，仅在用户要求时使用。需要统一市场数据和固定研究证据时，`market_read` 返回 DataRef、evidence、rowCount 和覆盖信息；缓存或历史查询成功不证明实时订阅可用。

`mt5_catalog` 声明当前原生工具的精确名称、inputSchema、workspace、plugin_id 和 agent_tool；缺少有效声明时按相关server/query读取，已有当前声明可复用。不把网页文档出现的工具当成本机已提供。mt5_call只读查询与纯计算，编辑用mt5_edit，回测用mt5_test，原生图表用mt5_chart，其他能力遵循目录路由。每次调用使用稳定command_id；mt5_command读取已有结果。长结果可用save_as保存到任务工作区JSON，保留返回的实际路径。

连接设置与可导入引用由 `mt5_settings` 提供，已有本机配置由插件发现、导入和验证；具体能力与凭据输入方式见 connection skill。普通行情查询复用已有会话，不要求用户重复设置连接，不读取或输出凭据原文。连接缺失、原生权限拒绝、账户未登录、历史不足是不同故障，依据返回证据处理；catalog 的工具可调用不代表账户已连接。

本地 terminal MCP 未连接，先用 `mt5_connect` 读取配置对应终端的进程证据，再分层核验 MCP 监听/认证与券商账户；只诊断传 `start_if_needed:false`。`terminal_process.running` 的 true/false/null 分别是已运行/确认未运行/未知；端口拒绝连接不能代替进程或账户证据。终端已开时处理其 MCP 开关、地址和读取权限，不重复启动；MCP 未连接本身不需要索取账户密码或密钥，也不循环读取目录。仅实际缺 token 或明确 401 才处理 MCP 凭据，已有健康会话直接复用。

成功收到的官方响应由后端保存为不可变 dataset_id。`data_read({datasetId})` 或 `data_read({ref})` 将实际输入写入执行目录并返回 path；`research_register` 可将真实执行结果与 inputIds/inputRefs 关联，报告能力使用当前声明的固定引用。是否需要计算或报告由任务目标决定，不为显示行情额外生成研究链路。原生输入是一行包含 result 的响应快照，content.text 可能还包含 JSON 字符串。received_at / provenance.as_of 是采集时间，不是行情时间；server_connected、报价 update_time、覆盖信息与订阅回执分别说明连接、观察时点、历史范围与显示状态。离线缓存不能宣称是实时行情。

真实交易必须来自用户明确指令或已批准的策略运行范围。挂载 EA、运行脚本、应用带 EA 的模板也可能交易。后端交易开关与 MT5 自身权限都生效；已有权限调整授权时，主Agent使用mt5_update_configuration修改插件选项、mt5_trading_permissions准备终端算法权限并回读，不要求重复授权。不得另写Python、shell、配置文件或MQL5绕过仍未获准或不可修改的限制。用户停止会话只取消当前请求，不保证停止已启动的 Tester、EA 或交易；应读取状态后调用相应停止/移除方法。

结果 unknown 时先检查官方订单、持仓、日志或 tester_get_status，不使用新 command_id 重发。returned 不是成交成功；检查官方 retcode、订单/成交 ticket、实际持仓与 Tester 状态。历史 ticket 使用字符串，时间明确 UTC 与 broker server time。详细操作见本插件 skill。
