# 可选原生策略验证

`config.strategyValidation` 仍是平台、数据、成本和成交差异的声明。只有显式 `config.nativeValidation` 才安排实际原生调用。未配置、缺引擎、缺环境或原生优化接口未绑定时，因子研究照常完成，并保留未验证状态。引擎按用户明确选择、预期交易平台原生、相同数据/合约、说明差异的替代方案依次考虑；工作流不会暗中换引擎。

本版支持已声明 Backtrader、vnpy 单次回测，Backtrader 的真实 `Cerebro.optstrategy`，以及 MT5 已声明的 `mt5_backtest` 固定构建回测。Backtrader 原生优化最多 64 个组合、总计 200000 pass-bars、单个受控进程；每个确认结果、异常和未完成组均保留。`search.mode:'auto'` 优先调用已声明原生 optimizer。vnpy 目前没有已声明 optimizer。MT5 在实际 `mt5_catalog` 查得 `tester_run_optimization` 时，可用下述精确 schema/参数绑定实际调用；不猜本机版本的方法参数，不把宿主管理的 ≤64 网格叫原生优化。

输入示例（所有 ref 必须由真实固定数据操作返回，省略号不是合法引用）：

```js
config.nativeValidation = {
  engine: 'backtrader',
  reason: '用户指定此引擎；固定股票现金策略，与计划的平台和成本假设一致',
  strategy: { path: 'strategy.py', className: 'RoundTrip' },
  development: { data: developmentRef, start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' },
  holdout: { data: holdoutRef, start: '2025-02-01T00:00:00Z', end: '2025-03-01T00:00:00Z' },
  config: { capital: '10000', commission: '0.001', slippage: '0', feed: { timeframe: 'days', compression: 1 } },
  parameters: {},
  search: { mode: 'auto', parameterSpace: { exit_bar: [3, 5, 7] }, objective: { metric: 'finalEquity', direction: 'max' } },
  environment: { pythonPath: '/explicit/existing/python' },
  timeout: 120
};
```

不搜索时用 `search:{mode:'none'}`（默认），保留固定 parameters。Agent 有特殊假设时可选 `mode:'groups'`，提供 `groups:[{id,hypothesis,parameters}]` 与同样 objective；这调用真实引擎逐个实测，不另造优化器。每个失败组均保留；原生优化器未完成整个计划时不从成功前缀选优。目标是实际统计中的数值字段，方向为 max/min，同值选预先固定输入顺序第一组。没有该目标值就停止选参，不根据结果临时换目标。

策略源码在 start 时从当前受控工作区读取，固定内容、摘要和输入版本；随后修改原文件不会改变本次策略。原生代码必须预先由任务作者编写，不能把它自动视为因子 AST 的等价翻译或所选因子的完整实现。报告保留这种原生策略与因子研究的关联边界，方法本身仍由任务决定。

Python 数据为固定 json-rows OHLCV，时间明确 UTC/offset；每根柱必须严格递增，全部落在所声明左闭右开 `[start,end)`，开发与留出不能重叠。时间列可用 `columns.datetime` 指定，不对未知时间做转换，不填缺失值。输入不隐式裁剪；vnpy 原生 end 为 inclusive，适配器传窗口内最后一根实际 bar 的时间，避免把右端点混入。成本、合约、日历、时段、粒度和成交规则来自明确引擎 config/strategyValidation，收益不能脱离它们解读。

vnpy 需要 `CtaTemplate.load_bar(...)` 预热时，在每个窗口声明可选 `tradingStart`，例如 `development:{data:developmentRef,start:'2025-01-01T00:00:00Z',tradingStart:'2025-01-03T00:00:00Z',end:'2025-02-01T00:00:00Z'}`。它必须是该窗口 `[start,end)` 内的 UTC/offset 时间；`start` 仍限制全部输入，`[start,tradingStart)` 的固定柱仅供预热，`[tradingStart,end)` 至少包含两根实际交易柱，只有此段进入原生交易和收益统计。所有参数组使用同一冻结起点，留出使用自身窗口内的前缀，不能借预热扩大输入边界或重叠开发数据。省略时保留从首根输入柱交易的行为，没有自动补入预热。原生引擎仍检查策略请求的预热天数是否完整覆盖，缺数据如实失败；不读取外部历史、不伪造或重复柱。回执 `windows` 保留全部输入范围及实际首末柱、行数，并分别记录 `warmup` 可用输入和 `trading` 区间；`warmup` 不代表策略实际消费了所有前缀柱。`config.start/end` 仍不允许覆盖这些冻结边界，其他引擎不接受 `tradingStart`。

MT5 用 `strategy:{buildId:<实际编译成功的冻结build>}`，development/holdout 改为 `{start:'YYYY-MM-DD',end:'YYYY-MM-DD',authority:'实际broker墙钟依据'}`；config 使用 mt5_backtest 的 symbol/period/deposit/currency/leverage/model 字段，不再放 from_date/to_date/parameters。MT5 使用其原生行情库，故不能提供一个并未被 Tester 消费的 DataRef 冒充固定行情绑定；日期范围和构建/连接/原生成交回执保留，PIT 行情快照保障明确不提供。工作流不读取或导入凭据，也不连接/控制实盘交易。

MT5 原生 optimizer 的 `search` 使用 `{mode:'auto',nativeOptimizer,objective?}`，不再传第二份 parameterSpace。`nativeOptimizer` 必须含实际 catalog 的 `inputSchema` 和精确 `arguments`；工作流每次执行/恢复重新对照本机公布 schema，只调用 `mt5_test` 的 `server:'terminal',tool:'tester_run_optimization'`。这是唯一允许启动的透明原生优化方法，不开放任意 native 工具名。schema 和原始参数摘要随回执保存。

- 若实际参数直接包含日期，`windowBinding:{startPointer,endPointer}` 用 JSON pointer 指向参数中与 development.start/end 完全一致的字段。
- 若本机方法消费 `.ini`，`preparedConfiguration:{argumentPointer,workspacePath,authority,source}` 指向一份当前工作区内已编写的 Tester-only UTF-8 配置（≤128 KiB），不允许账户/认证字段。启动时固定内容；检查 `[Tester] FromDate/ToDate` 与开发日期一致、Optimization 为 1 或 2、ForwardMode 缺省或 0；执行时将同一内容写入受控工作区并绑定该实际路径。不能假定 macOS 路径等价于 Wine/Windows 路径，服务无法消费该路径则如实失败。
- 远端/native 文件无法本地固定时，可显式 `preparedConfiguration:{argumentPointer,authority,source,acknowledgeUnverified:true}` 请求实际调用。它保持 `windowVerification:'unverified'`；即使有数值结果也不自动选参，不运行 holdout，不声称开发隔离已验证。
- 可选 `result:{rootPointer?,textJSON?,complete:{pointer,equals},passesPointer,parametersPointer,statisticsPointer,passComplete?:{pointer,equals}}` 只从原生 `command.result` 解析实际输出。rootPointer 可指向 MCP 的 structuredContent 或某项 text；textJSON=true 才解析该字符串。明确业务完成标志和真正的 passes 才可按预先 objective 选参，绝不能把 command.status=returned 当优化已完成。没有 parser、没有完成结果或结果不可解析时原始回执保留，选参/holdout 为 not-run；若原生调用只启动后台 job，需用实际平台观察能力继续核实，本适配器不猜 job 参数或冒称取消已完成。

MT5 自动 holdout 还要求优化策略身份绑定同一 build：直接参数可用 `buildPointer` 指向精确 build ID 或以该 build ID 命名的 `.ex5`；受控 INI 检查 Expert。未绑定时可以保留开发期实测和冻结参数，holdout 则 not-run，不把另一 EA 的测试拼接进来。这是配置身份对应，不是外部原生进程的源码/文件访问沙箱。没有真实 MT5 服务器时测试只验证适配 dispatch/恢复协议，不声称跑过 MT5。

顺序固定：单 Agent 六阶段或多 Agent 完成选择并结束 → evaluator 最终评价 → 可选原生开发验证/优化 → 根据预先目标固定参数及 evidence digest → 单独原生 holdout → Strategy 报告。研究角色看不到 native 输入引用或源码，也没有这些原生执行工具；留出不回流本轮选型。因子 evaluator 的 sealed 状态只适用于该因子计算链；本机 Python/MT5 不是 OS 沙箱，作者代码有当前用户权限，窗口检查不能保证任意代码不读其它文件。原生结果不得冒称同样的 sealed 证明。

每次 dispatch 前保存稳定 operation ID 和原始输入摘要。中断/unknown 恢复先读 `backtrader_operation`、`vnpy_operation`、`mt5_backtest_operation`，透明原生优化则读 `mt5_command` 的同一收据；即使没有提交记录，也不据此判断未执行、更不会换 ID 重发。已确认结果直接复用；MT5 managed backtest 有确定 job ID 才 wait/stop。失败、缺配置、取消和未知状态写入报告，不能从缺失结果推造收益或概率。整个 native plan、factor selection、已冻结参数/目标和开发回执摘要在复用前核对；原始回执超过 8 MiB 则保留原操作 ID，停止自动解释。

因子检验计划由 Agent 按任务设置，用户明确要求必须覆盖；`evaluator.arguments.evaluationPlan` 原样交所选 evaluator。诊断与 Agent 阈值默认 advisory，只有 evaluator 认定的用户 hard requirements 才淘汰。`review.verdict:'conditional'` 配合 `applicability` 的 valid_when、invalid_when、evidence、limitations、monitor、stop_when 字符串列表；已有 counterexamples 也保留。条件使用仍须真实可测证据，不能绕过用户硬要求。selection 可以保留同样条件；原始 thresholdResults、搜索 diagnostics、evaluations 和失败试验写入报告。协议回执上限：candidate 64 KiB，select 512 KiB，prepare/finalize 5 MiB。

可选历史研究组合：`research.plugins:['sesame/historical-evidence']` 且只选择其已声明 `historical_evidence_match` / `historical_evidence_calibrate`，使用实际开发数据生成 inline 输入；这两个 input-only 纯计算能力不解引用来源标签，可与受限研究共用。`historical_evidence_from_ref` 读取固定 ref，属于通用数据访问，须 development-only。它们不默认加入，不强行规定特征/阈值，也不能把过往频率自动解释为预测概率。calibrate 的 plan.mode 区分真实事先冻结的 prospective 与今天在旧日志上选择方法的 exploratory；后者不得输出可部署的当前校准概率。

工作流声明 `process.execute` 才能通过宿主对完整调用链的权限检查；这项本机能力不加入任何研究 Agent 的 allowedCalls。未获实际权限时保存 unavailable/失败事实，不绕过宿主授权。

原生接口依据：[Backtrader Cerebro](https://www.backtrader.com/docu/cerebro/)、[Optimization Improvements](https://www.backtrader.com/docu/optimization-improvements/) 与 [MetaTrader 官方 MCP 能力](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/capabilities)。这只是接口来源，不是研究策略有效性的证据。
