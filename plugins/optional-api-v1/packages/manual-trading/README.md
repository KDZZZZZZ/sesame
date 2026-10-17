# Agent 手工交易工作流

`sesame/manual-trading` 提供一次只读研究工作流，以及明确授权后的周期/事件交易计划。两者复用同一个原生工作流、角色协作、依赖检查和中断恢复机制。账户、下单、策略挂载控制由明确选择的能力提供；研究和数据工具由所选插件提供。安装不创建交易计划。

## 只读研究

“分析 XAUUSD 接下来怎么操作”使用一次 `manual_trading_analyze`，由插件建立一个父工作流，旗下八个角色完成四路研究、多空交叉审阅、风险审阅和 Markdown 总结。主 Agent 不再自己创建一组平级 `host.agent.run`，也不为每个成员重复声明协作图。父工作流是程序控制器，不额外增加一个协调 Agent。

```json
{
  "request_id": "xauusd-research-20261017",
  "title": "XAUUSD 下一阶段情景分析",
  "symbols": ["XAUUSD"],
  "execution": {
    "plugin_id": "sesame/portfolio-execution",
    "context_tool": "portfolio_execution_context",
    "apply_tool": "portfolio_execution_apply",
    "arguments": {"binding_id": "复制实际配置返回的ID"}
  },
  "model": {"provider": "复制已配置供应商ID", "id": "复制已配置模型ID"},
  "research": {"plugins": ["sesame/financial-research"], "tools": ["financial_research_status", "financial_research_query", "financial_research_read"]},
  "instructions": "结合 H1 结构与下一周实际催化，比较情景、触发条件、反证与风险，保留来源和时间边界。",
  "report": false
}
```

示例的账户绑定和模型必须替换为实际可用配置；`financial-research` 是默认外部研究来源，但不保证覆盖每个目标，缺项处理和用户明确不用后的替代规则见下文。执行绑定在此只提供账户读取，不调用 apply。一次分析不保存目标仓位、不启动执行员、不下单、不平仓、不停策略，也不建立定时计划。未确认风险规则属于建议的实盘前提，不阻止只读分析。

`report` 默认 `false`：结论和各角色 Markdown 保留在工作流中，不创建报告文件。用户明确要求文件时传 `report:true`；工作流启动即绑定报告，结束后发布一份 HTML、`analysis.md` 和冻结 `run.json`。是否生成报告与是否使用工作流是两个独立选择。

最终 HTML 报告只展示经理总结一次，保留 Markdown 原文的内容和结构。成员分析在“工作过程”中查看；账户、执行回执及完整证据保存在冻结 `run.json` 中，不再自动拼接到报告正文。只读研究和交易日报使用同一呈现规则；没有经理总结时显示未形成总结，不用其他角色或内部诊断代替。

返回的 `id` 是业务运行 ID，`workflow.id` 是宿主原生工作流 ID。`manual_trading_runs({action:"read",run_id:id})` 返回 `summary` 与成员 `reports`；`manual_trading_activity({run_id:id})` 打开同一工作流过程。重试保留相同 `request_id` 和完整输入，返回原运行；改问题或配置用新的 request_id。被中断的工作流应恢复原 `workflow.id`，不能通过新请求绕过缺失依赖。

## 必需与可选配置

| 配置 | 何时需要 | 取得位置与传入形状 | 缺失时的行为 |
| --- | --- | --- | --- |
| 模型供应商、模型及对应访问配置 | 分析、交易均必需 | 先在宿主配置模型访问，`manual_trading_models({})` 返回 `models:[{provider,id,configurationDigest,...}]`；传入 `model:{provider,id,configurationDigest?}`。插件不接收模型密钥 | 未配置模型不会启动角色；运行中依赖改变会暂停原工作流 |
| 已连接账户及上下文绑定 | 分析读取账户、交易执行均必需 | MT5/QMT 原生插件负责账户与连接。`portfolio_execution_configure({backend:"mt5"})` 或 QMT 对应值返回 `execution:{plugin_id,context_tool,apply_tool,arguments:{binding_id}}`。复制整个返回对象；其他满足 [COMPOSITION.md](COMPOSITION.md) 的已注册实现也可用 | 未取得绑定时入口返回明确缺项；已受理工作流的账户快照读取失败会暂停，保留当前成果 |
| 分析目标 | 只读分析必需 | `title`、`symbols:["准确券商品种名"]`、稳定 `request_id`；问题、H1/日线等观察周期和数据时间范围写入 `instructions` | 品种与研究问题不明确时不能把别的标的成果算作完成 |
| 数据、新闻、搜索、基本面或方法插件 | 取决于本次问题，非全部必需 | `research:{plugins:["已安装插件ID"],tools:["明确的读取或研究能力名"]}`；`host.capabilities.list({pluginId})` 返回各能力的输入、用法、依赖。无工具知识包可仅列 plugin ID | 必需来源未配置、不可访问或不覆盖目标时，相关角色调用 `host_runs_interrupt({reason})`，保留已有证据；非适用维度明确说明原因 |
| 来源提供方、凭据和访问身份 | 仅所选来源要求时 | 由来源插件的公开配置/状态能力提供。例 `financial_research_status({})` 返回 `sources:[{provider,kinds,configured,required_environment_names}]`；主 Agent 可用 `financial_research_configure({credentials:{fmp_api_key,fred_api_key,...}})` 保存已提供的凭据，可选 `*_env` 字段选择环境变量名称。密钥值留在来源的私有配置中，不放入本插件输入或报告 | `configured` 不证明访问权限、网络或目标覆盖；实际请求失败说明具体缺项，修复后查询核验；缺少必要证据时暂停原 Run，不换成价格分析交差 |
| 逐角色模型与辩论轮次 | 可选 | `agent_models:{news:{provider,id},...}` 省略继承 model；只读不提供 executor。`debate_rounds` 默认 1，范围 1–3 | 使用声明的默认值 |
| 报告文件 | 只读分析可选 | `report:true` 明确生成；默认 false。已授权交易计划维持每轮日报 | 未要求报告不会生成文件，原生工作流仍可查看过程和 Markdown 结论 |
| 交易授权、风险规则和执行限制 | 仅真实交易路径 | 用户授权具体交易目标；已确认风险红线通过 `sesame/memory` 的 `memory_trading_context` / `memory_read` 读取，按账户/后端适用范围核对。执行限制取自所选 binding 的 quantityRules 与后端回执 | 新增风险缺必需规则或保护能力时暂停，不编造默认百分比；只读研究不受此交易前提阻止 |
| 周期与事件 | 仅明确要求持续交易时 | `manual_trading_plan` 的 `interval_minutes`、`event_keys`、`account_events`。省略周期为 null；`manual_trading_analyze` 不接受这些字段 | H1 是分析周期，不自动建立 60 分钟交易计划 |

外部研究默认优先使用 `sesame/financial-research`，主 Agent 在 `research` 中明确选择其 `financial_research_status`、`financial_research_query`、`financial_research_read`。**只有用户明确表示不用该插件，才使用其他来源或搜索办法**，包括直接抓取网站、浏览器检索及补充取证；将用户的来源选择或明确拒绝写入 `instructions` 传给研究成员。缺少安装、Key、付费权限、额度或目标覆盖时，由主 Agent 按实际缺项使用已声明能力修复并核验所选来源；运行中的受影响任务暂停原 Run、保留成果。缺少用户尚未提供的凭据或需要改变来源选择时，再取得相应信息或决定，不自动换源。

依据 status 返回的 provider/kinds 和 required_environment_names 只配置本次目标所需来源，不要求全部开通。FMP 当前接入的是股票新闻，不是通用搜索，也不保证黄金或宏观事件新闻覆盖；有 Key 不等于具备覆盖。账户读取、本地指标计算和分析方法仍按各自声明使用，不能拿来替代缺失的新闻等证据。用户明确不用首选插件后，才从其他已注册能力中选择合适来源。只有主会话配置来源，研究成员只获得选定读取/研究能力。

分析入口依据已注册 `effects` 排除明确声明的交易、配置、终端启动和工作流控制能力，并排除账户 binding 的写工具。未指定 research.tools 时从所选插件中保留其研究子集；显式工具列表包含这些写能力时一次列出不支持项。读取过程中保存证据、缓存或数据 artifact 仍可使用。`mt5_python` 等动态读取接口由所属插件按操作检查只读边界，能力描述不是对任意原生代码的安全沙箱。

## 已授权交易计划

先在选中的执行插件中配置连接和账户，取得其通用绑定，再调用 `manual_trading_models` 选择已配置的供应商/模型。工作流不接受 `backend` 字段，也不默认加载研究来源。

```json
{
  "title": "账户研究与交易",
  "execution": {
    "plugin_id": "用户选定的执行插件ID",
    "context_tool": "该能力的账户上下文工具",
    "apply_tool": "该能力的目标执行工具",
    "arguments": {"binding_id": "该能力返回的绑定ID"}
  },
  "research": {"plugins": ["用户选定的研究插件ID"]},
  "mode": "team",
  "model": {"provider": "已配置供应商ID", "id": "默认模型ID"},
  "agent_models": {"market": {"provider": "供应商A", "id": "模型A"}},
  "symbols": ["准确品种名"],
  "interval_minutes": 60,
  "event_keys": ["important-news"],
  "instructions": "证据不足时保持不变。"
}
```

示例是占位符，使用工具实际返回的名称。内置独立实现 `sesame/portfolio-execution` 的 `portfolio_execution_configure` 可返回上述 execution 对象；这只是一个实现，工作流也接受其他满足相同工具协议的插件。协议见 [COMPOSITION.md](COMPOSITION.md)。

`research.plugins` 可以选择任意已安装、可委派的工具或技能插件；`research.tools` 可缩小工具范围。默认只使用所选插件的可委派工具，不授予 main-only 管理入口，也不自动启用禁用插件。省略 research 保留更新前的选择，`{"plugins":[]}` 清除选择。执行角色不附加研究工具。插件摘要在保存时冻结；变更后需要重新保存计划。

每个 Agent 都可独立选模型：market、fundamentals、news、sentiment、bull、bear、risk、manager、executor；省略继承默认。team 顺序为四个研究角色并行 → 多空辩论 → 风控 → 经理 → 执行；程序随后归档总结。周期至少五分钟，事件使用稳定 ID 去重。同账户的目标执行仍有顺序，研究角色在本轮并行；重启不会补发旧订单。

目标用准确十进制字符串、执行能力声明的单位；`unchanged:true, targets:[]` 有效。未列出的品种保持不变，明确零仓位可以关闭量化策略买入的持仓。继续挂载有极大风险时在 pause_strategies 填观察到的挂载 ID 和具体理由，没有额外权限开关。执行插件负责真实支持范围、账户核验、原生数量规则、最终报价和幂等；工作流保留其真实回执，未知结果不能当作成交。

`workflow_execute` 声明 `resumable:true` 和 `requires`。宿主先调用只读 `workflow_dependencies({runId})`，核验冻结计划的剩余角色模型、选中能力修订，并通过该计划的 context 能力读取实际账户快照以检查连接。检查失败返回 `{available:false,reason,details}`，不启动角色 Agent 或交易；已保存完整执行回执、仅待报告收尾时不再要求账户在线。

中断保留原业务 ID、宿主 Run/会话、角色 RunRef、已完成阶段和 SQLite 决策/执行回执，不记为失败，不发布终态报告。`manual_trading_runs(action=read)` 返回 `workflow`；`runs.read(workflow)` 给出中断 ID、原因与依赖。主 Agent 处理并核验对应事项后，可调用 `runs.resume(workflow,{interruptIds:["已处理的ID"],response:{resolution:"实际处理结果"}})`；剩余中断继续等待，全部解决才重新预检并恢复同一次执行。是否需要用户输入遵循宿主中断控制契约，已授权范围内的依赖修复不要求额外回复；用户明确暂停、交易授权和风险规则确认仍需满足各自条件。已完成经理未保存结构化决定时，预检返回 NO_DECISION；所属主 Agent 可用 manual_trading_context 核对账户与已有分析，在原交易授权内调用 manual_trading_decide 补交，然后恢复原工作流，不重复运行已完成经理。用户也可以从宿主界面明确恢复。计划启停控制调度，不能替代这个运行级中断/恢复接口。

原生工作流在安全阶段使用 `await execution.checkpoint({runId,stageIndex})`；`execution.checkpointState` 指向同一个业务运行，`execution.attempt` 变化时清除本轮不可用上下文缓存，只允许重新进行只读检查。角色以固定 role/round 请求及 operationId 接受并保存 RunRef，恢复不重新派发已接受任务。已保存 decision 和 execution 直接复用；执行已经送出而回执尚未保存时，必须先核验原 operation IDs，不能自动重放或创建新决策。`RUN_INTERRUPTED` / `DEPENDENCY_UNAVAILABLE` 向宿主传播，取消仍不代表撤销已成交订单。

协作图由启动工作流时的 `options.task.collaboration={agents,relationships}` 明确声明。只读分析声明四位研究员、多空辩论、风险审查和经理，共八个身份；交易计划 single 为经理与执行员，team 为九个身份。研究员向多空角色提供证据，多空角色互相质询并向风险审查提交论据，风险意见交给组合经理，经理将冻结目标交给执行员。图表达角色间的主要协作约定，不从阶段顺序、调用轨迹或结果读取记录自动生成边。每次 `host.agent.run` 的 `options.task.agentId` 使用声明的角色 ID；多轮辩论保持同一身份，role/stage/iteration 和真实 Run 回执在详情中展开。`handoff` 仍记录实际成果消费，供审计和详情查看，不改变协作关系。

## 数据边界

旧插件私有业务历史不会自动导入，也不会物理删除旧库。新的计划和运行只使用本插件明确保存的记录；不读取宿主私库。执行确认只接受冻结 fillSources 与原始 producer 登记的成交行，目标和派生数据不能代替实际成交。

## 用户可见资料

账户、全来源持仓、委托与成交历史、挂载、团队结论和研究数据集均可复核。`manual_trading_context` 分页返回，`manual_trading_runs` 查看和取消所属计划；团队公开结论不包含私有推理。研究数据缺口保留在结果中，不从目标推算成交或收益。

### 原生任务与报告

`manual_trading_activity({run_id})` 打开宿主原生 Run 界面。每轮工作流拥有普通子任务会话，实际研究、经理和执行 Agent 是其子 Run；界面统一展示进度、公开输出、工具回执、实际结果交接和报告。插件不再提供临时 HTML 监控或复制公开任务消息。

交易计划和显式 `report:true` 的分析绑定 `research/手工交易日报/<计划名称-ID>/<时间-运行ID>.html`，父目录由宿主准备。角色使用 output:none。指定报告的整轮结束后由代码发布一个 report artifact，包含 `report.html` 和冻结的 `run.json` 附件；分析另附 `analysis.md`。默认只读分析保持 output:none，不创建文件，仍可在同一个原生工作流查看过程和结论。失败同样保留已有证据，并让实际工作流 Run 失败；不派机械总结 Agent。`manual_trading_report` 读取同一报告引用，不重新发布或覆盖用户移动、编辑、删除的绑定文件。

取消结束当前父 Run 及其活动子 Run，同时保留目标与真实执行回执。取消不能撤销已经发生的成交；应用重启也不会重放不确定的外部执行。

交易案例按账户、标的和实际已知时间检索，后续通过 `manual_trading_review` 使用真实外部数据集复盘；不将目标、持有不变或报价变化当作成交收益。事前判断登记、固定证据核验、归因、校准和准则由独立 `sesame/judgment-evolution` 提供，需要安装并启用该插件。主 Agent 使用 `host.capabilities.list` 中已注册的 `judgment_record`、`judgment_resolve`、`judgment_reflect`、`judgment_rules` 及其队列和审计能力，依照该插件公开声明调用；缺少能力时明确报告依赖。判断管理只允许主会话，角色可以经允许的 `host.resources.read` 读取主 Agent 提供的准则 ArtifactRef。

计划/任务/案例存于插件私有 SQLite，研究证据存于 datasets。3.1 起本插件不创建判断数据库、不审计主会话回复，也不注册判断转发入口；已有判断账本和导出保留原位，不自动迁移或删除。计划不保存 API 密钥；研究插件仅保存环境变量名。

验证使用虚构账户、来源响应和本地模型协议夹具，不向真实券商发送测试订单。未知发送必须查询原回执；无实盘盈利、零滑点或券商端 exactly-once 保证。
