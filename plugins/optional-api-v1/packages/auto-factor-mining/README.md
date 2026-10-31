# 因子与策略研究

版本以 `plugin.json` 为准。`sesame/auto-factor-mining` 负责因子与策略研究，公开入口为 `auto_factor_start`，交付属于 Strategy；Investment Research 对应 Research。

## 单 Agent 与多 Agent

`config.executionMode:"single"` 是真正单 Agent 执行：一个实际 `host.agent.run`、一个会话与成员，顺序承担计划、提出假设、实现候选、复核实测、反思、冻结选择。候选和选择仍由独立原生 evaluator 计算；选择固定并且研究 Agent 结束后，原工作流才执行留出评价和归档。单 Agent 不意味着跳过复核、不意味着模型手算指标，也不把 evaluator 或机械报告步骤包装成额外 Agent。

省略或使用 `executionMode:"multi"` 保留原多 Agent 默认：主管规划，研究员提出假设，实现员提交候选，评审员核对真实回执，复盘员反思，主管固定选择，原生代码最终评价和归档。`config.workflow` 仍可自定义多模式分工与可选阶段；只把多个阶段写成相同 ID 的旧计划仍可能有多个 Agent Run，不能称作新的真正单模式。

单模式默认成员 ID 为 `researcher`，使用 `config.model` 或其唯一 `agentModels.researcher` 覆盖；可用自定义 workflow 指定一个统一成员，但全部六个阶段必须保留且同 ID。`parallelism` 省略自动为 1，显式大于 1 拒绝。其他模型、研究方法、evaluator 和候选契约仍按任务选择。

单模式通过 `auto_factor_context` 的 `assignment.mode/step_id/instructions/expectedOutput` 读取当前工作，调用 `auto_factor_submit({run_id,step_id,output})` 保存该阶段，再继续下一阶段；仅 `complete:true` 才结束 Agent。已接收阶段原样重试返回原回执，改写、越序、冒用身份会拒绝。未知 evaluator 结果固定原输入再重试；显式语义拒绝才允许修改候选。阶段账本、原 Agent Run、评估与选择在暂停/恢复中保留，不另派同职责 Agent。

两模式使用同一开发/留出隔离。权限不因单模式而扩大；开放数据能力仍只能 development-only，不能声称隔离留出。两模式都有失败/否决记录、真实 eligibility 门槛、固定选择、原生最终评价和实际 Strategy 报告。

## 因子知识、策略规则与真实回测

因子与策略指南已融合进本包声明的 knowledge，核心 `references/research-guide.md` 自动进入每个研究 Agent 的系统指令。完整方法、证据和可选 CLI 合同见 `references/factor-method.md`、`references/strategy-evidence.md`、`references/factor-cli.md`、`references/strategy-cli.md`；`scripts/reference-factor.mjs` 和 `scripts/reference-experiment.mjs` 是可选资源，不是新注册能力，也不自动重复 evaluator 已完成的计算。

工作流的因子统计评价不等于策略成交回测。策略还需固定决策/仓位、进出场、风险、订单与资金规则，并在适合的真实引擎验证。引擎选择优先级是**用户指定 → 预期交易平台原生 → 相同数据/合约 → 必要替代并说明差异**。例如 MT5 数据且预期在 MT5 交易，优先 MT5 原生 Tester，但不强制每次因子统计都跑 MT5。

可传 `config.strategyValidation`：`intendedPlatform`、`requestedEngine`、`dataSource`、`contract`、`calendarSessions`、`spreadCommissionSwap`、`executionRules`、`granularity`、`notes`，均为可选文本，合计不超过 12 KiB。它冻结验证意图与差异说明，仍不是成功回执。显式 `config.nativeValidation` 则选择已安装引擎、固定源码/build、开发/留出窗口及参数搜索计划，实际执行原生调用；完整契约和示例见 [原生验证](references/native-validation.md)。缺配置或引擎不阻断因子研究，不自动下单。

所选引擎有原生参数搜索/optimizer 时优先复用；有明确假设的特殊参数组可以定制，登记假设、参数集合、范围、目标、成本、约束、预算及全部失败试验。开发选优、固定选择与独立验证分别记录，不另造重复优化引擎，也不拿同一段优化成绩当样本外成功。引擎不可用时说明边界与恢复条件，不伪成功。

Backtrader `auto` 实际使用原生 Cerebro.optstrategy；vnpy 没有已声明 optimizer；MT5 以实际 catalog/schema 为准，未绑定时 unavailable，其宿主管理网格不冒称原生优化。原生步骤只在因子选择、所有研究 Agent 和 evaluator 最终评价完成之后运行，源码和参数不会因恢复而改变。任何未知 dispatch 先读同一 operation 收据，缺记录不等于未执行，不自动重发。源码是另行编写的实际策略，不自动等价于所选因子；本机 Python/MT5 不继承因子 evaluator 的 sealed 保证。

诊断是证据，Agent 阈值默认 advisory；只有用户明确 hard requirements 才淘汰。可按实际整体或子情景证据 `review.verdict:'conditional'`，保留 applicability（适用、失效、支持、局限、监控、停用和反例），随后 selection/context/report 原样保留。完整搜索 diagnostics/evaluations 保留，未测不算通过，也不要求每个诊断都通过。所选 evaluator 的 evaluationPlan 原样传入；回执限额 candidate 64 KiB、select 512 KiB、prepare/finalize 5 MiB。

适合寻找或改进因子、生成多个候选信号、比较因子组合并多轮筛选，也可承担策略中的状态特征或入场评分搜索阶段。轻量解释和单个指标计算可直接使用相关能力。公司/市场综合判断适合 investment-research，策略成交验证由对应回测后端承担。

工作流负责组织实验，不限制研究的品种数量；数据与评价目标由 evaluator 决定。内置 factor-evaluator 的 dataset.mode 支持 auto、cross-sectional、time-series，auto 对单品种使用时序评价。因子相关性及方向收益诊断不代替逐笔交易回测。数据获取、方法选择和评价准备可独立推进，不为迁就实现而改变研究标的或账户。

arguments.diagnostics 按任务选择安慰剂、蒙特卡洛、样本外、walk-forward、参数敏感性、市场状态分层、bootstrap 置信区间等扩展评估，默认不要求全部执行。各项结果与不适用、样本不足或执行异常的状态随实际 metrics 保留；单项不能运行不阻塞其他可用评估。候选资格遵从所选 evaluator 的真实基础测量及本次配置的门槛，不把未测试当成通过或无效。

公开 auto_factor_start 是带 start:workflow 效果的 function，按 kind=workflow 查询会漏掉它；auto_factor_workflow 是宿主内部入口。加载后调用公开入口，并核对实际 workflow Run 和阶段才可告知已启动。新工作流的阶段报告默认归 Strategy；恢复已有任务保留原绑定。


本插件编排研究协作，默认是主管规划、并行假设、候选实现、证据评审、复盘、冻结选择、最终评估、一次总结。显式 workflow 可合并人员和省略可选环节。模型、研究能力和评估实现由用户分别选择；没有默认 MT5、券商、AST 或其他执行后端。

## 组合方式

`config.research = {plugins:[插件ID], tools:[可选精确工具子集]}`。支持信息来源、具体计算和只有技能的知识方法，按目标选择互补组合。未提供 tools 时采用这些插件的全部可委派工具；空数组只加载所选技能/提示。选中研究插件后，工作流另提供 `sesame/plugin-manager#plugin_read` 读取公开 manifest/knowledge 正文；不提供加载、安装或修改能力。所选插件明确传入成员请求，allowedCalls 决定实际操作权限。主会话专用工具不会发给研究角色。显式选择不存在、停用、主会话专用、名称冲突的能力会失败，不猜测替代。版本和摘要在创建时冻结，恢复和新任务前复核。

来源、方法和工作流消费同一份冻结开发证据。上游保留来源/时点，下游交接方法、输入引用、实际结果、反证和局限；只补明确缺口，不重复已保存的调查和计算。多个同源指标或同样本候选不能当作独立支持，评审和最终选择解释冗余、分歧与适用条件，不靠角色投票。

`config.evaluator = {plugin_id, tool, arguments?}` 必填。任何已安装且实现 `sesame.factor-evaluator/v1` 的可委派工具都可选择，没有品牌白名单。工作流将 candidate 作为不透明 JSON，保存该工具实际返回的指标、资格、冗余和冻结选择回执，拒绝模型自己提供的指标。计算方法、字段、公式语言、成本及门槛由 evaluator.arguments 和该能力的契约决定。

同样支持任意已配置模型；`auto_factor_models` 提供当前描述，每个角色可以在 agentModels 指定 provider/id。研究轮数、方向数、候选数和并行分支数是工作流设置，与执行能力无关。

## 示例

`config.workflow` 可调整实际人员和可省略环节。每个字段映射到 `{id,title?,instructions?}`，同一 ID 可承担多个职责；`agentModels` 可按该 ID 选模型。省略字段保留原职责，`plan/review/reflection:null` 分别表示直接使用配置方向、按真实 evaluator eligibility 接纳、跳过反思。`hypothesis/code/selection` 不可省略，真实计算、固定选择和留出隔离仍由程序执行。

```json
{"workflow":{"plan":null,"hypothesis":{"id":"quant","instructions":"只使用冻结开发证据。"},"code":{"id":"quant"},"review":null,"reflection":null,"selection":{"id":"lead"}}}
```

以上放在 `auto_factor_start.config` 内，实际只调度 quant 的假设/实现和 lead 的选择；不是提示词中的流程建议。跳过文字审阅仍不能接纳 evaluator 拒绝的候选。计划与原生 Run、任务请求和最终报告一起保存；恢复保留原计划和已完成评价。需要改计划时用新的 request_id 建立新研究，已暴露留出数据不得重新宣称未触碰。

下面显式选择独立的因子评估插件，仅是一个组合示例：

```json
{
  "request_id": "research-001",
  "title": "因子研究",
  "goal": "比较可检验的候选并保留失败证据",
  "dataset_id": "registered-development-panel",
  "config": {
    "model": {"provider":"configured-provider","id":"configured-model"},
    "research": {"plugins":["sesame/financial-research"],"tools":["sesame/financial-research#financial_research_query","sesame/financial-research#financial_research_read"]},
    "evaluator": {
      "plugin_id":"sesame/factor-evaluator",
      "tool":"factor_evaluate",
      "arguments":{"dataset":{"mode":"auto","trainEnd":"2024-06-30T00:00:00Z","validationEnd":"2024-09-30T00:00:00Z","horizon":1,"costBps":10,"quantile":0.25},"diagnostics":{"outOfSample":true,"bootstrap":{"samples":199,"seed":17}}}
    },
    "directions":["动量与反转","量价关系"],
    "rounds":3,
    "parallelism":2,
    "maxTrials":12
  }
}
```

能力引用以宿主提供的完整声明为准。上例只选择分段验证汇总和 bootstrap 区间，其余扩展项目不运行；旧 minRankIC、minCoverage、maxCorrelation 也只作 advisory。用户明确硬要求用当前 evaluator 的 evaluationPlan.thresholds 表达 source:user、mode:required 并写明理由，不把 Agent 选择的阈值冒充用户要求。上例中的数据只能包含 validationEnd 及之前的开发观察。`dataset_id` 是否必需由所选评估器决定；自定义实现可以在 arguments 指定其他输入。

内置 `sesame/factor-evaluator` 也接受 `config.evaluator.arguments.inputRef` 中的完整固定 DataRef（`id/revision/digest/kind/schemaVersion`，`kind:data`），此时省略顶层 `dataset_id`。数据必须已经发布为 `json-rows` 数值面板，并满足同一行结构、时间可得性和分割规则；原始行情 Ref 不会被隐式转成面板。已有研究执行产物可由此直接进入评估，不需要创建另一个宿主 dataset。评估回执 `data.inputRefs` 保留精确来源身份，最终报告将这些 Ref 同时绑定为数据、依赖和 provenance 引用。

## 留出与调用边界

工作流按选中能力的数据访问契约分类。纯知识插件、公开插件文本读取 `sesame/plugin-manager#plugin_read`，以及通过下列核对的原生计算函数可一起保留 restricted 模式。因子/策略指南已经内置，新任务只选择必要计算工具，例如 `research:{plugins:["sesame/abu-parameter-search"]}`；满足输入限定契约时仍保留隔离留出，无需设 `tools:[]`。

能力在 capabilities.json 中声明 `researchDataAccess:{schemaVersion:1,reads:"input-only",writes:"none"|"derived-artifacts-only"}`。input-only 表示计算只消费本次内联输入；输入中的 ID、Ref、路径是数据或来源标签，不能解引用到其他数据。实现可读取固定本包源码以计算实现摘要，不得从文件、网络、账户、工作区或保留状态补取观察。derived-artifacts-only 表示只创建/发布本次输入及其派生结果，并可清理本次新建且已发布的临时 blob；不修改或删除已有工件。

核对要求 native/function/immediate/json，不能有 requires 探针、allowedCalls、collaboration 或 resumable 执行；所在 manifest 的 hooks/sources/services/stateCollections 也必须为空。writes:none 要求 effects:[]；派生工件只接受精确的 resources.create/resources.publish 声明，不接受宽泛写权限、任意资源删除或读取/网络/模型/执行/未知 effects。未声明、未知版本或矛盾声明仍按通用研究工具处理，不以插件名或空 effects 放行。契约是对受信原生实现的可审计行为约定，需实现和测试证据支持，不是宿主沙箱。新增能力不能靠贴标签获得隔离证明。

来源、data/workspace 等可读取完整数据的工具，以及未满足契约的工具，要求 evaluator.prepare 使用 development-only：评估器只接收开发数据，也不宣称完成隔离留出检验。factor-evaluator 继续拒绝 validationEnd 后的行；该拒绝是输入/能力组合不相容，不能据此断定工具已经读取留出数据。超过 holdoutEnd 或违反可得时点的行仍是独立的数据错误。不要通过改标已见数据或删日期校验伪造隔离。

restricted 模式的研究角色上下文只提供开发行、输入摘要和评价合同，省略原始 `sourceId/inputRefs/provenance/dependencies` 及 `evaluator.arguments`，避免用输入 Ref 重新读取留出行。主会话和最终归档仍保留完整来源；该投影不修改冻结记录。development-only 角色没有隔离留出的承诺，可以保留来源用于复现。

受限模式中，每个角色使用声明的上下文、结构化提交、选定知识与输入限定计算；评估工具拒绝直接 Agent 调用。prepare 只给出开发集；select 冻结后由原生工作流直接调用最终评估。不把最终结果回流研究。解析出的 inputOnlyTools、带自动 hooks 的 generalDataPlugins 与插件版本/完整修订摘要一起冻结；自动入口即使 tools:[] 也按通用数据访问处理。仅声明未授权调用的服务、来源或状态集合不等于自动取数，不影响纯知识或精确公共文本读取；普通计算函数仍需通过上述输入限定核对。恢复时重新核对，声明或实现变化须新建运行，不升级历史 development-only 会话。原生插件本身是受信代码，这不是对恶意原生代码/外部进程的隔离承诺。

跨插件调用只发生在有效的 auto_factor_start、auto_factor_submit 与 auto_factor_workflow 能力调用里。后台工作本身是声明的 native Run，研究角色通过 host.agent.run 执行；最终评估和归档直接使用代码。评估器版本改变、冻结输入不可读或核心调用失败时保留具体诊断和断点，不悄悄切换实现；单项可选诊断返回 unavailable/error 则保留该项结果，继续其他评估与报告。

## 原生任务与报告

`auto_factor_activity({run_id})` 打开宿主原生 Run 界面。工作流与普通子 Agent 使用同一组运行、观察和取消接口；每个节点对应实际 Run，交接只在后续角色真正读到前序产物时产生。插件保留结构化研究断点，不复制公开消息和工具状态，也不提供第二套 HTML 监控。

工作流预先绑定研究报告目标，由宿主准备目录。研究完成且子任务已退出时，原生代码通过 Report 的结构化内容接口发布一份报告，并保留 `run.json`、`dataset.json`、`factors.json` 原始证据附件。执行或归档异常保留证据、具体错误和断点，并中断原 Run，不发布终态报告；修复后恢复沿用原宿主 Run、会话、业务 ID、角色 assignment/RunRef 和已提交成果。已完成与已取消的运行是终态。实际评估得到的不合格候选仍是合法研究结果。

`auto_factor_runs` 支持 list/read/pause/resume/cancel；`auto_factor_report` 只读取当前已发布的同一份报告，尊重用户对宿主绑定文件的移动、编辑和删除。没有有效候选、空选择或提前停止都是合法研究结果。

宿主在 `auto_factor_workflow` 的 `requires` 中调用只读 `auto_factor_dependencies({run_id})`，返回 `{available,reason?,details?}`。它核验冻结数据完整性、剩余阶段选择的模型配置及 evaluator/research 声明修订；不会重做 prepare、创建新评估会话或启动 Agent。现有 evaluator 协议没有独立只读 session 探针，评估器持久会话的实际可读性仍由下一次真实 operation 核验，不把声明存在当作评估已成功。

依赖不可用时宿主中断整个工作流并释放运行资源，主 Agent 核验并修复具体依赖后用 `host.runs.resume` 恢复；`auto_factor_runs` 的 pause/resume 只是同一宿主控制的业务 ID 便捷入口。恢复前重新预检，仍不可用继续挂起。若某角色已完成但未调用 auto_factor_submit 保存结构化输出，预检明确返回 MISSING_OUTPUT 并保留其文字；当前 submit 只接受原注册运行角色，主 Agent 没有代交该产物的能力，不能反复恢复或重开已完成角色来绕过。运行中结构化 `DEPENDENCY_UNAVAILABLE` 与 `RUN_INTERRUPTED` 必须向宿主传播，不能变成某个 trial 的普通失败或报告终态。

`auto_factor_runs({action:"read",run_id})` 返回 `interrupts:[{id,reason,requirements,...}]`。主 Agent 处理并核验对应事项后，可调用 `auto_factor_runs({action:"resume",run_id,interrupt_ids:["读到的中断ID"],response:{resolution:"实际处理结果"}})`；`response` 可省略。它转发为 `host.runs.resume(workflow,{interruptIds,response})`，沿用宿主中断控制契约；已授权范围内可修复的依赖不要求再收到一条用户回复，用户明确暂停或尚缺必要授权仍不能被依赖修复覆盖。即使只有一项也明确选 ID；只解决部分事项时，其余中断继续等待，不默认批准全部。

原生执行声明 `resumable:true`，通过 `execution.checkpointState`、`execution.attempt/resume` 与 `await execution.checkpoint(state)` 保存阶段位置；业务成果继续存于原有 durable checkpoints。角色派发前保存请求和固定 operationId，接受后保存 RunRef；恢复只观察或恢复该 Run。已完成角色输出、评估回执、reflection、selection 与 finalEvaluation 直接复用。评估器协议要求同一 session/trial/selection 的冻结请求具有幂等回执；不能换 trial ID 或改输入重试未知结果。

## 共用报告呈现

报告由宿主当前选中的 provider 呈现。程序先调用 `host.reports.describe`；本工作流的固定 `signal-study` 适配器只支持该描述明确兼容的 `sesame/reports` 输入，再通过它的 `report_publish` facade 提交既有研究结果、`content` 与 `style`。若当前 provider/schema 不兼容，保留已完成研究与固定成果并明确返回不支持，不改宿主选择、不重跑研究；Agent 可读取 `host_reports_describe` 后按实际 schema 适配，并用 `host_reports_publish` 发布。Agent 驱动的发布不能把 content/style 当宿主固定协议。正文保留判断、主图、读图短注、简短推理和关键使用条件，原始试验、源码、参数与完整回执在末尾附录；默认 Reports 提供蓝灰无框样式、LaTeX及可保存的声明式样式，helper 仅预览。禁止自建或上传报告 HTML/CSS/脚本。发布后保存精确 ref，再检查；检查失败保留同一 ref 复查，不重选参数或重跑留出。

`content.kind: "signal-study"` 可传已记录的 `run`，或以 `run_source: {ref, entry: "run.json"}` 读取已发表成果中的固定 JSON，二选一；对应 ref 必须在发布的 `references` 或 `data` 中声明。该读取不是 HTML 上传，也不重跑研究。通用组合可使用 `document`，已保存样式使用 Report 返回的精确版本；改变内容或样式后检查当前发布修订。

## 验证与复现

包内 `node --test tests/*.test.js` 运行组合解析、报告、可信归属和真实工作流结果等测试。跨包生命周期、真实独立计算、非 AST 协议、归档及复现脚本测试位于外层 `plugins/optional-api-v1/tests/auto-factor-mining-runtime.test.mjs`；`auto-factor-mining-packages.test.mjs` 用官方 buildLock 验证两个包的独立分发边界。外层 `auto-factor-mining-host.test.mjs` 使用真实安装器、Store、后台工具循环及本地 SSE 模型夹具。

在 `plugins/optional-api-v1` 设置 `SESAME_PLUGIN_SDK_LOADER` 为匹配宿主的 SDK loader 文件 URL 后运行 `npm test`，既有运行器会同时收集包内及外层测试。定向运行使用 `node --import <SDK-loader-file-URL> --test tests/auto-factor-mining-runtime.test.mjs tests/auto-factor-mining-packages.test.mjs`。

数值实现、数学测试和独立复现脚本现位于所选评估插件。例如 factor-evaluator 提供 `node scripts/reproduce.mjs <run.json> <run.dataset.json>`；工作流不规定通用计算公式。研究结果不等于实盘可用信号。

## 宿主 API v2

capabilities.json 是能力、输入输出、生命周期、状态集合和报告 schema 的唯一声明；createCapabilities 仅绑定实现。所选研究能力使用 pluginId#capabilityId 精确引用，模型来自 context.models。workflow 能力有独立任务会话，子 Agent 继承真实父 Run；state 保存 CAS 索引，resources 保存不可变断点与报告。views.open 只打开宿主原生 Run 界面。最终评估与报告归档由代码完成。

执行器从冻结的 config.workflow 生成 `options.task.collaboration={agents,relationships}`，调用者只提供一次计划。默认是主管、假设、实现、评审、反思五个身份；自定义时按成员 ID 合并职责、合并相同成员对的关系，单成员不声明多成员图。成员 ID 不能使用 constructor、toString 等继承字典属性名。方向分支、轮次和最终选择是实际任务，不是额外身份；assignment/operationId 包含业务步骤 key，因此同一成员承担多个步骤也不会重用错误回执。每次 `host.agent.run` 绑定相应 agentId，并保留 role/stage/iteration。评估器和报告归档是代码能力，不作为 Agent；handoff 只记录实际成果消费。
