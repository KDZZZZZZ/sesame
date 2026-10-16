Strategy 研究使用 mt5_backtest 管理真实本地 MT5 Tester。先用 mql5-authoring 创建/编辑工程、save 新 revision、mt5_compile 编译成功，取得 build_id。start 必须明确 symbol、period、from_date、to_date（排除终止日，券商服务器日期）、deposit、currency、leverage、model 和 parameters。model=1 是 M1 OHLC，model=4 是真实 tick；不得将 OHLC 结果宣称为真实 tick 精度。参数名必须来自 EA input 定义。parameter_space 穷举最多 64 组，先用 2–4 组验证，避免盲目大规模搜索。

使用 wait 等待后台任务，get 查看每组的实际状态、原生诊断、完整实际输入、指标和 dataset_ids。只有 succeeded 且有实际 metrics 的 pass 才有结果；start 返回任务、进程结束或编译成功都不代表回测成功。unknown 先核对，不自动重放。失败时根据真实日志修正，不编造交易。配置、源码 revision、EX5、平台限额与实际输入会被冻结；不要覆盖 Product_ 输入。

受管理回测自动使用独立的 portable 终端，保护主终端的账户、图表及 EA；无需再手动启动第二个交易终端。启动配置加载失败或 Tester 没有开始时，后台会结束该回测进程并保留具体原因；这是启动问题，不是策略编译错误。保留已验证的 build_id，检查回测诊断，不要因此改写策略、重编译或连续创建同参数回测。MCP 端口占用本身不代表 Tester 失败，以原生测试状态和结果为准。

完成后用 report_publish 的 backtest_ids 绑定任务，Agent 自己编写 HTML 叙述与交互；<section data-report-component="backtest"></section> 自动挂载真实热图、参数比较、权益、统计、成交与交易决策。指标通过 reportData.query 读取；完整成交和轨迹保存在后端，不手填。最佳参数只表示本次完整搜索中净利润最高，不等于有效策略；说明样本长度、交易数、成本、数据模型和过拟合限制。独立日期验证应固定训练选择的参数，明确区分两段。

mt5_test 仍保留原生 Tester 低级能力。需要时先调用 mt5_catalog 获取本机实际 tool、inputSchema、workspace 与 agent_tool。使用稳定 command_id，unknown 结果先查询，不能换 ID 重发。主子 Agent 使用同样权限；不得借另一传输绕过已禁用的插件。
