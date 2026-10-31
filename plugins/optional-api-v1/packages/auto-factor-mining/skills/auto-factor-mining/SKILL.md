---
name: auto-factor-mining
description: 因子与策略研究，单 Agent 或多 Agent 实测、复核和固定选择；统计 evaluator 与真实交易回测边界分开。
---

本包内置融合的因子/策略指南，核心规则随每个研究 Agent 的指令提供。`config.executionMode:"single"` 启动一个实际 Agent Run，依次完成全部六阶段；context 给出 step_id，submit 必须带该 ID，完成前继续下一阶段。省略/multi 保留原五角色默认；单模式不能省评审/反思，parallelism 为 1。原生 evaluator 负责候选/选择实测，选择固定且研究 Agent 结束后才开隔离留出并生成 Strategy 报告。

按 `references/research-guide.md` 先形成判断任务单，再组织取证和试验。沿用用户需求与现有plan.reason等交接文字，明确用户要判断的问题、对象期限、比较对象、用户指定与Agent补充角度、改判证据；不是新增必填API结构。单人与团队共用，信息足够就合理假设推进，用户裁剪优先。各阶段逐项回答而非只列指标，最终综合按判断重要性组织，图和事实服务答案。

可选 `config.nativeValidation` 的真实原生步骤及完整输入见 `references/native-validation.md`：固定源码/构建、开发/留出窗口、成本、参数范围与目标；Backtrader auto调用真实optstrategy，缺失接口记录unavailable而不阻断因子研究。原生调用只在研究Agent结束和因子最终评价之后进行，独立保存开发选参、冻结与holdout；同operation恢复先读实际收据，未知不重发。本机原生进程不在因子evaluator的sealed环境，不声称自动策略翻译或实盘有效。

`evaluator.arguments.evaluationPlan` 由Agent按任务选择，用户明确要求覆盖。诊断/Agent阈值默认advisory，用户明确hard_requirements才淘汰；真实整体或子情景可测时允许conditional使用，applicability记适用/失效、支持、局限、监控/停用及反例。不能要求全部验证过线，也不能用条件使用绕过用户硬要求。完整搜索diagnostics/evaluations和失败尝试保留到报告。

`references/research-guide.md`、`factor-method.md`、`strategy-evidence.md` 属于本包已声明知识；两份 reference CLI 仅可选，不是注册工具。数据、方法、模型与 evaluator 仍可选。真实策略验证优先用户指定引擎→预期交易平台原生→相同数据/合约→说明差异的替代。MT5 数据且预期 MT5 交易优先原生 Tester，不强制所有因子统计跑 MT5。原生 optimizer 优先，明确假设的定制参数组允许；保留范围、成本、全部失败，选优与冻结后的独立验证分开。`strategyValidation` 记录实际平台/数据/合约/时段/费用swap/成交规则/粒度和后续请求，不能冒充已执行回测。当前因子 evaluator 不执行真实交易规则回测，不自动交易。

适用于产生并比较多个候选、迭代改进因子或组合、经实测复核后选择的研究，可承担策略中的行情状态特征和入场评分搜索阶段。因子解释、单个指标计算和明确轻量/快速的问题可直接处理。明确最大努力、最大功率等要求时，发现匹配的工作流，按需并行准备数据和查找评价实现，再启动适配的实验。

工作流不限制研究的品种数量；evaluator 决定数据形状和评价目标。内置 factor-evaluator 的 dataset.mode 支持 auto、cross-sectional、time-series，auto 可适配单品种时序因子。时序相关性和方向收益诊断不等于逐笔交易胜率或盈亏比；成交验证另选对应回测能力。arguments.diagnostics 按当前问题选取稳健性项目，不默认全跑。某项不适用、样本不足或因环境失败时保留原因，继续其他适用项；按实际测量和本次显式门槛选择候选，不以未测试否定想法，也不把全部未测说成通过。数据缺口与评价实现缺口分别解决，不为迁就现有评估器改变标的范围或要求切换账户。

研究目标是产生可检验的候选、实测评价、失败证据与后续假设。配置由公开 function auto_factor_start 的完整 schema 定义，它以 start:workflow 效果启动原生工作流，仅查 kind=workflow 会漏掉入口。evaluator 使用指定插件的局部 capability ID，research.tools 使用已注册的 pluginId#capabilityId，模型选择来自 auto_factor_models。没有声明的接口不会被自动猜测或补齐。实际受理的 workflow Run 才是启动证据，发现、加载或普通子 Agent 并行均不能替代；新建阶段报告归 Strategy，由该 Run 交付。

多 Agent 模式的 config.workflow 可指定各阶段的实际成员；同一 id 可承担多项职责，plan/review/reflection 可为 null。省略 workflow 才使用默认五角色；agentModels 按实际成员 ID 覆盖模型，不使用一次任务的 assignmentId。省略评审不跳过真实 evaluator 评价、资格门槛或固定选择。

本包负责研究协作与证据综合。来源能力提供可得时点明确的事实；方法包负责具体解释或计算；独立 evaluator 负责统一口径的实测评价。research.plugins 同时支持来源、计算和纯知识方法，按当前目标选择互补组合；方法数量与角色票数不是证据强度。选定知识随成员请求传入，plugin_read 只读公开 manifest/knowledge 正文；不授予插件安装、加载或修改。已声明技能只有知识时直接按方法分析，不捏造函数名或执行回执。

共同输入是冻结的开发数据与已有试验。来源调查只补明确缺口，方法说明输入引用、时点与假设，后续角色复用实际回执并解释分歧、相关性及失效条件。实现者把假设交给所选 evaluator 的候选协议，评审者核对其真实数值；两者不各写一套评估算法。阶段结果以真实输出为准，不重新执行已保存成果。

冻结数据、候选格式和门槛由独立 evaluator 决定。研究角色通过 auto_factor_context 获取必要证据，通过 auto_factor_submit 写入结构化断点，因而暂停或重开后无需重复已保存的研究。指标由 evaluator 计算，模型不能手填。可复核反证、否决全部候选和提前停止都能满足研究目标。

受限工作流可组合纯知识方法、公开插件文本读取 plugin_read 与通过 researchDataAccess 输入限定契约核对的原生计算工具，保留隔离留出。例如内置因子/策略指南提供方法，abu-parameter-search 比较传入的开发试验并冻结选型；应按任务主动配合使用，不因工具可调用就放弃隔离或要求 tools:[]。可读外部数据、可启动其他调用或声明未知/冲突的工具使用 development-only，输入止于 validationEnd；空 effects 本身不证明输入限定。分类不等于已经观察到泄露，也不会把原已暴露的数据重新封存。选择冻结后由原生代码完成最终评估和归档，不安排额外模型承担机械步骤。

实时公开活动由 auto_factor_activity 打开宿主原生 Run 界面，auto_factor_runs 提供状态、暂停、取消与显式恢复。失败或被否决试验保留；原有报告被用户移动、修改或删除时不覆盖、不重建。

报告由宿主当前选中的 provider 呈现。程序先调用 `host.reports.describe`；本工作流的固定 `signal-study` 适配器只支持该描述明确兼容的 `sesame/reports` 输入，再通过它的 `report_publish` facade 提交既有研究结果、`content` 与 `style`。若当前 provider/schema 不兼容，保留已完成研究与固定成果并明确返回不支持，不改宿主选择、不重跑研究；Agent 可读取 `host_reports_describe` 后按实际 schema 适配，并用 `host_reports_publish` 发布。Agent 驱动的发布不能把 content/style 当宿主固定协议。正文保留判断、主图、读图短注、简短推理和关键使用条件，原始试验、源码、参数与完整回执在末尾附录；默认 Reports 提供蓝灰无框样式、LaTeX及可保存的声明式样式，helper 仅预览。禁止自建或上传报告 HTML/CSS/脚本。发布后保存精确 ref，再检查；检查失败保留同一 ref 复查，不重选参数或重跑留出。
