# Research 工作流

首选investment_research_start。详见[步骤与报告场景](WORKFLOW.md)。默认实际执行需求范围、取证、分析、综合报告四阶段；旧analyze的八成员默认保留给兼容调用。report_brief记录用户所需结果形式和调整，具体方法选择独立。

# 投资研究工作流

## 固定事件与结果对齐（不调用模型）

`investment_research_event_outcomes` 是可独立使用的确定性数据衔接能力，不要求运行团队工作流。输入必须是两个完整固定 DataRef；它不会获取新闻、搜索相似事件或选择指标。来源插件与方法自由组合，Report 只消费已形成的结果。

```json
{
  "events_ref": {"id":"实际事件工件 ID","revision":"实际修订","digest":"sha256:实际哈希","kind":"data","schemaVersion":"1.0.0"},
  "market_ref": {"id":"实际行情工件 ID","revision":"实际修订","digest":"sha256:实际哈希","kind":"data","schemaVersion":"1.0.0"},
  "selection":"调用者已选定的事件总体与筛选口径；不能把本次登记称为事前注册",
  "price_basis":"上游明确的 USD、拆股调整收盘价；不含股息再投资",
  "price_time_semantics":"closed_bar_close",
  "as_of":"2026-10-28T12:00:00Z",
  "anchor":"event_at",
  "entry":"last_at_or_before",
  "tolerance_seconds":3600,
  "windows":[{"id":"one_day","seconds":86400}],
  "baseline":{"kind":"instrument","instrument":"调用者选定的基准品种"}
}
```

示例里的 DataRef 是接口占位，实际调用必须使用生产者返回的完整引用，不得编造。固定工件需采用 `json-rows`，事件最多 256 行，行情最多 50,000 行，每份最多 8 MiB；窗口 1–8 个，每个 1 秒至 31 天，对齐容差 0 至 7 天。超限报错，不截断后冒充完整。

| 输入行 | 字段与语义 |
| --- | --- |
| 事件 | `event_id` 唯一字符串、`instrument`、`event_at`；可选 `published_at`、`first_available_at`、`retrieved_at`、`source_url` |
| 行情 | `instrument`、`observed_at`、`close`、`unit`；可选 `available_at`，表示该价格观察的声明可用时间 |

所有时间必须为带明确时区的 ISO 时间。价格时间应是**已经收盘的 bar 的结束时刻**（`closed_bar_close`），或明确的价格观察时刻（`price_observation`）；K 线开盘时间不能直接搭配该根尚未出现的收盘价。可用 `fields.market.time` 显式指定原数据的实际收盘时间列。其他列可通过 `fields.events`、`fields.market` 映射简单平面列名；嵌套原始来源先规范为另一份带原引用依赖的固定工件。市场行的重复品种/时间会被拒绝，不能静默任选后来的修订。

`anchor` 显式选择 `event_at` 或 `first_available_at`；缺少后者时保留 `anchor_availability_unknown`，不会用发布时间或当前获取时间代填。入点选择 `last_at_or_before` 或 `first_at_or_after`，出点始终取锚点加窗口秒数之后的首个观察，均受容差约束。窗口是日历秒数，不能解释为交易日数；实际端点另行返回。`as_of` 之后的价格观察或声明可用时间被排除，未走完的窗口标 `pending`。不填补交易日、休市或缺失行情。

收益为 `exit / entry - 1`，单位明确为 fraction；零、负、缺失价格及单位变化保留为缺口。它是输入价格口径的描述性收益，未加入手续费、滑点、汇率转换、股息再投资或因果识别。基准可明确为 `none`，或同一行情工件内的一个品种；后者必须拥有与目标**完全相同的实际首尾时间**，否则保留缺失，不能悄悄错时比较。基准差为两者收益相减，不是统计显著性。

结果 `result_ref` 包含一行完整 packet：原始参数、输入来源元数据、逐事件/窗口的源行号、来源 refs、时间、首尾价格、收益、基准、缺失、重叠事件 ID。相同输入重复计算的 packet 完全一致；返回的 `counts` 只是行数清点。同品种相交窗口标记重叠；同事件多个期限也不独立。不会生成胜率、置信度、独立样本数或预测概率。

发布时间、首次可用声明、本次获取时间分别保存。今天下载的旧新闻保留 `retrieved_after_event`，不能冒充当时已知。即使提供 `first_available_at`，这里只标 `declared_not_verified`；本能力不鉴定存档真实性或历史数据修订版本，全部样本 `eligible_for_point_in_time_validation:false`、`point_in_time_status:not_established`。可做回顾性描述，不能据此宣称完成 PIT 回测。固定引用证明本次输入身份，不单独证明历史可得性。

事件选择与基准由调用者决定，应先固定定义再进行独立历史检索；本能力不筛样本，也不替代同品种近期优先的检索过程。`no_events` 只表示传入事件为空，不代表搜索成功后的零匹配，更不能把检索失败当零样本。多重搜索、筛选与重叠带来的偏差须在研究解释中保留。

版本 3.2.0，宿主 API 2。输入投资问题，组合明确的信息来源与分析方法，输出可继续使用的固定研究成果。无需交易账户，不创建目标仓位、订单或计划。交易决策和实际执行分别使用相应独立插件。

## 能力与输入

可选 `workflow` 是本次实际执行计划，省略时沿用原八成员流程。例如只研究基本面、核查替代解释，再由指定综合者交付：

```json
{"workflow":{"stages":[[{"id":"facts","role":"fundamentals"}],[{"id":"challenge","role":"custom","instructions":"检验最强替代解释及其证据。"}],[{"id":"editor","role":"manager"}]],"synthesis":"editor"}}
```

`stages` 依次执行，同一阶段并行；最多 32 个唯一成员。成员含 `id`、现有角色名或 `custom` 的 `role`、可选 `title/instructions`，custom 必须给职责。最后阶段只能有 `synthesis` 指定的成员，只有该成员获得请求的报告权限。`agent_models` 按实际成员 ID 覆盖模型。自定义流程的问答只面向已完成的前序成员，使用交接中 `qa_context.members` 的准确 ID，不能提问已省略的角色。宿主自动据此生成协作图，无需另填 `task.collaboration`。

计划随原生 Run 断点和最终固定成果保存；恢复不改变成员、顺序或已接受请求。自定义 `start_from.role` 是实际成员 ID，省略新 workflow 时继承原结果的计划；保留前缀的职责或依赖发生变化则必须新开研究。自定义流程需要支持 `execution.setCollaboration` 的宿主，缺接口时明确中断，默认流程兼容旧接口。来源范围、真实证据、幂等恢复、报告实际渲染要求仍生效。

注册两个公开工作流和一个团队内问答能力，不复制宿主 Run 控制接口：

| 能力 | 输入 | 成果 |
| --- | --- | --- |
| `investment_research_analyze` | 必填 `title`、`question`、`subjects:string[]`、`research:{plugins:string[],tools?:string[]}`、`model:{provider,id}`；可选 `workflow`、`as_of`、`horizon`、`evidence_refs:DataRef[]`、`agent_models` | 按实际计划研究和综合；固定 `result_ref`、Markdown `summary`、可选 `report_ref` |
| `investment_research_report` | `result_ref:DataRef`、`model:{provider,id}` | 仅一个经理消费既有完整成果，重新制作图表报告；返回原 `result_ref` 和新 `report_ref` |
| `investment_research_ask` | 后续成员调用 `{analyst,question}`；默认可问四研究员，自定义时仅可问实际已完成的前序成员 ID | 后台 Run，输出 `{from,to,question,markdown,run_ref,source_refs}`；原成员定向核查并返回完整 Markdown |

模型与逐角色模型取自宿主已配置模型目录，插件不接收模型密钥。`agent_models` 以实际成员 ID 为键，默认是 market、fundamentals、news、sentiment、bull、bear、risk、manager，省略时继承 model。自定义成员 ID 不能使用 constructor、toString 等继承字典属性名。`as_of` 建议用明确 UTC ISO 时间，省略为本轮启动时点，约束证据发布或观测时点，不要求已存在启动前采集的缓存。当前研究可启动后自行采集并记录真实获取时间；用户要求历史回测或当时可知版本时，另行核验数据版本，不能使用后续修订假装当时已知。`horizon` 是研究期限，不是调度频率。

`research.plugins` 明确选择来源、计算或知识方法；`tools` 推荐精确 `pluginId#capabilityId`，唯一短名也可用。省略 tools 时仅选可委派的研究函数，剔除声明交易、配置、进程、编辑工作区和工作流控制副作用的能力；显式列入这些能力会在启动成员前暂停并指出具体能力。`tools:[]` 只授予知识。工作流不安装、切换或配置其他插件。

研究员可在这次已授予的能力中自行选择适合问题的来源，仍须遵守用户指定的更窄限制。某一个可选提供方未配置，不自动变成本角色或整队的必需依赖；只有必要证据无法由已授权能力获得时才暂停，不能扩大来源权限或混淆不同样本代表的群体。

每个成员直接收到已有证据与前序成员完整 Markdown。较大交接保存为固定数据引用，按宿主资源分页读取，不截断后冒充完整。选定知识方法通过 plugin_read 读公开正文；只读研究可以保存缓存和证据 artifact，但不能借此调用真实账户执行。

所有研究员、多空、风险和经理共用分析与行文规范，定向核查和仅重做报告的经理同样适用。规范约束成果质量，不规定工具顺序、特定信源、指标、案例、固定章节或讨论次数：

- 围绕本角色问题形成范围明确的主判断，区分事实、解释、预测与建议；保留时间、口径、基准和覆盖差异。
- 解释证据如何通过行为、约束、传导和反馈影响目标结果，考虑强度、范围、持续性与时滞；理论给出适用条件和可检验含义，不以名称或权威替代验证。
- 按关键争议选择横向、历史比较或可靠研究。比较交代机制可比性、关键差异、反例和样本限制，避免结果倒推样本、重叠样本重复计数和仅凭图形相似外推。
- 检验最有力的替代解释，优先补能改变判断的证据；同源指标、转述和角色赞同不算独立支持。
- 主判断解释研究期限内何者占主导，方向与置信程度分开。证据不足时缩小命题；无法判断方向不等于预计稳定或震荡，不用机械抵消或无穷条件分支代替判断。
- 正文先呈现主判断，再按关键理由自然连接证据、论证依据与含义；图表回答明确问题，重要反证和更新条件融入相应论点，经理综合而不拼接成员全文。

多头、空头、风险和经理发现答案可能改变判断的证据冲突、机制缺口、预期基线或口径问题时，可使用 `investment_research_ask` 向对应研究员提问。模型只需选择研究员并描述具体问题；宿主从冻结的调用上下文沿用本轮研究成果、模型和来源权限。工具返回 Run，等待完成后读取完整答复，再决定是否追问；没有固定讨论轮数，不以取得共识作为结束条件。把缺口作为主判断或置信度的主要限制时，应有实际核查记录或明确的能力/覆盖限制。原研究员仍有适用能力且尚未核查的关键缺口应定向补问，不能把继承的未知视为不可取得；已有失败且无新路径则不重复请求，非关键缺口不为完整而补齐。独立问题可分别交给合适研究员，串行追问会带上已完成问答。答案不会隐式扩大来源权限，回答者没有递归问答能力。

已完成的原 Run 保持不变，定向核查是同一 `agentId` 下的新一轮 Agent Run，过程仍显示在原研究员节点。问答函数使用宿主检查点保存请求和已接受 Run；中断恢复不会重复派员。问题、回答、来源与 Run 引用完整保存为 `qa`，后续角色都能读取；经理自己提出的问答也保留在最终成果中；后续阶段会等待已接受的问答完成。最终报告仍只呈现经理综合，不拼接问答全文。

## 所需配置

| 配置 | 何时需要 | 缺失时 |
| --- | --- | --- |
| 已配置模型及身份凭据 | 两个入口均需要；从宿主模型目录选 provider/id | 不启动成员，原 Run 暂停 |
| 明确选择的来源与方法插件 | analyze 的 research 选择非空时 | 说明缺失插件/能力，暂停原 Run |
| `sesame/plugin-manager#plugin_read` | 使用任何知识/研究插件时，以及报告制作时 | 暂停，不能猜方法接口 |
| 来源凭据、套餐和覆盖 | 由本次选定来源能力声明；例如 financial-research 的 status/configure | 先使用其他已授权可用来源；必要证据仍无法获得时，受影响成员保留成果并暂停；已有价格不能代替缺失新闻 |
| `sesame/reports`、`sesame/data-access`、`sesame/workspace`、`sesame/plugin-manager` | 请求报告或 report 入口 | 在经理启动前核验；analyze 没有报告时不依赖前三者 |
| 完整固定研究成果与其来源 | report 入口 | 指明不可读引用；不会重新研究补造 |

无额外插件配置、API Key、交易账户或执行绑定。

## 原生 Run 与报告

调用 `host.capabilities.invoke('sesame/investment-research#investment_research_analyze', input, options)`，options.operationId 使用稳定业务操作 ID。返回原生 Run；状态、等待、中断、恢复、取消、打开过程全部使用宿主接口。

analyze 的声明提供默认八成员图。显式 workflow 由执行器在首个子 Run 前通过 `execution.setCollaboration` 冻结实际成员图；只有一名综合者时清除多成员图。单个成员的多次运行不新增身份，工具与阶段不是图节点。report 入口只包含原计划指定的综合者，不声明多 Agent 图。

请求用户报告时使用宿主选项：

```json
{"task":{"output":{"type":"report","space":"research","path":"投资研究/AAPL.html"}}}
```

普通 analyze 默认无报告。报告经理使用 `{type:"report",target:"parent"}` 发布到同一绑定；其他成员 output:none。经理得到 reports 设计知识、实际授予的报告内容/样式/发布/核验能力、data_read、read/write/edit 与 plugin_read，可通过原研究员补充关键证据；仅重做报告的入口消费已有成果。报告采用父工作流当前绑定的 artifact，且该精确修订最新 report_check 检查为 rendered；普通浏览器打开不代替验收。主 Agent 修复同一报告后，原 Run 可采用新修订继续，无需重派已完成经理。工作流不包一层纯文本 HTML、不复制所有成员正文。

报告阶段先调用 `host_reports_describe`，按宿主所选插件返回的 `inputSchema` 组织结果，再用 `host_reports_publish` 发布；宿主通用 envelope 使用 `operationId`、`title`、`summary`、`data`、`provenanceKind`、`references`，插件输入放 `input`，大型完整输入可先登记为固定 JSON 后使用 `inputRef:{ref,entry}`。`input` 与 `inputRef` 二选一，不把默认 Reports 的 content/style 当宿主通用格式，不自行改选 provider。仅当当前 provider 是 `sesame/reports` 且 schema 适用时，使用它的 `content` 与 `style`、字段/图表助手和通用样式；助手只预览。正文保留判断、读图注解、简短推理和关键条件，原始明细在末尾附录，公式交由所选插件的组件呈现。不能上传 HTML/CSS/脚本或以不匹配接口绕过当前选择。发布后核验精确 ref；检查失败保留该 ref 重试检查，不重新研究或重选结果。

暂停使用宿主 checkpoint 保存冻结请求、已接受子 Run 与完整成果。恢复重查当前需要的模型/插件/证据，只重新等待原已接受的子 Run；完成成员不重派。已发布报告不重做。未知原操作使用相同 operationId 和输入找回，不能换 ID 重付费或把未完成当完成。

## 可组合研究成果

`result_ref` 是 `kind:data/schemaVersion:1.0.0` 的不可变 json-rows artifact，rows.json 内只有一行：

```js
{
  schemaVersion: '1.0.0',
  type: 'sesame.investment-research.result',
  status: 'complete',
  title, question, subjects, as_of, horizon?, workflow?,
  members: [{role, markdown, run_ref: {id}, source_refs: [DataRef]}],
  qa: [{from, to, question, markdown, run_ref: {id}, qa_run_ref: {id}, source_refs: [DataRef]}],
  summary,
  source_refs: [DataRef],
  report_ref? // 仅作展示，不能替代上述研究产物
}
```

DataRef 完整包含 `{id,revision,digest,kind:"data",schemaVersion:"1.0.0"}`。source_refs 汇总传入证据、各成员和定向核查 Run 资源历史中的真实发布/工具返回引用；按分页读取，每个引用在冻结前核验可读，不依赖成员在最终文字里抄写 JSON。纯知识研究可没有外部数据引用。成员 Markdown 保留其方法、观察、因果解释、情景/反证、单位、时点和局限。完整原 Agent 记录同时固定为 resource，结果 data 依赖该原记录和 source_refs；模型结论不是无来源的市场观察。依赖引用保留原修订，演示来源传播 demo provenance。

下游交易决策读取此成果并结合最新账户和已确认风险规则，不把研究建议直接当订单；报告重生保持原 result_ref，不修改原研究包或证据时点。经理可以依据同一固定证据重新权衡和论证判断，不必沿用旧总结；报告开篇给出总观点，各小标题先说结论，正文说明证据如何支持、限定或挑战它。倾向与信心分别交代，“无法判断”同样需要证据和推导。

测试用例位于 `../../tests/investment-research.test.mjs`，真实宿主装载与确定性 Agent 协作位于 `../../tests/investment-research-host.test.mjs`，多轮问答、来源传递和成员聚合位于 `../../tests/investment-research-qa-host.test.mjs`。测试不接触券商或真实交易。

## 包内职责

功能分类为 research，实现类型为 workflow。公开入口仍是 index.js；能力声明、知识路径、固定成果格式和现有调用参数保持不变。

| 文件 | 职责 |
| --- | --- |
| index.js | 注册 analyze、report、ask 三个公开能力 |
| src/runtime.js | 研究与报告流程、检查点及原 Run 的恢复 |
| src/members.js | 成员输入、等待和完整结果交接 |
| src/composition.js | 选择明确能力与知识、验证插件及宿主模型依赖 |
| src/artifacts.js | 固定研究成果、来源引用和报告验收 |
| src/qa.js | 原研究员的定向问答、结果与来源汇总 |
| src/team.js | 成员角色、协作关系、最小权限和领域指令 |

模型配置继续来自宿主模型目录，按现有 model/agent_models 输入选择；本工作流不保存另一份模型密钥。所选来源能力的配置需求由其 configurationRequirements 绑定，统一入口显示和补齐；缺失依赖仍走同一 Run 的暂停/恢复，不把字段已配置当成研究或外部调用已成功。

## 从指定进度重跑

已有完整 `result_ref` 时，使用同一 analyze 入口传入 `{start_from:{result_ref,role},research,model}`。role 是第一个重跑的角色：bull、bear、risk 或 manager；从多空完成后继续使用 risk。原标题、问题、对象、证据截止时点、期限及输入证据自动继承，不必重复填写。新工作的来源与模型由 research/model 明确选择。

早于起点的成员全文、Run 引用及其问答原样保留，起点及以后的旧结论和问答不交回上游。执行剩余角色时仍可按需向原研究员 QA，新增证据进入后续角色和新结果。新原生工作流与报告保留 `start_from` 来源记录，不改写已完成的原工作流、固定成果和旧报告；它的暂停/恢复仍使用普通宿主 Run 接口。只改排版行文而不补研究时，继续使用 report 入口。

## 可选历史证据计算

可显式选择独立 `sesame/historical-evidence` 做历史同类情景匹配与isotonic校准；四阶段支持固定输入refs交接，方法不进入Report。用户优先选择条件、特征和阈值，已知有效/失效条件可以支持条件使用，不要求所有检验同时通过。实际权限、固定输入与独立评价见 [HISTORY.md](HISTORY.md)。
