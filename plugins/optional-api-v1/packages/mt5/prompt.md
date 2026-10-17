MT5公开能力分为本地工程/目标翻译、实际终端/Tester/交易、宿主数据源。INTERFACES.md逐项列出输入输出、依赖、示例、真实副作用和状态判定；不需要反向工程本体或安装包。安装不会导入旧应用私有集合或用户凭据；配置/研究不代表交易授权。

本地mt5_project create/checkout/save、mt5_inspect、mt5_target/translation/conformance准备不依赖实时券商。源码保存、编译succeeded、Tester succeeded、EA running分别证明不同阶段，不互相替代。mt5_project create只创建草稿；修改源码须保存新的revision，原样save不会递增。长翻译可用mt5_translation_file冻结单个清单，修改内容需新operation_id；源映射登记只证明结构，native语义仍未验证。

mt5_settings提供脱敏配置与pendingImports，mt5_dependencies inspect给具体missing/获取资源；mt5_connect核验MCP、券商及精确账户。主Agent可用mt5_update_configuration直接保存用户提供的servers.<服务>.token、account.password、tester_agent.password及普通选项，立即生效，无需导入文件、设置页或重启。已有pendingImports可选用mt5_import_configuration复用，不作为直接配置的前提。用户已给的信息和授权继续有效，完成设置并核验，不再要求重复提供、改格式或授权；只询问任务实际缺少的值。凭据只进入配置能力，不回显到报告、脚本或长期记忆。任务与方法的前提不同，不把本机安装缺失推成远程MCP不可用，也不把配置存在当已连接。

用户要求打开本机 MT5 时，主 Agent 可直接用 mt5_start_terminal({command_id:"open-selected-terminal-01"})；使用本插件已选安装和已有数据目录，不需要 MCP 密钥、Python 或先读取 catalog。它复用原终端 profile，可能恢复其中已有 EA，因此沿用现有启动权限；不自动启用权限、传入新账户或执行保存的自定义 INI。returned/result.status=spawned 只证明启动请求已交给系统，不证明 MCP、券商、Python 或界面已经就绪；需要连接证据时再用 mt5_connect({command_id:"verify-started-terminal-01",start_if_needed:false})。同一启动动作沿用 command_id；unknown 先用 mt5_command 查回执并核对真实状态，不能换 ID 盲目重启。缺安装按 mt5_dependencies inspect 的缺项处理，缺 MCP 凭据不妨碍先打开终端供用户设置。

行情与画布的公开入口是 data_providers({contract:"sesame.market/1"})、market_instruments、market_read、canvas_binding/canvas_apply。来源采用发现返回的完整 {providerId,revision}，可按 configSchema 附 binding；品种采用搜索结果 ref，连接身份来自 metadata.connection。source.revision 是插件声明摘要，connection.revision 是来源配置身份，两者不可互换。host 专用 bind/query/subscribe 的完整形状在本包 INTERFACES.md，Agent 无需持有 bindingId。

market_read 返回固定数据、rowCount 和覆盖证据。coverage.complete:false 保留已取得的真实行，同时说明范围尚未获完整证明；不能改写为true。历史成功不证明实时订阅成功；canvas_apply 保存配置不证明用户已看到图。canvas_inspect 的当前版本 rendering[].charts[] 提供 status/error/bar_count/feed_status；无当前回执只表示未确认。明确源协议错误（如首帧position缺失）不能通过重复绑定/新建探针图修复；连接或声明版本已变才有刷新身份的依据。宿主管理持续订阅，退出Agent调用不应把已配置图表断开。

Sesame券商行情来源是sesame/mt5#market，依赖terminal MCP；marketdata是独立MetaTrader.com可选数据源，disabled不影响券商行情。mt5_chart管理终端原生窗口，canvas_*管理Sesame工作台。mt5_cache仅本地历史/显式同步，broker墙时不猜UTC。

mt5_catalog提供当前版本原生方法名、inputSchema、agent_tool和callable/blocked_reason。这是动态官方API的明确公开目录，不是让Agent猜功能；只在需要原生方法时读取所需server/query。命令使用稳定command_id；returned仍须解释业务retcode/status，unknown用原命令和实际原生观察核对，不换ID重放。

账户/执行组合使用公开portfolio入口或mt5_trading_context；identity只读配置，snapshot依赖同一账户的Python IPC，覆盖全账户而非仅某magic/comment，historyCoverage保留不完整。mt5_connect的connected只证明Terminal MCP连接，不建立Python IPC；python_installed也只证明环境文件存在。snapshot首次失败即停止追加查询，不把失败当空仓；Python原生错误保留details.method/commandId/nativeCode/nativeMessage。确认No IPC connection（-10004）时返回MT5_PYTHON_UNAVAILABLE和retryable:false，只有已配置Python终端恢复、同一账户核验通过后新工作流才具备重试条件；反复查询或重连Terminal MCP不能代替恢复Python。Python可用方法和路由由mt5_catalog({server:"python"})声明，initialize/login沿用mt5_trade权限，snapshot不自动登录或切换账户。

mt5_trading_pause真实移除EA，不平仓或保留运行态暂停。委派写入由宿主已冻结工作流→执行能力→MT5的实时调用链证明，Agent不生成authorization签名。主会话交易仍须明确用户意图；host专用positions_close由账户页确认触发，不是普通Agent接口。

公开资源定位：本包路径以插件根目录为准；[完整接口契约](INTERFACES.md) 可由 plugin_read({pluginId:"sesame/mt5",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。
