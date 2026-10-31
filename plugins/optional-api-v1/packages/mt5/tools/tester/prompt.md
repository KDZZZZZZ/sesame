mt5_backtest是计算验证能力：消费已编译策略和明确测试条件，交付真实本地MT5 Tester证据。工作流决定研究问题、数据区间、候选和比较方式。可复用已有成功构建；需要改策略时，SVL由svl-mql5声明的翻译能力处理，独立原生工程用mt5_project checkout/save，mt5_compile绑定明确revision返回build_id。start须明确symbol、period、from_date、to_date（排除终止日，券商服务器日期）、deposit、currency、leverage、model和parameters。model=1为M1 OHLC，model=4为真实tick，不能混称精度。参数来自EA input定义；parameter_space每次最多64组，范围应服务于待检验假设，不把遍历本身当研究成果。

真实Tester依赖精确账户绑定及password_configured；可复用已有有效设置证据，缺少时用mt5_settings核验。已登录主终端不代表独立Tester已有凭据。主Agent可直接用mt5_update_configuration保存用户已提供的密码，已有引用也可按connection skill复用导入；子Agent只交回具体缺项。配置生效后继续原任务，不靠重复编译或重启处理凭据缺口。

使用 wait 等待后台任务，get 查看每组的实际状态、原生诊断、完整实际输入、指标和 dataset_ids。只有 succeeded 且有实际 metrics 的 pass 才有结果；start 返回任务、进程结束或编译成功都不代表回测成功。unknown 先核对，不自动重放。失败时根据真实日志修正，不编造交易。配置、源码 revision、EX5、平台限额与实际输入会被冻结；不要覆盖 Product_ 输入。

向工作流交接实际输入、metrics、诊断和结果引用。mt5_report_data返回真实sourceRef/query，可用data_snapshot({source:sourceRef,input:query,operationId,title})冻结所需DataRef；已有结果ref直接复用。回测不单独触发报告，只有任务需要展示成果时才使用reports能力；related用真实artifact或pass.run_record的{id,version}，旧原生工程run_record为null。完整成交/轨迹来自后端，不手填。最佳参数仅表示本次搜索的排名；比较时保留样本长度、交易数、成本、数据模型与选择次数，独立日期验证使用已固定参数。

mt5_test保留原生Tester低级能力；需要该能力且缺少当前声明时，用mt5_catalog获取实际tool、inputSchema、workspace与agent_tool，已有有效声明直接复用。使用稳定command_id，unknown结果先核对，不能换ID重发或绕过已禁用的能力。
