# mt5 公开能力契约
此文依据当前实现。示例中的ID/路径/Ref必须用对应公开入口的实际返回值；它们展示参数形状，不是默认任务步骤。宿主能力不会直接暴露为普通Agent工具。

## mt5_trading_prepare

调用者：主 Agent、host。用户已要求手动交易时优先使用此集中准备入口；参数完整时可直接调用 portfolio-execution 的 `manual_trade_execute` 快捷入口，由执行插件内部准备。无需先查目录、重复读取账户或逐项开启权限。

输入：`{symbol:<准确品种>,command_id:<稳定16–128字符>,user_authorized:true,expected_account?:{accountId,server,revision}}`。已有用户授权继续有效；不猜订单数量、价格或账户，不自动切换登录。

输出：`{account:{accountId,server,revision},summary,terminal,spec,positions,orders,tick,quote_clock,readStartedAt,capturedAt,preparation}`。原生 tick 时间保持不变；`quote_clock` 保留实际账户/服务器、原始毫秒、归一 UTC 毫秒、offsetMinutes、ruleId 与 ruleRevision。规则由 MT5 原生桥接统一解释；未知服务器/日期或未验证 DST 时段拒绝准备。报价是否可执行仍由执行入口即时校验决定，不能用接收时间代替源时间。

行为：绑定当前账户，内部以配置版本校验开启 Sesame 交易许可；需要时复用终端算法交易准备；仅明确 Python `-10004` 时初始化一次。正常连接不初始化、不重启。规格、持仓和挂单一起调度，原生 Python worker 仍串行；随后读取最新报价，再核验账户。权限已开启时直接读取；主 Agent 可同时处理互不依赖的用户意图信息。

幂等与失败：同命令并发调用共享准备，成功后再次调用重新读事实，权限副作用不重复。可选 expected_account 在任何权限副作用前校验，准备过程中账户或配置变化立即拒绝；自身开启应用许可后返回新 revision。保留取消、原生错误和失败阶段，不返回虚假 ready、不下单、不重放旧订单。券商限制、MCP AI Assistant Trading 授权和 Python API 禁用分别报明实际缺项；不猜未公开的配置项。

## mt5_trading_permissions

调用者：主Agent、host。区分插件许可、账户只读状态、MCP许可与终端算法交易开关；按已有用户授权准备当前绑定终端，不修改宿主接口。

输入：`{action:"read"}`，或`{action:"enable",command_id:<稳定16–128字符>,expected_version:<读回configuration_version>}`。不接受账户、路径、密码或自定义INI覆盖。

输出：read返回`{checked_at,configuration_version,account:{login,server,type,read_only},application:{allow_trading},terminal:{connected,experts_trade_allowed,mcp_trade_allowed}}`；未知布尔为null。enable返回持久的`configuration_change`回执，含`status/result:{before,after,restarted,verified}/error?`；只有配置版本与账户保持一致、真实终端权限回读通过才`applied`。准备途中失败且无法确定重启状态时，`restarted=null`，不猜成false。

依赖与副作用：沿用统一配置声明的Terminal MCP、绑定账户和已有安装发现。read仅取状态；enable复用`prepareTerminal`，仅在无活动终端任务、持仓、挂单或EA时正常重启精确终端，写私有临时启动配置并清理；失败时尝试恢复原账户连接并禁用算法交易，恢复也可能失败，以实际回读和错误为准。已启用无需重启。重启配置保持DLL关闭；不重启路径仅核验既有状态。不下单、不自动挂载。

恢复：同命令ID/输入/会话返回原回执，冲突拒绝；失败、running或unknown不得自动重新执行，先read真实状态。旧用户授权继续有效；权限修复不自动重放旧订单，不代表报价新鲜、订单成交或策略可用。本入口不改变原生MCP授权、Python API禁用或券商限制，具体缺项须分别说明。

## mt5_catalog
调用者：agent、host。取得当前原生方法定义、归属工具及不可用原因。

输入：{server?:"terminal"|"metaeditor"|"marketdata"|"python"|"launcher",query?:<≤200字符方法名或说明>}；例 {server:"python",query:"version"}。

输出与状态：{checked_at,items:[{server,status,reason,server_info,workspace,tools:[{name,description,inputSchema,agent_tool,permission,callable,blocked_reason,...}],prerequisite?}]}；目录就是当前版本声明，不需试猜方法。

依赖入口：原生接口需要时使用；Sesame行情有已声明 data-access/canvas 入口，不以catalog作为必经流程。

副作用：native-discovery

边界与恢复：目录查询不启动终端或 MetaEditor。Terminal MCP 拒绝连接返回 unavailable，不推断终端进程或账户状态；用 mt5_connect 先核对所选终端进程。MetaEditor 未监听返回 not_running；确需编辑时由主 Agent 使用 mt5_edit 的 launcher/start_editor，或执行已授权的编辑/编译能力。installed 不等于已连接。marketdata 是独立可选服务，disabled 不影响 terminal 券商行情。

## mt5_call
调用者：agent、host。调用目录已声明的official一般读取方法，并保留原生回执。

输入：{server,tool,arguments,command_id,save_as?}；从 mt5_catalog.items[].tools 取 agent_tool="mt5_call" 且 callable:true 的具体方法。最小调用形状：{server:item.server,tool:method.name,arguments:<该方法声明的业务参数>,command_id:"native-operation-unique-01"}；server 取包含该方法的目录项，arguments 按该方法 inputSchema 与说明填写，不把其他组的方法当例子重试。command_id 稳定16–128字符；save_as 为工作区JSON路径。

输出与状态：{id,conversation_id,server,tool,operation_class,status,result,dataset_id,error,created_at,completed_at}；status=returned|failed|unknown（运行中可为running）。returned只说明收到响应，实际操作还要读result.isError/error/retcode或业务status；dataset_id是本插件保存证据。save_as时省略result并返回saved_to。

依赖入口：仅处理 official一般读取；catalog给出参数与callable/blocked_reason，跨组方法按agent_tool调用。

副作用：native-call、plugin.state.write、filesystem-on-save_as

边界与恢复：同一ID、同请求、同配置版本返回原回执；unknown保持原ID用mt5_command核对，不自动重放。调用前的明确submission_attempted:false才证明未发送。 副作用取决于catalog所声明的方法；只读目标不能用写入/启动方法冒充检查。

## mt5_cache
调用者：agent、host。查询或显式同步本地MT5历史缓存。

输入：symbols/inventory 用 {action}；bars/sync 用 {action,symbol,period,from,to}，范围为券商墙时秒整数[from,to)，bars可加limit(1–20000)；trades用symbol/from/to；sync_trades用from/to。remove只用symbol/period并删除当前服务器该整条序列，不按from/to范围删除。save_as可保存完整JSON到工作区。例{action:"inventory"}；bars返回next_before时，可令下一页to=next_before继续向历史读取。

输出与状态：symbols:{server,items:[{symbol,description,digits,point,selected,currency}],updated_at,cached,warning?}；inventory/remove:{items:[{server,symbol,period,bar_count,first_time,last_time,updated_at}],bytes,max_bytes,typed_cache:{bar_count,payload_bytes},time_basis}；bars:{server,symbol,period,bars:[{time,open,high,low,close,volume}],has_more,next_before,updated_at,time_basis}；sync:{server,symbol,period,downloaded,reused_chunks,updated_at,time_basis}；trades:{items:[原生成交记录],sync:{updated_at,start,end}|null,time_basis}；sync_trades:{downloaded,updated_at}。save_as分支仅返回{saved_to}。

依赖入口：inventory可读所有本地缓存；其他分支需要已配置账户范围。bars/trades不依赖实时连接；symbols优先使用24小时目录缓存，未命中/过期会访问当前终端并可在失败时返回旧缓存和warning。sync/sync_trades需要终端与券商账户核验。统一研究历史入口是market_read。

副作用：cache.write-on-symbol-refresh-or-sync-or-remove、network-on-symbol-refresh-or-sync、filesystem-on-save_as

边界与恢复：本地bars/trades和symbols.cached:true不能证明实时行情；time_basis保留券商墙时，不当UTC epoch。sync每次最多200000根。 remove删除精确server/symbol/period的全部行情缓存与覆盖记录；from/to不缩小删除范围。成交与冻结研究证据不受影响；不能把清理缓存描述为清理日报。 symbols的warning说明本次刷新失败；cached:true与updated_at是旧数据证据。sync.downloaded只说明写入数量，不能替代标准coverage证据。

## mt5_command
调用者：agent、host。读取已有原生命令记录。

输入：{command_id:<已有同会话命令键>}；例 {command_id:"read-version-unique-01"}。

输出与状态：{id,conversation_id,server,tool,operation_class,status,result,dataset_id,error,created_at,completed_at}；status=returned|failed|unknown（运行中可为running）。returned只说明收到响应，实际操作还要读result.isError/error/retcode或业务status；dataset_id是本插件保存证据。save_as时省略result并返回saved_to。

依赖入口：命令属于当前会话；不需要重发原生操作。

副作用：只读，无外部写入。

边界与恢复：只是保留结果，returned/unknown不能自动变成成交或完成。

## mt5_chart
调用者：agent、host。调用目录已声明的charts终端原生图表方法，并保留原生回执。

输入：{server,tool,arguments,command_id,save_as?}；从 mt5_catalog.items[].tools 取 agent_tool="mt5_chart" 且 callable:true 的具体方法。最小调用形状：{server:item.server,tool:method.name,arguments:<该方法声明的业务参数>,command_id:"native-operation-unique-01"}；server 取包含该方法的目录项，arguments 按该方法 inputSchema 与说明填写，不把其他组的方法当例子重试。command_id 稳定16–128字符；save_as 为工作区JSON路径。

输出与状态：{id,conversation_id,server,tool,operation_class,status,result,dataset_id,error,created_at,completed_at}；status=returned|failed|unknown（运行中可为running）。returned只说明收到响应，实际操作还要读result.isError/error/retcode或业务status；dataset_id是本插件保存证据。save_as时省略result并返回saved_to。

依赖入口：仅处理 charts终端原生图表；catalog给出参数与callable/blocked_reason，跨组方法按agent_tool调用。

副作用：native-call、plugin.state.write、filesystem-on-save_as

边界与恢复：同一ID、同请求、同配置版本返回原回执；unknown保持原ID用mt5_command核对，不自动重放。调用前的明确submission_attempted:false才证明未发送。 管理MT5终端原生图表，不是Sesame画布；工作台显示用canvas_*。

## mt5_edit
调用者：agent、host。调用目录已声明的editor文件编辑/编译方法，并保留原生回执。

输入：{server,tool,arguments,command_id,save_as?}；从 mt5_catalog.items[].tools 取 agent_tool="mt5_edit" 且 callable:true 的具体方法。最小调用形状：{server:item.server,tool:method.name,arguments:<该方法声明的业务参数>,command_id:"native-operation-unique-01"}；server 取包含该方法的目录项，arguments 按该方法 inputSchema 与说明填写，不把其他组的方法当例子重试。command_id 稳定16–128字符；save_as 为工作区JSON路径。

输出与状态：{id,conversation_id,server,tool,operation_class,status,result,dataset_id,error,created_at,completed_at}；status=returned|failed|unknown（运行中可为running）。returned只说明收到响应，实际操作还要读result.isError/error/retcode或业务status；dataset_id是本插件保存证据。save_as时省略result并返回saved_to。

依赖入口：仅处理 editor文件编辑/编译；catalog给出参数与callable/blocked_reason，跨组方法按agent_tool调用。

副作用：native-call、plugin.state.write、filesystem-on-save_as

边界与恢复：同一ID、同请求、同配置版本返回原回执；unknown保持原ID用mt5_command核对，不自动重放。调用前的明确submission_attempted:false才证明未发送。 副作用取决于catalog所声明的方法；只读目标不能用写入/启动方法冒充检查。

## mt5_python
调用者：agent、host。调用目录已声明的python官方只读API方法，并保留原生回执。

输入：{server,tool,arguments,command_id,save_as?}；从 mt5_catalog.items[].tools 取 agent_tool="mt5_python" 且 callable:true 的具体方法。最小调用形状：{server:item.server,tool:method.name,arguments:<该方法声明的业务参数>,command_id:"native-operation-unique-01"}；server 取包含该方法的目录项，arguments 按该方法 inputSchema 与说明填写，不把其他组的方法当例子重试。command_id 稳定16–128字符；save_as 为工作区JSON路径。

输出与状态：{id,conversation_id,server,tool,operation_class,status,result,dataset_id,error,created_at,completed_at}；status=returned|failed|unknown（运行中可为running）。returned只说明收到响应，实际操作还要读result.isError/error/retcode或业务status；dataset_id是本插件保存证据。save_as时省略result并返回saved_to。

依赖入口：仅处理 python官方只读API；catalog给出参数与callable/blocked_reason，跨组方法按agent_tool调用。

副作用：native-call、plugin.state.write、filesystem-on-save_as

边界与恢复：同一ID、同请求、同配置版本返回原回执；unknown保持原ID用mt5_command核对，不自动重放。调用前的明确submission_attempted:false才证明未发送。 不执行任意Python；order_send/login等交易类方法路由到交易能力。

## mt5_system
调用者：agent、host。调用目录已声明的system本机/网络操作方法，并保留原生回执。

输入：{server,tool,arguments,command_id,save_as?}；从 mt5_catalog.items[].tools 取 agent_tool="mt5_system" 且 callable:true 的具体方法。最小调用形状：{server:item.server,tool:method.name,arguments:<该方法声明的业务参数>,command_id:"native-operation-unique-01"}；server 取包含该方法的目录项，arguments 按该方法 inputSchema 与说明填写，不把其他组的方法当例子重试。command_id 稳定16–128字符；save_as 为工作区JSON路径。

输出与状态：{id,conversation_id,server,tool,operation_class,status,result,dataset_id,error,created_at,completed_at}；status=returned|failed|unknown（运行中可为running）。returned只说明收到响应，实际操作还要读result.isError/error/retcode或业务status；dataset_id是本插件保存证据。save_as时省略result并返回saved_to。

依赖入口：仅处理 system本机/网络操作；catalog给出参数与callable/blocked_reason，跨组方法按agent_tool调用。

副作用：native-call、plugin.state.write、filesystem-on-save_as

边界与恢复：同一ID、同请求、同配置版本返回原回执；unknown保持原ID用mt5_command核对，不自动重放。调用前的明确submission_attempted:false才证明未发送。 副作用取决于catalog所声明的方法；只读目标不能用写入/启动方法冒充检查。

## mt5_test
调用者：agent、host。调用目录已声明的tester原生Tester方法，并保留原生回执。

输入：{server,tool,arguments,command_id,save_as?}；从 mt5_catalog.items[].tools 取 agent_tool="mt5_test" 且 callable:true 的具体方法。最小调用形状：{server:item.server,tool:method.name,arguments:<该方法声明的业务参数>,command_id:"native-operation-unique-01"}；server 取包含该方法的目录项，arguments 按该方法 inputSchema 与说明填写，不把其他组的方法当例子重试。command_id 稳定16–128字符；save_as 为工作区JSON路径。

输出与状态：{id,conversation_id,server,tool,operation_class,status,result,dataset_id,error,created_at,completed_at}；status=returned|failed|unknown（运行中可为running）。returned只说明收到响应，实际操作还要读result.isError/error/retcode或业务status；dataset_id是本插件保存证据。save_as时省略result并返回saved_to。

依赖入口：仅处理 tester原生Tester；catalog给出参数与callable/blocked_reason，跨组方法按agent_tool调用。

副作用：native-call、plugin.state.write、filesystem-on-save_as

边界与恢复：同一ID、同请求、同配置版本返回原回执；unknown保持原ID用mt5_command核对，不自动重放。调用前的明确submission_attempted:false才证明未发送。 副作用取决于catalog所声明的方法；只读目标不能用写入/启动方法冒充检查。

## mt5_backtest
调用者：agent、host。运行或观察管理中的真实MT5 Tester任务。

输入：start:{action:"start",command_id,build_id,config:{symbol,period,from_date,to_date,deposit,currency,leverage,model,parameters},parameter_space?}；model=0|1|2|4，日期为券商日期，终止日排除；参数网格最多64组。其他：{action:"list",project_id?} 或 {action:"get"|"wait"|"stop",backtest_id}。

输出与状态：start/get/wait/stop返回job及passes[{id,status,metrics?,error?,run_record}]；list为任务数组并附run_records。queued/running/canceling不是完成；终态succeeded/failed/canceled/unknown按原生证据，SVL pass可有固定run_record，旧工程可为null。

依赖入口：成功固定build；真实Tester所需终端/账户由 mt5_dependencies/mt5_settings 明确。

副作用：process、plugin.state.write、resources.publish

边界与恢复：wait最多20秒只等待，不自动停止；stop显式终止Tester，不撤实盘单。稳定command_id不重复启动。引擎成功不证明策略有效，unknown不能换ID自动重跑。

## mt5_trade
调用者：agent、host。调用目录已声明的trading原生交易方法，并保留原生回执。

输入：{server,tool,arguments,command_id,save_as?}；从 mt5_catalog.items[].tools 取 agent_tool="mt5_trade" 且 callable:true 的具体方法。最小调用形状：{server:item.server,tool:method.name,arguments:<该方法声明的业务参数>,command_id:"native-operation-unique-01"}；server 取包含该方法的目录项，arguments 按该方法 inputSchema 与说明填写，不把其他组的方法当例子重试。command_id 稳定16–128字符；save_as 为工作区JSON路径。

输出与状态：{id,conversation_id,server,tool,operation_class,status,result,dataset_id,error,created_at,completed_at}；status=returned|failed|unknown（运行中可为running）。returned只说明收到响应，实际操作还要读result.isError/error/retcode或业务status；dataset_id是本插件保存证据。save_as时省略result并返回saved_to。

依赖入口：仅处理 trading原生交易；catalog给出参数与callable/blocked_reason，跨组方法按agent_tool调用。

副作用：native-call、plugin.state.write、filesystem-on-save_as

边界与恢复：同一ID、同请求、同配置版本返回原回执；unknown保持原ID用mt5_command核对，不自动重放。调用前的明确submission_attempted:false才证明未发送。 会发生真实订单/EA等副作用，须对应用户交易指令；配置/编译请求不等于交易授权。

## mt5_deployment
调用者：agent、host。检查、显式挂载或停止原生EA。

输入：{action:"list"}；{action:"check",pass_id:<成功Tester pass>}；mount:{action:"mount",pass_id,request_id,login,server,artifact_digest} 用check真实返回值；{action:"stop",deployment_id}。

输出与状态：list:{items,candidates,preparations}；check含ready/preparable、账户及artifact_digest、原因、run_record；mount/stop返回真实部署记录含id/status/run_record。running需原生挂载确认，unknown保留不确定。

依赖入口：主会话，且用户明确要求运行/停止策略；只能挂载已回测冻结EX5。

副作用：external-strategy-operation、plugin.state.write

边界与恢复：check.preparable:true表示已授权mount可完成准备并复核，不需要猜MCP开关。stop移除EA但不平仓；unknown不换request_id重复。

## mt5_project
调用者：agent、host。创建、签出、保存或查看独立MQL5工程。

输入：分支互斥：{action:"list"}；{action:"create",title:"研究草稿"}；{action:"checkout",project_id}；{action:"save",checkout_id}；{action:"configure_risk",project_id,expected_version,test_risk_limits:{max_risk_per_trade_pct,max_daily_loss_pct,max_open_positions,max_lots}}。save不传project_id/expected_version。

输出与状态：list为工程数组；create/save/configure_risk 返回{id,version,title,revision,source_digest,...}；checkout:{id,project_id,conversation_id,revision,path,sdk_path,...}，id即checkout_id。原样save保持revision，内容改变生成新revision。

依赖入口：本地工程操作不需终端；checkout是当前会话真实工作副本；configure_risk仅主会话。源码契约见声明的native-ea/visual-state-machines skills。

副作用：plugin.state.write、workspace.write

边界与恢复：create只是可编辑草稿，不表示已实现/编译/回测。SDK/平台入口不能改；revision冲突需新checkout合并。

## mt5_inspect
调用者：agent、host。读取能力、工程实现状态或构建证据。

输入：{} 看本机能力；{project_id} 或 {build_id} 二选一；可附 engine_node_id 下钻实际节点。例 {project_id:"<create返回id>"}。

输出与状态：无ID:{installed,compile,tester,deploy,sdk_version,reason,dependencies}；project返回工程、files、implementation、builds、backtests、engine摘要；build返回固定构建及diagnostics；节点返回{revision,engine_digest,node,edges,source}。

依赖入口：无额外运行前提。

副作用：只读，无外部写入。

边界与恢复：compile可用不是编译完成；checked仅源码校验，declared只是旧声明；均不代表Tester/实盘成功。

## mt5_compile
调用者：agent、host。编译指定冻结源码并保存真实构建结果。

输入：{project_id:<已保存工程ID>,revision:<正整数源码版本>}。

输出与状态：固定build记录含id/project_id/revision/status、诊断/产物摘要；成功status=succeeded、EX5摘要存在。失败以compile_failed工具错误返回build ID与diagnostics/recovery，完整构建仍可mt5_inspect读取。

依赖入口：mt5_project.save或translation已保存固定revision；mt5_dependencies inspect/probe说明本机MetaEditor/Windows Python/Wine前提。

副作用：process、plugin.state.write、private-filesystem

边界与恢复：冻结SDK/本机标准库后运行真实编译器，可能启动原生进程；不执行EA。诊断可指导修改checkout并save新revision，不能改旧构建冒充成功。

## configuration.read
调用者：host。供统一配置入口及能力依赖检查读取已声明的公开配置与凭据存在状态，支持服务和子任务上下文。

输入：{}。

输出：{settings:{version,servers,account,tester_agent,allow_trading,allow_host_operations}}。服务器仅含url/enabled/authenticated，账户及Tester代理密码仅以password_configured布尔值表示；不返回待导入凭据、连接诊断或私密值。

副作用：只读，无原生网络调用或配置变更。存在状态不证明远端鉴权与连接成功；原有mt5_settings及配置写入仍只允许主会话。

## mt5_settings
调用者：agent、host。读取脱敏配置、待导入引用和连接观察。

输入：{}。

输出与状态：{settings:{version,account,servers,allow_trading,allow_host_operations,...},pendingImports,environment,connection}；敏感值脱敏，pendingImports提供可导入引用。

依赖入口：主会话。

副作用：

边界与恢复：配置存在、python_installed或文件存在不证明Python IPC或券商账户连接成功；Terminal MCP与Python是独立通道。

## mt5_update_configuration
调用者：agent、host。直接配置 MT5 连接、账户、凭据及运行权限，立即刷新后台配置并保留脱敏幂等回执。

输入：{command_id:<稳定16–128字符>,expected_version:<settings.version>,changes}。changes支持 servers:{terminal|metaeditor|marketdata:{url?,enabled?,token?}}、account:{login?,server?,password?}、tester_agent:{address?,port?,password?}、allow_trading、allow_host_operations；也可单独用 {import_native:true} 读取已有原生配置。例 {command_id:"configure-terminal-token-01",expected_version:1,changes:{servers:{terminal:{token:"用户提供的API Key"}}}}。凭据字段省略保留现有值，空字符串清除；更换endpoint或账户身份会清除对应旧凭据，必要时同次传入新凭据。

输出与状态：{id,conversation_id,target,status,changes,result?,error?,created_at,completed_at}；changes里的token/password均为[redacted]，result只含脱敏settings。applied说明已保存且立即生效；mt5_connect核验终端与账户，mt5_catalog单独核验其他服务。

依赖入口：主会话；expected_version来自mt5_settings。目标及凭据来自用户提供或已知配置，已取得的用户授权继续有效。

副作用：plugin.state.write

边界与恢复：直接配置和可选mt5_import_configuration均可用；用户已给信息就保存并核验，不要求重新导出、设置页填写或重复授权。不回显密钥，不把密钥写入报告、脚本或长期记忆。版本冲突读取当前settings；相同command_id和输入重试仅返回原回执。保存不自动登录、启动终端或下单；外部原生拒绝保留其具体事实。

## mt5_import_configuration
调用者：agent、host。复用安全消息引用保存已有原生配置；它是直接配置之外的可选入口。

输入：{command_id,source_message_id:<settings.pendingImports中的msg_ID>,expected_version:<settings.version>}；没有secret/token/password参数。

输出与状态：{id,conversation_id,target,status,changes,result?,error?,created_at,completed_at}；applied只证明配置已保存；连接结果由mt5_connect核验。

依赖入口：主会话，已有被宿主接收并脱敏的用户配置引用。

副作用：plugin.state.write

边界与恢复：引用限原会话/绑定账户；账户变更或引用失效不能凭猜测重建。敏感配置原文不读回工具参数。

## mt5_start_terminal
调用者：agent、host；仅主会话。按用户要求打开本插件已选的本机 MT5，适用于首次设置和再次打开终端。

输入：{command_id:<稳定16–128字符，只含字母数字下划线或连字符>}；完整例 {command_id:"open-selected-terminal-01"}。没有路径、账户、profile、INI 或密钥参数，不需要先读 catalog。

输出与状态：原生命令回执 {id,conversation_id,server:"launcher",tool:"start_terminal",operation_class:"trading",status,result,dataset_id:null,error,created_at,completed_at}。成功请求 status=returned、result={status:"spawned",pid,message,unit?} 只证明系统接收了启动请求；PID 不证明界面、MCP、券商或 Python IPC 已就绪。

依赖入口：已选定本机 MT5 安装；mt5_settings.environment 和 mt5_dependencies({action:"inspect"}) 可解释缺项。启动不需要 MCP 密钥或 Python。原终端 profile 可能恢复已有 EA，故沿用 launcher.start_terminal 的 allow_trading 启动权限；拒绝时不自动更改权限。

副作用：native-process-start、may-resume-existing-terminal-profile、plugin.state.write。

边界与恢复：保持原 portable/数据目录模式，不强制关闭或重启已有实例，不传新账户/profile，不执行 Sesame 保存的自定义 startup_ini。需要连接证明时调用 mt5_connect({command_id:"verify-started-terminal-01",start_if_needed:false})。缺凭据仍可先打开终端供用户配置 MCP。PREREQUISITE_REQUIRED 和 mt5_permission_denied 的 submission_attempted:false 表明未派发，按返回缺项或权限处理；原 returned/unknown 回执会复用，同一动作不换 ID 重放。unknown 先用 mt5_command({command_id:<原ID>}) 及实际进程/连接状态核对；配置变化后的 idempotency_conflict 也应先核对旧动作。

原生行为参考：[MetaTrader 5 官方平台启动文档](https://www.metatrader5.com/zh/terminal/help/start_advanced/start)。特定原生启动参数继续由 mt5_catalog 声明的 launcher 方法和 mt5_trade 路由处理。

## mt5_connect
调用者：agent、host。复用现有MT5配置，依次检查所选终端进程、MCP、券商和账户身份。

输入：{command_id:<稳定ID>,start_if_needed?:boolean}；例 {command_id:"connect-existing-01",start_if_needed:false} 只恢复/验证现有连接。

输出与状态：命令回执status=applied|failed，result:{server:"terminal",status:"connected"或不可用状态,code,reason,terminal_process?,mcp_connected?,broker_connected?,account?,settings_version?,started,steps}；terminal_process:{status,running,terminal_path,pids,checked_at}按完整路径匹配，running:null保留未知；connected需MCP和券商及账户一致。

依赖入口：主会话；mt5_settings/mt5_dependencies说明已有配置。只诊断传start_if_needed:false；允许启动时仅在确认所选终端未运行后按现有配置启动，不重复启动运行中或状态未知的终端。

副作用：native-connection、may-start-terminal、plugin.state.write

边界与恢复：MCP未连接先检查配置对应终端是否开启，不直接索取账户/密码/token，不循环重试；仅实际缺token或明确401处理MCP凭据。进程查询失败或不支持的平台保留unknown。保存配置不等于connected；connected不证明Python IPC。独立marketdata disabled不是券商行情故障；身份不符不自动切换账号；健康连接和正常交易不添加诊断步骤。

## mt5_report_data
调用者：agent、host。构建真实Tester报告的数据源与组件绑定。

输入：{backtest_ids:[<真实任务id>]}，1–32唯一ID。

输出与状态：{sources:[{id,sourceRef:{providerId:"sesame/mt5#datasets",revision},query:{datasetId},title,description,parameters_schema,row_schema,provenance}],component:{id:"backtest",type:"strategy_backtest",bindings}}；角色grid/optimization/passes/pass/trades。

依赖入口：任务均已终止且至少一个pass真正succeeded；来源查询/冻结经data-access，报告由reports能力发布。

副作用：plugin.state.write

边界与恢复：只建立基于真实Tester的报告数据，不直接发布/渲染报告；失败/取消任务不伪造最佳参数，equity采样和截断保留。

## mt5_trade_detail
调用者：agent、host。展开一个真实回测成交及可关联的原生轨迹。

输入：{trade_id:<mt5_report_data trades行中的id>}，形如pass_<UUID>_deal_<ticket>。

输出与状态：{origin:{mode:"backtest",backtest_id,pass_id,report_id,report_revision},trade,fills,engine,rule_graph,trace_status:"partial"|"unavailable",trace_reason,trace:{items,snapshot_sequence,truncated,time_basis}}。

依赖入口：已有真实Tester成交ID。

副作用：只读，无外部写入。

边界与恢复：只关联实际订单/成交票据；无埋点或券商自动退出不能推断策略决策。

## mt5_target
调用者：agent、host。发布当前MQL5目标能力说明及SDK参考。

输入：{}。

输出与状态：直接返回固定 ArtifactRef {id,revision,digest,kind:"strategy.target",schemaVersion:"1.0.0"}；资源manifest含modes、language、svl/execution、semantics、verification、resources和工具入口。

依赖入口：目标信息可通过宿主resources.read或已声明公开资源读取，无需运行终端。

副作用：resources.publish

边界与恢复：这是支持范围/限制声明，不是某次翻译的等价证据。

## mt5_translation
调用者：agent、host。登记Agent已编写的MQL5翻译和明确差异。

输入：{operation_id,title,source:<固定strategy.source>,target:<mt5_target固定Ref>,mode:"backtest"|"live",parameter_map,files,source_map,adaptations}；files映射真实相对路径到源码文本，如 {"Experts/Strategy.mq5":"<本任务编写源码>"}；source_map每项含源node与实际文件/行范围/instrumentation；parameter_map映射nativeInput或instrument/account绑定，adaptations列语义差异和已有证据。

输出与状态：{project_id,revision:1,source,translation:<strategy.translation Ref>,validation:<strategy.validation Ref>,implementation:"translated_unverified",limitations}；validation为partial，尚无原生语义证明。

依赖入口：SVL源由strategy-authoring公开能力发布；目标profile/SDK用mt5_target及target/README.md、sdk-integration.md、translation-file.md。

副作用：plugin.state.write、resources.publish

边界与恢复：只注册源码/映射，不生成源码、不编译、不运行交易；相同operation_id绑定同一输入，修改内容用新研究操作。

## mt5_translation_file
调用者：agent、host。从单文件冻结长翻译输入，避免重复传输长程序。

输入：{operation_id,manifest_path:"translation.json"}；工作区UTF8 JSON包含mt5_translation所有字段但去掉operation_id，files内嵌文本，不扫描目录/跟随JSON文件引用。

输出与状态：{project_id,revision:1,source,translation:<strategy.translation Ref>,validation:<strategy.validation Ref>,implementation:"translated_unverified",limitations}；validation为partial，尚无原生语义证明。 另有manifest:{digest,source:{sha256,...},reused,...}解释已固定输入。

依赖入口：同内联translation；长源码可用workspace能力写清单。输入规则和完整形状在公开target/translation-file.md。

副作用：workspace.read、plugin.state.write、resources.publish

边界与恢复：同ID/同路径复用首次固定字节，不重读已修改文件；验证失败后修内容用新ID。≤8MiB清单，项目≤4MiB/128文件，单源≤1MiB；不产生原生执行证明。

## mt5_dependencies
调用者：agent、host。读取或配置明确本机原生依赖。

输入：{action:"inspect",probe?:boolean}；probe:true检查编译依赖；configure:{action:"configure",command_id,expected_version,changes:{terminal_directory?,data_directory?,python?,wine?,wine_prefix?}}，路径可null清除。inspect不带配置字段，configure不带probe。

输出与状态：{version,settings,platform,private_directory,discovered,compiler:{available,checked,backend},python:{installed,sdk_verified:false,next},connections,missing:[{id,required_for,reason,configure?}],next,scripts}；configure保存后返回新依赖状态。

依赖入口：主会话；缺依赖时公开 skills/dependencies/SKILL.md 和 scripts/README.md 给出获取入口。

副作用：plugin.state.write-on-configure、process-on-probe

边界与恢复：发现文件≠SDK导入/券商已登录；无本机终端不影响已有远程MCP读取。只按实际missing处理，不将安装发现失败等同未安装。

## mt5_conformance
调用者：agent、host。准备或比较有界SVL与原生MT5执行证据。

输入：prepare:{action:"prepare",operation_id,source:<固定SVL>,fixture_path:<工作区JSON>,timeline_path?,header_path?,tolerances?}；verify:{action:"verify",operation_id,fixture:<prepare返回Ref>,translation:<固定翻译>,result:<真实Tester结果Ref>}，两个分支字段互斥。

输出与状态：prepare:{fixture,fixtureDigest,referenceDigest,events,status,validationScope:"reference-only",nativeEngineExecuted:false,bridgeConfiguration?,timelineDigest?,header_path?}；verify:{validation,outcome,validationScope,nativeEngineExecuted:true,generalEquivalence:"not_proven",differences,covered,uncovered,limitations}。

依赖入口：公开 target/conformance.md 说明夹具、时间线与容差；verify需要实际带埋点的Tester证据。

副作用：workspace.read、resources.publish、plugin.state.write

边界与恢复：prepare不执行MT5；verify只证明已覆盖夹具范围，不是普遍等价；uncovered/差异必须保留，不调大容差掩盖不匹配。

## mt5_trading_context
调用者：agent、host。提供公开执行组合所需的配置账户身份与全账户原生Python风险快照；首次失败即停止追加查询。

输入：{action:"identity"} 或 {action:"snapshot",history_days:7}（默认7天，整数1–90）。identity只读当前配置，无账户查询。

输出与状态：identity:{account:{accountId,server,revision}}；snapshot:{account,summary,positions,orders,fills,historicalOrders,deployments,historyCoverage:{requestedFrom,requestedTo,scope:"native_requested_range",complete:false,limitations},capturedAt}。summary和四个账户数组保留Python原生字段，时间范围是UTC毫秒；成功的空数组才表示本次未见记录。原生调用失败抛{code,message,details:{transport:"python",requiredTransport:"python",method,commandId,commandStatus?,nativeCode?,nativeMessage?,retryable?,recovery?}}；身份/连接/数据形状核验失败保留各自code和message。失败不返回部分或伪造空仓快照。

依赖入口：主会话或宿主证明的匹配工作流上下文；账户和配置revision来自identity/mt5_settings，不猜账号。identity不要求原生通道在线；snapshot需要同一已配置账户的Python IPC和券商连接。 mt5_settings说明已有配置；mt5_catalog({server:"python"})提供Python可用方法、参数及调用路由。mt5_connect核验的是Terminal MCP，不能作为Python已连接的证据。initialize/login沿用mt5_trade的现有权限，不是snapshot自动执行的恢复动作。

副作用：network、process、plugin.state.write

边界与恢复：snapshot先核验原生账户与连接，再读取全账户当前仓位、订单和请求范围内历史；每次读取核对配置revision，失败或取消立即停止，不按magic/comment隐藏全账户风险。Terminal MCP的字段和券商墙时不替代这里的Python/UTC契约。 确认原生last_error=[-10004,"No IPC connection"]时code=MT5_PYTHON_UNAVAILABLE，details保留nativeCode/nativeMessage、method和commandId，并给retryable:false。恢复条件是重新连接已配置的Python终端、核验同一账户后启动新工作流；环境未变时重复快照或仅重连Terminal MCP不会恢复Python IPC。其他错误保留实际code/原生证据，不一概判为不可重试。 historyCoverage.complete:false表示券商保留历史的请求范围不代表完整历史；失败不能当空仓，身份不符不能自动切换账号。

## mt5_trading_pause
调用者：agent、host。停止精确账户的一项受管理EA挂载。

输入：{deployment_id:<snapshot真实挂载id>,account:{accountId,server,revision},reason:<具体原因>}；示例reason:"用户要求停止此EA"。

输出与状态：{account,deployment,run_record,requestedAction:"pause",nativeAction:"remove_expert",status,reason,planId,runId,capturedAt,limitation}。

依赖入口：主会话明确停止指令或宿主已证明的工作流executor→执行能力→MT5调用链；Agent不生成authorization签名。

副作用：external-strategy-operation、plugin.state.write

边界与恢复：实际移除EA，不平仓、不保证保留运行状态/自动恢复；unknown核对部署回执，不冒称停止完成。

## mt5_trading_order
调用者：agent、host。执行宿主可证明来源的单次原生交易意图。

输入：{server:"python",tool:"order_send",arguments:<原生request与execution_guard或cancellation_guard>,command_id:<稳定16–128字符>}；request参数来自已声明TRADING.md和catalog；工作流执行guard.expected_positions包含该品种全部{ticket,type,volume}，空仓为[]。

输出与状态：{id,conversation_id,server,tool,operation_class,status,result,dataset_id,error,created_at,completed_at}；status=returned|failed|unknown（运行中可为running）。returned只说明收到响应，实际操作还要读result.isError/error/retcode或业务status；dataset_id是本插件保存证据。save_as时省略result并返回saved_to。

依赖入口：主会话明确用户交易意图；委派由portfolio/workflow公开入口建立宿主实时调用链，不能靠填写authorization或任务字段取得权限。

副作用：external-trading、plugin.state.write

边界与恢复：会发生真实交易；returned还须读retcode/真实订单成交。unknown用mt5_trading_command和原生订单核对，不能换ID重报。

## mt5_trading_command
调用者：agent、host。读取执行组合原生交易命令的保留回执。

输入：{command_id:<已保留计划命令ID>}。

输出与状态：{id,conversation_id,server,tool,operation_class,status,result,dataset_id,error,created_at,completed_at}；status=returned|failed|unknown（运行中可为running）。returned只说明收到响应，实际操作还要读result.isError/error/retcode或业务status；dataset_id是本插件保存证据。save_as时省略result并返回saved_to。

依赖入口：当前主拥有者、同login/server，或宿主匹配工作流；配置版本变化后仍可核对原记录。

副作用：只读，无外部写入。

边界与恢复：只读取，不发送、不自动补偿；未知结果保持未知直到原生证据确认。

## activate
调用者：host。执行MT5 activate 生命周期职责。

输入：{config:{disabled?,autoConnect?,directory?}}；例{config:{autoConnect:false}}。

输出与状态：{ready:true}；初始化私有存储、providers、观察器，默认可启动连接监视。

依赖入口：仅宿主生命周期调用；Agent无需按步骤调用这些钩子。

副作用：plugin.state.write、native-observation

边界与恢复：disabled/autoConnect:false可用于隔离；激活不证明券商可用。

## dispose
调用者：host。执行MT5 dispose 生命周期职责。

输入：{}。

输出与状态：{closed:true}；关闭监视器、数据provider、自有进程与存储。

依赖入口：仅宿主生命周期调用；Agent无需按步骤调用这些钩子。

副作用：plugin.session.close

边界与恢复：不是平仓操作。

## beforeAgentTurn
调用者：host。执行MT5 beforeAgentTurn 生命周期职责。

输入：{messageId,conversation,parts,source?,metadata?}。

输出与状态：{parts:<处理后消息部分>}；原生配置敏感内容转换为安全待导入引用。

依赖入口：仅宿主生命周期调用；Agent无需按步骤调用这些钩子。

副作用：plugin.state.write

边界与恢复：仅宿主入站钩子；Agent使用mt5_settings/pendingImports，不读取原密钥。

## beforeConfigChange
调用者：host。执行MT5 beforeConfigChange 生命周期职责。

输入：{}。

输出与状态：{}；Tester在途时抛mt5_busy。

依赖入口：仅宿主生命周期调用；Agent无需按步骤调用这些钩子。

副作用：只读，无外部写入。

边界与恢复：等待实际任务结束，不用改ID/关插件绕过。

## beforeDeactivate
调用者：host。执行MT5 beforeDeactivate 生命周期职责。

输入：{}。

输出与状态：{}；仍有preparing/attaching/running/unknown挂载时抛ACTIVE_RUNS。

依赖入口：仅宿主生命周期调用；Agent无需按步骤调用这些钩子。

副作用：只读，无外部写入。

边界与恢复：保留原生运行观察通道；不可将卸载当停止EA。

## configChanged
调用者：host。执行MT5 configChanged 生命周期职责。

输入：{}。

输出与状态：{}；通知连接监视器settingsChanged。

依赖入口：仅宿主生命周期调用；Agent无需按步骤调用这些钩子。

副作用：plugin.session.write

边界与恢复：不表示重连已成功。

## beforeRunRelease
调用者：host。执行MT5 beforeRunRelease 生命周期职责。

输入：{runId:<宿主运行ID>}。

输出与状态：{artifacts:[<封存成果Ref>],resources:[{id,path,digest,reason}]}；取消/等待自有编译Tester、封存证据、清理安全的任务暂存。

依赖入口：仅宿主生命周期调用；Agent无需按步骤调用这些钩子。

副作用：process.cancel、resources.publish、private-filesystem

边界与恢复：原生进程清理不确定则抛runtime_cleanup_failed并保留现场；不停止独立实盘挂载。

## market.bind
调用者：host。为宿主建立精确行情来源会话；不代表已取得报价。

输入：{binding:{}} 使用插件当前终端连接；也可带公开查询返回的精确 connection:{id:"mt5-terminal",revision:<当前配置版本字符串>}。不接受猜测的端口/登录身份。

输出与状态：{bindingId,connection,sourceIds,accounts,health,timeBasis}；MT5 broker 时间保留其 wall authority，未提供时区就不转换 UTC。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/mt5#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：plugin.session.write

边界与恢复：connection.id/revision 来自当前绑定或公开查询的 metadata.connection，不等于插件 source.revision。STALE_REVISION/CONNECTION_CHANGED 时重新取得当前身份；不能猜账号、版本或静默切换来源。

## market.unbind
调用者：host。释放宿主创建的行情绑定。

输入：{binding:<bind返回的含bindingId对象>}；例 {binding:{bindingId:"host-owned-id"}}。

输出与状态：{closed:true}；释放该绑定与其分页状态。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/mt5#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：plugin.session.write

边界与恢复：仅释放本次来源会话，不是平仓或停终端。

## market.searchInstruments
调用者：host。检索该明确来源的真实品种；返回 ref 是后续 instrument 的来源。

输入：{binding:<bind结果>,query:{query:"EURUSD",assetClasses?,venues?},page:{limit:20,cursor?}}；limit≤1000，cursor 仅沿用同一来源/过滤条件。

输出与状态：{items:[{ref:{sourceId,instrumentId},symbol,name,assetClass,venue?}],nextCursor?,metadata:{snapshotId?,consistency?,meta,connection?}}；空 items 仅是该次检索无匹配。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/mt5#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network

边界与恢复：connection.id/revision 来自当前绑定或公开查询的 metadata.connection，不等于插件 source.revision。STALE_REVISION/CONNECTION_CHANGED 时重新取得当前身份；不能猜账号、版本或静默切换来源。 历史缓存仅是历史；coverage 与时区不补猜。取消宿主订阅不停止EA/交易，也不关闭终端。

## market.describeInstrument
调用者：host。读取具体品种的价格/数量单位、时间基准和支持周期。

输入：{binding:<bind结果>,query:{instrument:{sourceId:<search返回的sourceId>,instrumentId:<券商精确symbol>}}}；实际 instrument 用 search 返回 ref。

输出与状态：{items:[{ref,symbol,name,assetClass,price,quantity,volume,timeBasis,calendar,features,native}],metadata:{meta,connection?}}；unknown/unsupported 字段保留，features 决定支持的 spec。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/mt5#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network

边界与恢复：历史缓存仅是历史；coverage 与时区不补猜。取消宿主订阅不停止EA/交易，也不关闭终端。

## market.queryBars
调用者：host。读取有界历史柱和真实覆盖证据，供宿主查询/冻结。

输入：{binding:<bind结果>,query:{instrument:<search.ref>,spec:<describe支持的spec>,range:{from:<SourceTime>,to:<SourceTime>},includeForming:false,direction:"forward"},page:{limit:100,cursor?}}。timeframe 使用 describeInstrument.features.timeframes 的值（如15m），priceBasis=bid、adjustment=none、session=all，calendarRevision:{status:"unknown"}。range 保留源 SourceTime，区间 [from,to)。

输出与状态：{items:[{id,revision,openTime,endTime,open,high,low,close,volume,isClosed,closure}],nextCursor?,metadata:{seriesId,instrument,spec,coverage,snapshotId,consistency,meta,connection?}}；OHLC 是十进制字符串，volume 自带单位/未知状态；无 nextCursor 只说明本次快照分页结束。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/mt5#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network

边界与恢复：coverage.complete:false 表示覆盖未获证明，可使用已返回的真实行并保留限制，不能改成 true 或当作空数据/请求失败。历史查询成功不证明实时订阅或图表渲染成功。 历史缓存仅是历史；coverage 与时区不补猜。取消宿主订阅不停止EA/交易，也不关闭终端。

## market.subscribeBars
调用者：host。为宿主持续提供初始行情快照及增量。

输入：{binding:<bind结果>,query:{instrument:<search.ref>,spec:<describe支持的spec>,tailLimit:100,includeForming:true}}；不传历史range或复用分页cursor，tailLimit正整数≤2000；恢复使用新快照。timeframe 使用 describeInstrument.features.timeframes 的值（如15m），priceBasis=bid、adjustment=none、session=all，calendarRevision:{status:"unknown"}。

输出与状态：{id,events:AsyncIterable,close}；首帧 {type:"snapshot",snapshot:{seriesId,instrument,spec,bars,coverage,meta?},position:{streamId,epoch,seq},consistency,recovery:"snapshot"}；后续 {streamId,epoch,seq,eventId,schemaVersion,observedAt,type,payload}，type 为 bars.upsert/bars.closed（按源能力）或 stream.gap。position/consistency/recovery 平铺在首帧，不嵌入 metadata。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/mt5#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network、plugin.session.write

边界与恢复：终端约1秒目标轮询；实时尾部读取失败会传播，不用旧缓存伪造实时。 订阅由宿主绑定、取消和释放，Agent 不持有 bindingId。stream.gap/RESYNC_REQUIRED 可按同一来源重新取得快照；具体 SCHEMA_MISMATCH 或首帧 position 缺失是协议问题，反复重绑、新建图或启用无关服务不能修复。 coverage.complete:false 表示覆盖未获证明，可使用已返回的真实行并保留限制，不能改成 true 或当作空数据/请求失败。历史查询成功不证明实时订阅或图表渲染成功。

## account.bind
调用者：host。为宿主建立精确账户数据绑定。

输入：{binding:{}} 使用插件当前终端连接；也可带公开查询返回的精确 connection:{id:"mt5-terminal",revision:<当前配置版本字符串>}。不接受猜测的端口/登录身份。

输出与状态：{bindingId,connection,sourceIds,accounts,health,timeBasis}；MT5 broker 时间保留其 wall authority，未提供时区就不转换 UTC。

依赖入口：宿主 sesame/mt5#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 mt5_trading_context，原生查询使用该包公开工具。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：plugin.session.write

边界与恢复：connection.id/revision 来自当前绑定或公开查询的 metadata.connection，不等于插件 source.revision。STALE_REVISION/CONNECTION_CHANGED 时重新取得当前身份；不能猜账号、版本或静默切换来源。

## account.unbind
调用者：host。释放账户查询/订阅绑定。

输入：{binding:<bind返回的含bindingId对象>}。

输出与状态：{closed:true}。

依赖入口：宿主 sesame/mt5#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 mt5_trading_context，原生查询使用该包公开工具。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：plugin.session.write

边界与恢复：不撤单、不平仓、不停止交易终端。

## account.listAccounts
调用者：host。读取绑定范围内的账户身份。

输入：{binding:<bind结果>,query:{},page:{limit:20,cursor?}}。

输出与状态：{items:[{ref:{connectionId,accountId},label?,currency,...}],nextCursor?,metadata:{snapshotId,consistency,meta,connection?}}；仅当前配置账户，不代表全机登录账户。

依赖入口：宿主 sesame/mt5#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 mt5_trading_context，原生查询使用该包公开工具。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network

边界与恢复：无账户或读取失败不等于空账户；实际账号身份沿用返回ref。

## account.snapshot
调用者：host。读取一个明确账户的资产快照。

输入：{binding:<bind结果>,query:{account:<listAccounts返回ref>}}。

输出与状态：{items:[<账户资产快照>],metadata:{meta,connection?,...}}；快照包含精确account、asOf/观察时间与各资产字段的value/unknown状态，不能把未知资金当0。

依赖入口：宿主 sesame/mt5#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 mt5_trading_context，原生查询使用该包公开工具。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network

边界与恢复：只证明当前快照；不是全部历史账本，也不改变交易权限。

## account.queryPositions
调用者：host。读取当前真实持仓的统一字段。

输入：{binding:<bind结果>,query:{account:<listAccounts.ref>,instruments?:[<search.ref>]},page:{limit:100,cursor?}}。

输出与状态：{items:[{id,revision,account,instrument,side,quantity,...}],nextCursor?,metadata:{snapshotId,consistency,meta,connection?}}；quantity保留单位，未知数量不归零。

依赖入口：宿主 sesame/mt5#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 mt5_trading_context，原生查询使用该包公开工具。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network

边界与恢复：持仓票据和策略归属按原生证据；不按magic/comment隐藏全账户风险。

## account.queryOrders
调用者：host。读取明确scope的活动/历史订单。

输入：{binding:<bind结果>,query:{account:<账户ref>,scope:"working"|"history"|"all",range?:{from:<SourceTime>,to:<SourceTime>},instruments?},page:{limit:100,cursor?}}；history/all需要明确历史范围。

输出与状态：{items:[<原生映射订单>],nextCursor?,metadata:{snapshotId,consistency,meta,coverage?}}；working活动订单与历史订单按scope区分。

依赖入口：宿主 sesame/mt5#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 mt5_trading_context，原生查询使用该包公开工具。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network

边界与恢复：coverage不证明全历史；来源时间保留券商authority。

## account.queryFills
调用者：host。读取有界原生成交。

输入：{binding:<bind结果>,query:{account:<账户ref>,range:{from:<SourceTime>,to:<SourceTime>},instruments?},page:{limit:100,cursor?}}。

输出与状态：{items:[统一成交记录],nextCursor?,metadata:{snapshotId,consistency,meta,coverage}}；从券商保留历史映射，不捏造缺失关系/字段。

依赖入口：宿主 sesame/mt5#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 mt5_trading_context，原生查询使用该包公开工具。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network

边界与恢复：只有请求范围内可见数据；分页完成不代表完整历史，保留coverage与unknown状态。

## account.queryHistory
调用者：host。读取有界账户历史事件。

输入：{binding:<bind结果>,query:{account:<账户ref>,range:{from:<SourceTime>,to:<SourceTime>},instruments?},page:{limit:100,cursor?}}。

输出与状态：{items:[账户历史事件记录],nextCursor?,metadata:{snapshotId,consistency,meta,coverage}}；从券商保留历史映射，不捏造缺失关系/字段。

依赖入口：宿主 sesame/mt5#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 mt5_trading_context，原生查询使用该包公开工具。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network

边界与恢复：只有请求范围内可见数据；分页完成不代表完整历史，保留coverage与unknown状态。

## account.subscribeAccount
调用者：host。向宿主提供账户观察快照与增量。

输入：{binding:<bind结果>,query:{account:<账户ref>,topics:["snapshot","positions","orders"]}}；可选非空子集，不支持fills/history订阅或resumeToken。

输出与状态：{id,events:AsyncIterable,close}；首帧 {type:"snapshot",snapshot:{account,coverage,snapshot?,positions?,orders?},position:{streamId,epoch,seq},consistency,recovery:"snapshot"}；后续 account.snapshot、positions.upsert、orders.upsert 或 stream.gap。position等字段平铺。

依赖入口：宿主 sesame/mt5#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 mt5_trading_context，原生查询使用该包公开工具。 mt5_settings 给出当前配置/连接；mt5_connect 用已有配置核验终端和券商。原生行情依赖 terminal，不依赖可选 marketdata 服务。

副作用：process、network、plugin.session.write

边界与恢复：订阅由宿主绑定、取消和释放，Agent 不持有 bindingId。stream.gap/RESYNC_REQUIRED 可按同一来源重新取得快照；具体 SCHEMA_MISMATCH 或首帧 position 缺失是协议问题，反复重绑、新建图或启用无关服务不能修复。 持仓/订单消失需新快照，不能仅凭upsert推断删除。约1秒轮询不等于交易所事件流。

## datasets.query
调用者：host。读取MT5私有已保存证据的公开数据出口。

输入：宿主 {binding:{},query:{datasetId?,parameters?},page:{limit:100,cursor?}}；省略datasetId列目录；ID来自mt5_report_data.sources或原生命令dataset_id，parameters按该source返回的参数名。

输出与状态：{items,nextCursor?,metadata?}；目录行无rows但有rowCount；指定datasetId返回原固定行与其metadata/provenance。

依赖入口：宿主 sesame/mt5#datasets 专用；Agent通过data_query({source,input:query})读取，source用公开data_providers返回ref。

副作用：只读，无外部写入。

边界与恢复：普通datasetId不等于host数据集；strategy角色过滤只接受原声明optimization_id/pass_id。 明确datasetId不存在时返回NOT_FOUND，不改为目录或空数据；使用mt5_report_data或无datasetId目录返回的真实ID。

## bars.query
调用者：host。向宿主提供MT5历史缓存行查询。

输入：宿主 {binding:{},query:{symbol,period,from,to,...},page:{limit:100,cursor?}}；query沿用mt5本地历史接口，来源时间是券商墙时。

输出与状态：{items:<历史bars>,nextCursor?,metadata:<缓存查询的来源/覆盖>}。

依赖入口：宿主 sesame/mt5#bars；Agent优先 market_read 统一市场接口，不自行组装私有来源。

副作用：cache.read、network-when-history-required

边界与恢复：不是实时订阅；分页使用返回cursor，不证明历史完整。

## runs.query
调用者：host。查询已保存的原生运行观察记录。

输入：宿主 {binding:{},query:{id?,status?},page:{limit:100,cursor?}}。

输出与状态：{items:[<native_run_record记录，含body.status和固定引用>],nextCursor?}。

依赖入口：宿主 sesame/mt5#runs；Agent观察具体任务用mt5_backtest/mt5_deployment公开工具。

副作用：只读，无外部写入。

边界与恢复：是原生运行观察记录，不是启动Agent，也不自动执行/停止原生程序。

## runs.watch
调用者：host。观察原生运行记录的已知变化。

输入：宿主 {binding:{},query:{id?,status?}}。

输出与状态：{id,events:AsyncIterable,close}；约1秒检查，变化时事件为{type:"snapshot",items,nextCursor?}，最多1000条；这是rows源快照，不是market/account的position流协议。

依赖入口：宿主 sesame/mt5#runs watch调用。

副作用：plugin.session.write

边界与恢复：关闭仅停止观察，不停止EA/Tester；原生记录未知状态不自动转成功。

## positions_close
调用者：host。执行账户页确认的手动平仓。

输入：{binding:{connection:{id,revision},account:{connectionId,accountId}},positionId,operationId,expected:{revision,instrument:{sourceId,instrumentId},side,quantity:{value,unit}},quantity?}；expected来自用户确认的账户页持仓，quantity省略表示确认数量。

输出与状态：{operationId,positionId,status,requestedQuantity,observedAt,filledQuantity?,remainingPositionQuantity?,orderIds?,dealIds?,error?}；status=closed|filled|partially_filled|submitted|rejected|outcome_unknown；closed确认持仓已全平，filled仅确认本次数量已完成。

依赖入口：仅宿主已确认的主会话账户UI可调用；普通Agent使用公开portfolio能力，不能自行伪造UI provenance。

副作用：external-trading、plugin.state.write

边界与恢复：提交真实减仓意图；同ID同输入仅取原回执，账户/数量变化会拒绝。 submitted/unknown不表示平仓完成；有未确认操作时先核对原回执，不能换ID重复。 对精确票据执行对应方向平仓，保留券商真实retcode与成交证据。

## positions_read_receipt
调用者：host。核对账户页平仓的已保留回执。

输入：{binding:{connection:{id,revision},account:{connectionId,accountId}},operationId:<已有平仓键>}。

输出与状态：{operationId,positionId,status,requestedQuantity,observedAt,filledQuantity?,remainingPositionQuantity?,orderIds?,dealIds?,error?}；status=closed|filled|partially_filled|submitted|rejected|outcome_unknown；closed确认持仓已全平，filled仅确认本次数量已完成。

依赖入口：仅宿主已确认的主会话账户UI可调用；普通Agent使用公开portfolio能力，不能自行伪造UI provenance。

副作用：network、plugin.state.write

边界与恢复：读取可刷新原生证据，不发补单。 submitted/unknown不表示平仓完成；有未确认操作时先核对原回执，不能换ID重复。 对精确票据执行对应方向平仓，保留券商真实retcode与成交证据。
