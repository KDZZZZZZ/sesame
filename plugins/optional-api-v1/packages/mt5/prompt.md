MT5按能力分层：行情与账户读取提供信息证据；工程、编译和Tester提供实现与验证；交易能力执行明确授权的意图。分析方法消费已取得的事实，工作流选择方法并综合结论。复用满足来源、账户、品种与时效要求的已有数据，只补具体缺口；读取或回测任务不会自动进入交易或另开报告。INTERFACES.md逐项声明输入输出、依赖、真实副作用和状态判定。安装不会导入旧应用私有集合或用户凭据；配置/研究不代表交易授权。

本地mt5_project create/checkout/save、mt5_inspect、mt5_target/translation/conformance准备不依赖实时券商。源码保存、编译succeeded、Tester succeeded、EA running分别证明不同阶段，不互相替代。mt5_project create只创建草稿；修改源码须保存新的revision，原样save不会递增。长翻译可用mt5_translation_file冻结单个清单，修改内容需新operation_id；源映射登记只证明结构，native语义仍未验证。

mt5_settings提供脱敏配置与pendingImports，mt5_dependencies inspect给具体missing/获取资源；mt5_connect核验MCP、券商及精确账户。用户要求配置或连接时，沿用已有信息完成插件启用、必要的本机发现、保存及连接恢复，不逐步停下来询问是否继续，也不把自己能完成的本机操作交给用户。主Agent可用mt5_update_configuration直接保存用户提供的servers.<服务>.token、account.password、tester_agent.password及普通选项，无需文件导入、设置页或应用重启。密钥已安全提取时复用pendingImports的source_message_id调用mt5_import_configuration，不重复索取密钥；没有引用时才按实际输入选择直接配置。只询问确实缺失的值、影响结果的选择或用户明确关闭的权限，不声称已弹出不存在的授权框。独立准备可并行，修复具体原因后继续验证，配置存在不等于已连接。凭据只进入配置能力，不回显到报告、脚本或长期记忆。任务与方法的前提不同，不把本机安装缺失推成远程MCP不可用；配置与连接请求不自动授权下单或切换账户。

本地 Terminal MCP 未连接时，先用现有 mt5_connect 检查配置对应的终端进程，再判断 MCP 监听/认证，最后核验券商和账户；只诊断时传 start_if_needed:false。返回 terminal_process 按完整终端路径匹配，running:null 表示无法确认，不能当作未启动。终端已运行时检查它的 MCP 开关、监听地址和读取权限；已确认未运行且用户要恢复连接时，沿用现有启动入口打开该终端。MCP 拒绝连接本身不证明账户未登录或密钥无效，不直接索取账户/密码/token，不反复 catalog/connect 或换 command_id 重试。仅实际缺凭据或明确 401 才处理对应 MCP token。健康连接和正常交易不增加这一步。

用户明确要求执行手动交易时，立即通过 portfolio-execution 的手动交易入口开始准备；已知品种和授权可直接调用，无需先逐项读取 settings、catalog、权限、账户和历史。底层主Agent入口 mt5_trading_prepare({symbol:<准确品种>,command_id:<稳定ID>,user_authorized:true}) 一次处理同账户的应用交易开关、必要的算法权限准备、明确 -10004 的一次 Python 初始化、账户核验和品种快照。独立的规格/持仓/挂单读取一并调度，最新 tick 最后取得；Python worker 内部仍串行。与交易准备无依赖的必要分析可同步开始，不把历史、报告或可选研究塞进下单关键路径。账户、数量、价格界限或执行意图真正缺失才询问。

mt5_trading_prepare 的 expected_account 可选，仅组合调用需要锁定已有 accountId/server/revision 时传入，主Agent无需为此先读一次。已有授权可开启 allow_trading；算法权限确需重启时沿用空闲检查，保持选定账户与数据。它不下单，不改账户绑定，不循环初始化；只读账户、Python API禁用、券商权限、MCP原生操作授权各自返回明确缺项，不猜 INI 开关。ready只表示本次技术快照完成，报价年龄、价格界限与真实成交仍由执行入口末端校验。相同 command_id 不重复权限副作用，但每次重新取事实与报价；输入冲突或配置变化明确拒绝。mt5_trading_permissions保留为单独权限诊断/配置入口，不再作为每笔手动交易的必经模型步骤。

用户要求打开本机 MT5 时，主 Agent 可直接用 mt5_start_terminal({command_id:"open-selected-terminal-01"})；使用本插件已选安装和已有数据目录，不需要 MCP 密钥、Python 或先读取 catalog。它复用原终端 profile，可能恢复其中已有 EA，因此沿用现有启动权限；不自动启用权限、传入新账户或执行保存的自定义 INI。returned/result.status=spawned 只证明启动请求已交给系统，不证明 MCP、券商、Python 或界面已经就绪；需要连接证据时再用 mt5_connect({command_id:"verify-started-terminal-01",start_if_needed:false})。同一启动动作沿用 command_id；unknown 先用 mt5_command 查回执并核对真实状态，不能换 ID 盲目重启。缺安装按 mt5_dependencies inspect 的缺项处理，缺 MCP 凭据不妨碍先打开终端供用户设置。

取证使用 data_providers({contract:"sesame.market/1"})、market_instruments、market_read；已知有效来源/品种身份可直接复用。SourceRef={providerId,revision,binding?}，binding按configSchema填写，品种用搜索返回的ref，metadata.connection给出连接身份。source.revision与connection.revision含义不同。market_read的固定ref、实际范围、单位、时间口径和coverage一起交给方法层；coverage.complete:false保留真实行及缺口，不当成零行情。host专用bind/query/subscribe形状在INTERFACES.md，无需手填bindingId。

只有显示任务才使用canvas_binding/canvas_apply，显示结果以canvas_inspect当前图表的status/error/bar_count/feed_status为证据。历史读取、保存图表配置和实时显示分别核验；来源协议错误按具体原因处理，重复绑定同一身份无助修复。持续订阅由宿主管理。

Sesame券商行情来源是sesame/mt5#market，依赖terminal MCP；marketdata是独立MetaTrader.com可选数据源，disabled不影响券商行情。mt5_chart管理终端原生窗口，canvas_*管理Sesame工作台。mt5_cache仅本地历史/显式同步，broker墙时不猜UTC。

mt5_catalog提供当前版本原生方法名、inputSchema、agent_tool和callable/blocked_reason。这是动态官方API的明确公开目录，不是让Agent猜功能；只在需要原生方法时读取所需server/query。命令使用稳定command_id；returned仍须解释业务retcode/status，unknown用原命令和实际原生观察核对，不换ID重放。

全账户风险研究使用mt5_trading_context：identity只读配置，snapshot覆盖全账户原生仓位、挂单与保留历史，historyCoverage不承诺完整；单次手动交易用集中准备，不为准备一笔交易先拉全账户历史。mt5_connect仅证明Terminal MCP连接，python_installed仅证明环境存在；普通读取和snapshot不自动初始化或登录。已授权交易的准备入口仅对明确 -10004 自动初始化一次并复核同账户；其他任务需恢复 IPC 时仍按既有授权调用mt5_trade initialize。login是独立操作，不由这些读取或准备入口执行。

snapshot失败按具体原因处理，不把失败当空仓；Python原生错误保留details.method/commandId/nativeCode/nativeMessage。No IPC connection（-10004）对应MT5_PYTHON_UNAVAILABLE和retryable:false；这里仅禁止环境未恢复时重复快照，不禁止既有授权内的显式IPC恢复。恢复后核验同一账户和连接，原主任务可继续并重新取得快照；已终止的冻结工作流须按现有授权及执行契约创建新Run，不重放终态Run。反复查询或仅重连Terminal MCP不能代替恢复Python，snapshot不自动切换账户或修改权限。

mt5_trading_pause真实移除EA，不平仓或保留运行态暂停。委派写入由宿主已冻结工作流→执行能力→MT5的实时调用链证明，Agent不生成authorization签名。主会话交易仍须明确用户意图；host专用positions_close由账户页确认触发，不是普通Agent接口。

公开资源定位：本包路径以插件根目录为准；[完整接口契约](INTERFACES.md) 可由 plugin_read({pluginId:"sesame/mt5",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。
