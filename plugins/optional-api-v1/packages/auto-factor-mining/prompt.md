# 因子与策略研究 · Strategy

因子报告正文默认复用应用现有的 Netron 风格 SVL 渲染展示逻辑图，让读者看清数据怎样形成信号，以及本次已经定义的适用、买卖、仓位、退出和停用条件。当前 Report 的 signal-study 会从真实候选表达式生成计算图；按其实际接口，用 `presentation.logic[trialId]` 或通用 `logic` 内容块补充既有规则。只有因子计算时画到信号，不能为了画完整策略而补造交易条件。用户可调整图的内容或删去它；具体研究方法仍按任务自由选择。

已形成真实 SVL 策略时，用 `strategy_source` 保留同源规则，正文先展示“事件 → 条件 → 动作 → 下一步”的交易逻辑；点击“看计算”，由源码自动把计算原语、变量和参数展开成嵌套树，不另写树或 HTML。报告组件直接读取源码分支与顺序，不能把两次独立检查画成二选一，也不把未使用的参数描述为已实现规则。

编写 SVL 时按 strategy-authoring 的 `comments` 规范，为主要计算与变量提供短名称和必要说明，供计算树自动读取；说明不替代真实计算，也不宣称尚未完成的验证。

本包已融合因子与策略研究知识。使用 auto_factor_start，config.executionMode 可选 single 或 multi，省略保持原多 Agent 模式。single 实际只启动一个 Agent Run，顺序承担全部六阶段；必须用 context 返回的 step_id 逐步提交，直到 complete:true 才结束。真实 evaluator、冻结选择、开发/留出隔离和原生归档仍保留。单模式不能省略评审/反思或并行分支，模型只为其唯一成员选择。

研究前先明确用户要Agent判断什么、从哪些角度判断。在现有需求交接与plan.reason中形成精简判断任务单：用户决策/待回答问题、对象期限、比较对象、用户指定角度、Agent补充角度（分开）、何种证据会改变判断。信息足够就说明合理假设推进，不重复询问；用户裁剪优先，不新增强制API字段。以判断组织取证、假设和实测，保留知识依据、适用历史参照与关键改判条件。交付开头直接给总体结论，下面让已有分析与图表支撑各项必要判断；已有清晰结论和风格保持，只补缺项。共同对象与期限可沿用，不逐项填满整套栏目，不重复摘要、卡片和图注。单人与团队复用同一任务单，具体阶段规则见共同研究指南。

检验计划由任务决定并覆盖用户明确要求；diagnostics和Agent阈值默认advisory，只有evaluator.arguments.evaluationPlan.thresholds中用户明确要求的source:"user"且mode:"required"条目可作为淘汰条件。有真实子情景证据可conditional使用，applicability保留适用/失效、证据、局限、监控/停用和反例；不能绕过用户硬要求。selection完整保留evaluator的搜索diagnostics/evaluations，不把所有测试都通过当唯一合格标准。

显式config.nativeValidation可实际执行冻结源码/构建的Backtrader、vnpy或MT5回测。先按用户选择和预期交易平台选引擎；所选引擎有原生优化器则优先，Backtrader使用真实optstrategy，MT5仅对当前catalog公布的tester_run_optimization做精确schema和参数绑定，不把MT5宿主管理网格称为原生优化。缺少已声明接口或必要绑定时保留unavailable；无法核验原生配置窗口或完整pass时保留实际回执，但不自动选参或运行holdout。开发搜索按预先目标选参并持久化，再运行独立holdout；未知先读同op收据，不重发。研究Agent全部结束且因子选择/最终评价完成后才运行，本机原生代码不继承因子sealed保证。具体schema见已声明references/native-validation.md。未配置原生验证不阻断因子研究。

vnpy窗口的start/end固定全部输入边界；需要预热时在该窗口内声明tradingStart，之前的固定柱只用于初始化，从tradingStart起的柱才进入原生交易与收益统计。预热长度由已编写策略的load_bar请求决定，不统一指定；数据不足如实失败。开发和留出各自声明输入与交易起点，全部输入仍不得重叠，不能用config.start/end绕过冻结边界。

核心融合指南自动进入研究成员指令，完整方法、公开 references 与可选 CLI 都已声明在本包 knowledge。CLI 不是注册能力，不替代或重复真实 evaluator。因子研究交付 Strategy，市场/公司投资研究交付 Research。

策略真实回测优先用户指定引擎，其次预期交易平台原生，再次相同数据/合约，必要替代时记录差异；例如预期 MT5 交易优先其原生 Tester，不强制每次因子统计运行 Tester。优先引擎自带 optimizer；有明确假设的特殊参数组可定制并记录全部搜索及失败。开发选优、固定选择和独立验证分离。config.strategyValidation 可保存平台/引擎/来源/合约/日历时段/点差佣金swap/成交规则/粒度及后续请求，属于待执行意图；当前因子 evaluator 不能伪称完整策略回测，缺引擎则保留未完成边界，不自动下单。

本工作流适合寻找或改进因子、生成多个候选信号、比较因子组合并多轮筛选，也可承担策略研究中的行情状态特征、入场评分等候选搜索阶段。输出试验账本、真实评价回执与阶段报告。明确最大努力、最大功率等因子研究要求时，发现并加载本包，核对评估实现后实际启动；轻量解释一个因子、计算已知指标或快速比较思路，可直接使用相关知识或计算能力。

本工作流不限制研究的品种数量，数据形状与评价目标由所选 evaluator 决定。内置 sesame/factor-evaluator 可按 dataset.mode 选择 auto、cross-sectional 或 time-series；auto 对单品种采用时序评价，对多品种采用横截面评价。时序因子相关性和方向收益诊断不等于逐笔交易胜率、盈亏比或真实成交回测，具体进出场验证使用适合的回测能力。分别推进数据获取和评价能力查找，不为迁就某个实现扩展品种或更换账户；某个测试不适用或无法运行时，继续其他适用测试与研究阶段。

评估按问题选择，不把所有诊断变成必做清单。内置 evaluator 的 arguments.diagnostics 可选择安慰剂、蒙特卡洛、样本外、walk-forward、参数敏感性、市场状态分层和 bootstrap 置信区间等项目；读取声明确定配置和适用条件。保留每项实际状态、结果或未执行原因，区分未测、失败与有证据的否定。可选诊断缺失不自动否决候选或中断工作流；采用哪些入选门槛由本次评价目标和显式配置决定，仍须有真实基础测量，不能把全部未测说成通过。

公开 auto_factor_start 是带 start:workflow 效果的 function，只按 kind=workflow 过滤会漏掉它。读取或加载插件不等于启动；以返回的 workflow Run 引用及实际状态为准，普通 subagent 并行也不等于本工作流。新工作流在 Strategy 交付阶段报告，已有任务恢复时沿用原输出位置。

本包是研究工作流层：组织假设、实现、评审、复盘与固定选择。信息获取由来源插件负责，单项解释或计算由分析方法负责，数值评价由独立 evaluator 负责；本包复用这些产物，保留共同数据、试验账本和实际回执。

用户可通过 config.workflow 显式指定 plan/hypothesis/code/review/reflection/selection 对应的 {id,title?,instructions?}；同一 id 可负责多项。字段省略保留默认；plan/review/reflection 可为 null 以省略这项 Agent 工作。省略 plan 使用配置的 directions，省略 review 仍按真实 evaluator.eligible 接纳，省略 reflection 不产生虚构复盘。假设、实现、固定选择和真实评价/留出隔离不可跳过。agentModels 可按实际 id 指定。计划冻结到原 Run，自定义流程的协作图和报告反映真实参与者；需要改计划则创建新的研究。

从声明选择 evaluator:{plugin_id,tool,arguments?} 和 research:{plugins,tools?}。主动按研究机制发现并读取技术知识，再把选中的知识包与需要的数据/计算插件一起放入 config.research.plugins；不要只传 evaluator 就把理论和方法留在主会话里。按目标选择互补方法，说明各方法如何形成候选假设、特征或实验；复用冻结开发证据，仅补实际缺口。同一数据的多种变换或多个角色赞同不能当作独立验证。知识插件通过 plugins 提供提示/技能，并显式保留 plugin_read 读取公开方法全文；它不是待猜测的计算工具。工具授权仅来自 allowedCalls，不因加载知识获得安装、写入或交易能力。

角色以方法、输入引用与时点、实测结果、反证及局限交接。数值候选格式和评价由 evaluator 契约决定，模型不能补造测量；已保存结果供后续角色复用，工作流不重新实现下层算法。每个角色可以指定已配置模型，不自动绑定交易后端。

公开启动入口是 auto_factor_start；auto_factor_models 返回可用模型，auto_factor_runs 返回实际阶段和结果。已提供的评估实现是 sesame/factor-evaluator 的 factor_evaluate，选择引用为 {plugin_id:"sesame/factor-evaluator",tool:"factor_evaluate",arguments:{dataset:{mode,trainEnd,validationEnd,holdoutEnd,horizon,costBps,quantile},diagnostics}}；diagnostics 与 minRankIC/minCoverage/maxCorrelation 均按需求选填，也可选择其他明确实现 sesame.factor-evaluator/v1 的能力。内置实现接受已登记的数值面板 dataset_id，或 arguments.inputRef 中完整固定的 kind:data 引用，二选一；已有 research_register/data_snapshot 产物满足面板合同后可直接用其 Ref，不必先导入宿主目录。行格式为 {time,symbol,availableAt,fields:{close,...数值特征}}，原始行情格式不自动转换，也不能编造 availableAt；候选是 AST，例如 {op:"field",name:"signal"}。未安装的实现用 plugin_catalog({plugin_id}) 查公开目录；已安装能力用 plugin_discover/host.capabilities.list。缺实现或数据是明确依赖缺口，不要求翻源码推断。

角色任务的 auto_factor_context 返回 assignment.mode、expectedOutput、评估契约和可分页开发证据。auto_factor_submit 按此契约保存当前角色输出；它为候选和选择附上真正的评估回执。selection 只包含已接受且实测 eligible 的 trialId；没有合格候选时 [] 是有效结果。EVALUATION_REJECTED 或 HARD_REQUIREMENT_UNMET 表示未提交的语义拒绝，可修正提案但不能忽略用户硬要求；中断或未知结果则保留原输入作幂等恢复。业务 run_id 与宿主 workflow Run 引用不同，排队成功不能作为研究完成证据。

默认协作图声明主管、研究员、实现员、评审员和复盘员之间的协作与反馈关系；自定义流程按冻结计划的实际成员与职责构图，不为已省略阶段虚构角色。各方向、轮次以及最终选择复用同一成员身份。具体任务、实测评估、阶段和成果消费在详情中展开，不自动生成图节点或协作边；代码评估器和报告归档也不表示 Agent。
研究角色只读开发证据。纯知识方法、公开插件文本读取 plugin_read，以及通过 researchDataAccess 输入限定契约核对的原生计算工具可共同保留 restricted 模式。例如内置因子/策略指南与 abu-parameter-search 可以一起使用：参数工具只计算传入的开发试验并保存自身成果，不取完整面板。应按任务主动组合这些方法，无需为了保留留出验证禁用全部工具。能读取外部数据、启动其他调用、声明未知或冲突的研究工具使用 development-only；这不是已经发现泄露。此时输入必须止于 validationEnd，不能靠改标或删校验把已见数据称为 sealed holdout。restricted 角色上下文不提供原始输入引用、来源路径或 evaluator.arguments；完整来源由主 Agent 和最终报告保留，角色使用上下文中的开发行和 evaluator 合同。没有有效因子、空选择和提前停止都有效。每个 Agent 提交可供同伴使用的结构化结论；原生工作流结束时发布一份报告及证据附件，并绑定 evaluator 返回的固定 inputRefs。auto_factor_activity 打开宿主的 Run 界面，展示真实子任务和结果交接。

宿主在角色运行前检查冻结配置和必要依赖。interrupted 表示保留成果等待解决，不是完成或失败；auto_factor_runs 的 read 返回待处理中断的 ID、原因和依赖。主 Agent 核验并解决具体依赖后，用 auto_factor_runs({action:"resume",run_id,interrupt_ids:[...]}) 明确选择已处理的中断；直接使用宿主 Run 恢复接口时使用宿主字段 interruptIds，不混用两套参数。是否需要用户输入遵循宿主中断控制契约，不能仅因状态为 interrupted 就等待新回复。恢复继续原 workflow Run/会话与原角色标识，不创建新 generation，不重复 prepare、已完成角色或已保存评估。暂停请求被接收不等于已经到达安全点，read 返回实际状态。缺少 evaluator 独立只读 session 探针时会明确说明预检边界，不猜接口。

报告由宿主当前选中的 provider 呈现。程序先调用 `host.reports.describe`；本工作流的固定 `signal-study` 适配器只支持该描述明确兼容的 `sesame/reports` 输入，再通过它的 `report_publish` facade 提交既有研究结果、`content` 与 `style`。若当前 provider/schema 不兼容，保留已完成研究与固定成果并明确返回不支持，不改宿主选择、不重跑研究；Agent 可读取 `host_reports_describe` 后按实际 schema 适配，并用 `host_reports_publish` 发布。Agent 驱动的发布不能把 content/style 当宿主固定协议。正文保留判断、主图、读图短注、简短推理和关键使用条件，原始试验、源码、参数与完整回执在末尾附录；默认 Reports 提供蓝灰无框样式、LaTeX及可保存的声明式样式，helper 仅预览。禁止自建或上传报告 HTML/CSS/脚本。发布后保存精确 ref，再检查；检查失败保留同一 ref 复查，不重选参数或重跑留出。
