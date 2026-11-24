# 流程导航参考

本页说明主 Agent 怎样用 `workflow_status`、`workflow_plan`、`workflow_step` 跟踪一次实质任务，以及业务插件怎样声明产物依赖工作流。三个工具只属于主 Agent。导航器记录主 Agent 写的待办，参照插件声明的工作流推荐接下来做什么；它不执行任何事，不授予权限，不代替业务插件自己的输入输出合同。

## 何时建立计划

| 情况 | 做法 |
| --- | --- |
| 目标与某个已声明工作流相符（如开发因子、开发策略） | 参考该工作流开立计划，把它的预设步骤编进待办 |
| 需要多个步骤或需要委派，但没有适用的已声明工作流 | 只写待办开立计划 |
| 日常问答、单步轻量请求 | 不建计划，直接完成 |

一个主会话同一时间只有一个活动计划。计划属于主 Agent：子 Agent 不调用这些工具，也不需要知道计划的存在。

## 待办与预设步骤

计划由你写的待办组成。待办是这次要完成的事，每条有名称（`step`）、标题和说明，用户的流程面板显示的就是它们。

插件声明的工作流是参考。它的预设步骤给出做法、所需输入、建议的能力和依赖关系。你把预设步骤编进待办：

- 一条待办可以包含几个预设步骤，也可以一个都不包含（如“向用户汇报结论”）。
- 一个预设步骤同时只能在一条未结束的待办里。
- 这次用不到的预设步骤可以不安排。依赖已齐的会在 `attention` 里提示，需要时再加进待办。
- 待办之间的先后由两样东西决定：`after` 写明的先后，以及所含预设步骤的依赖。依赖只用来推荐，不拦截。

因子开发的一种编排：

| 待办 | 标题 | 包含的预设步骤 |
| --- | --- | --- |
| `goal` | 明确研究目标 | `research_spec` |
| `prep` | 准备数据和搜索范围 | `data`、`search_space` |
| `make` | 提出并计算候选因子 | `propose`、`compute` |
| `check` | 检查合理性 | `sanity_check` |
| `evaluate` | 评价有效性和稳健性 | `effectiveness`、`robustness` |
| `redund` | 评价冗余度 | `redundancy` |
| `decide` | 决定是否采用 | `decide` |
| `tell` | 向用户汇报结论 | 无，`after: ["decide"]` |

`register`（登记合格因子）没有安排。决定采用后它的依赖会齐，那时流程提示会提醒。

## 三个工具

### workflow_status

读取当前位置，不改变计划。

| 参数 | 说明 |
| --- | --- |
| `full` | 可选。`true` 时另外返回已完成、已放弃、不需要的待办和全部产物；默认只返回可以做、进行中、等待和需要注意的内容。 |

没有活动计划时返回工作流目录：

```json
{
  "plan": null,
  "catalog": {
    "workflows": [
      {"id": "factor.development", "goal": "QualifiedFactor", "steps": 11, "plugin": "sesame/auto-factor-mining", "plugin_state": "discoverable", "loaded": false},
      {"id": "strategy.development", "goal": "ValidatedStrategy", "steps": 10, "plugin": "sesame/strategy-development", "plugin_state": "discoverable", "loaded": false, "fallbacks": ["factor.development"]}
    ],
    "entries": [
      {"capability": "sesame/investment-research#investment_research_analyze", "plugin": "sesame/investment-research", "plugin_state": "discoverable", "loaded": false}
    ]
  },
  "next": "没有活动计划。目标与上面某个工作流相符时，开立时传 workflow 参考它；都不适用时只写待办。所属插件未加载的先 plugin_read、plugin_load。"
}
```

`workflows` 是各插件声明的产物依赖工作流，可以作为计划的参考。`entries` 是各插件的工作流型能力入口（由插件自己的控制器执行），列出来是为了不漏看；需要时可以作为某条待办的执行方式。

有活动计划时返回流程提示（见下文）。如果发现带本计划标签的 Run 已经结束但对应待办还没上报，会在 `attention` 里指出。

### workflow_plan

开立、调整或关闭计划。

| 参数 | 用于 | 说明 |
| --- | --- | --- |
| `action` | 全部 | `open`、`revise`、`close`。 |
| `title` | open | 任务标题，1–120 字。 |
| `workflow` | open | 参考的已声明工作流 id。与 `steps` 至少传一个。 |
| `steps` | open、revise | 待办：`[{step, title, description, presets?, after?}]`。`open` 时按顺序写入；`revise` 时按 `step` 新增或替换，只能替换还没开始的或失败的待办。一个计划最多 20 条。 |
| `remove` | revise | 要移除的待办名。只能移除还没开始、也没有被别的待办 `after` 引用的。 |
| `have` | open、revise | 已经具备的输入和核对后可复用的产物，写法与工作流定义相同：`"InvestmentMandate"`、`"SanityResult:pass"`。只在参考了工作流时可用。 |
| `refs` | open、revise | 产物名 → 固定引用（Run id、成果引用、数据集 id、报告路径等，每项不超过 500 字符）。只放定位信息，不放正文。 |
| `conditions` | open、revise | 条件步骤的开关，如 `{"user_requests_report": true}`。键必须是参考工作流里出现过的条件。 |
| `supersede` | open | 已有活动计划时必须为 `true`，旧计划记为放弃。 |
| `outcome` | close | `completed` 或 `abandoned`。还有待办没有结束时只能是 `abandoned`。 |
| `note` | close、revise | 放弃时必填，说明原因。 |

待办的字段：

| 字段 | 说明 |
| --- | --- |
| `step` | 待办名：小写字母、数字、下划线，在计划内唯一。上报和 Run 标签都用它。 |
| `title` | 不超过 40 字的动宾短语，如“检查合理性”。 |
| `description` | 不超过 200 字：这条待办做什么、做到什么算完成。 |
| `presets` | 可选：包含的预设步骤名。 |
| `after` | 可选：必须先完成的待办名。 |

标题和说明显示在用户的流程面板上，写给用户看，不写待办名、产物标识和工具名。

工作流的外部输入（没有任何步骤产出的产物，如 `UserRequest`、`ResearchRequest`）要在 `have` 里声明。漏了不会报错，流程提示会指出缺哪一项。

### workflow_step

上报一条待办的进展，返回新的流程提示。

| 参数 | 说明 |
| --- | --- |
| `step` | 当前计划里的待办名。 |
| `status` | `started`、`done`、`failed`、`skipped`。 |
| `presets` | 这次实际完成了这条待办里的哪些预设步骤。`done` 时省略表示全部；`failed` 时省略表示都没完成。 |
| `produced` | 产出的产物及结果，如 `["SanityResult:fail"]`。只需列出要带结果的；工作流为某个产物声明了结果取值时，必须带上结果。 |
| `refs` | 产物名 → 固定引用。后续待办和短任务靠它拿到确切输入。 |
| `runs` | 补挂未携带标签的 Run id。 |
| `fallback` | 与 `failed` 一起使用：这条待办里某个预设步骤声明的回退工作流 id。 |
| `gap` | 与 `fallback` 一起使用：交给回退工作流的缺口产物，必须是回退工作流的外部输入。 |
| `note` | 显示在用户的流程面板上。`done` 时可以写一句结果；`failed`、`skipped` 时必填，写原因。 |

主 Agent 自己执行时可上报 `started`。带标签的 Run 由宿主自动登记开始和结束。

## 流程提示怎么读

三个工具返回同一种结构。下面是上例中 `make` 完成后的返回：

```json
{
  "accepted": true,
  "plan": {"id": "p4k7m2x9qa", "title": "BTC 4h 动量因子开发", "workflow": "factor.development", "goal": "QualifiedFactor", "status": "active", "progress": {"done": 3, "total": 8}},
  "ready": [
    {
      "step": "check", "title": "检查合理性", "description": "检查因子值的缺失、未来数据和计算异常，给出通过或未通过。",
      "iteration": 0, "task": {"step": "check"},
      "presets": [
        {"step": "sanity_check", "title": "合理性检查", "hint": "检查缺失值、未来函数与计算异常。",
         "inputs": ["FactorExpression", "FactorValues", "ResearchData"], "refs": {"FactorValues": "run_7b1e…:valuesRef"},
         "produces": ["SanityResult"], "outcomes": {"SanityResult": ["pass", "fail"]}}
      ]
    },
    {
      "step": "redund", "title": "评价冗余度", "description": "和因子库里已有的因子比较相关性，判断是否重复。",
      "iteration": 0, "task": {"step": "redund"},
      "presets": [
        {"step": "redundancy", "title": "冗余度评价", "inputs": ["FactorValues"],
         "uses": [{"id": "sesame/auto-factor-mining:tool/factor_library", "available": true, "loaded": true}], "produces": ["RedundancyEvidence"]}
      ]
    }
  ],
  "running": [],
  "waiting": [
    {"step": "evaluate", "title": "评价有效性和稳健性", "missing": ["SanityResult:pass"], "reason": "等待 检查合理性（check）"},
    {"step": "decide", "title": "决定是否采用", "missing": ["SanityResult"], "reason": "等待 检查合理性（check）"},
    {"step": "tell", "title": "向用户汇报结论", "reason": "等待 决定是否采用（decide）"}
  ],
  "reference": {
    "workflow": {"id": "factor.development", "title": "因子开发"},
    "unarranged": [
      {"step": "register", "title": "登记合格因子", "ready": false,
       "inputs": ["FactorDecision:accept", "FactorExpression", "EffectivenessEvidence", "RobustnessEvidence"], "produces": ["QualifiedFactor"]}
    ]
  },
  "attention": [],
  "next": "检查合理性（check）、评价冗余度（redund）互不依赖，可以并行，完成后分别上报。"
}
```

| 字段 | 含义 |
| --- | --- |
| `accepted` | 本次调用是否改变了计划。`false` 时同时有 `error`。 |
| `plan.status` | `active` 进行中（包括需要安排预设步骤）；`needs_input` 缺外部输入；`blocked` 目标暂不可达；`completed` 完成；`abandoned` 已放弃。 |
| `plan.progress` | 已完成的待办数和待办总数，不含已放弃和不需要的。 |
| `plan.parent` | 仅回退计划有：它是为哪个计划的哪条待办开立的。 |
| `ready` | 现在可以做的待办。同时出现的互不依赖，可以并行。 |
| `ready[].task` | 用 Run 执行这条待办时原样传入的标签。 |
| `ready[].presets` | 这条待办里还没完成的预设步骤，按依赖顺序排列。 |
| `ready[].presets[].inputs` / `refs` | 需要的产物和已登记的引用，写任务说明时直接使用。 |
| `ready[].presets[].uses` | 工作流声明的元素 ID 及其当前可用、加载状态。 |
| `ready[].presets[].produces` | 完成时产出的产物。 |
| `ready[].presets[].outcomes` | 仅当产物声明了结果取值时出现；上报时必须从中选一个。 |
| `ready[].presets[].hint` | 工作流作者对这一步的提示。 |
| `running` | 已上报开始、尚未上报结束的待办及其 Run。 |
| `waiting` | 还不能开始的待办、缺的产物和原因。 |
| `failed` | 失败后可重试的待办。 |
| `reference` | 参考的工作流，以及其中还没安排、仍在通往目标路径上的预设步骤。`ready: true` 表示依赖已齐。没有参考工作流时省略。 |
| `attention` | 需要处理的情况：有依赖已齐但没安排的预设步骤、缺外部输入、插件未加载、Run 已结束未上报、目标被阻断及可重做的待办等。 |
| `next` | 一句话的下一步。 |
| `error` | `{code, message, fix}`。出错时流程提示照常返回，按 `fix` 处理后继续。 |

`iteration` 从 0 开始，同一条待办每重做或重试一次加 1。

句子里的待办和预设步骤写成“标题（标识）”，如“检查合理性（check）”；产物和结果写标识。调用工具时用括号里的标识。向用户说明进度时用待办的标题和说明，不念待办名、产物标识和 Run 编号。

## 一次完整过程

以因子开发为例。先看目录，再参考工作流写待办开立：

```json
workflow_plan({"action": "open", "title": "BTC 4h 动量因子开发", "workflow": "factor.development", "have": ["ResearchRequest"], "steps": [
  {"step": "goal", "title": "明确研究目标", "description": "确定品种、周期、因子方向和评价方案。", "presets": ["research_spec"]},
  {"step": "prep", "title": "准备数据和搜索范围", "description": "取得研究数据，划定候选公式的搜索范围。", "presets": ["data", "search_space"]},
  {"step": "make", "title": "提出并计算候选因子", "description": "提出候选公式，并在研究数据上算出因子值。", "presets": ["propose", "compute"]},
  {"step": "check", "title": "检查合理性", "description": "检查因子值的缺失、未来数据和计算异常，给出通过或未通过。", "presets": ["sanity_check"]},
  {"step": "evaluate", "title": "评价有效性和稳健性", "description": "按评价方案检验因子的解释力，以及换时段、换参数后是否仍然成立。", "presets": ["effectiveness", "robustness"]},
  {"step": "redund", "title": "评价冗余度", "description": "和因子库里已有的因子比较相关性，判断是否重复。", "presets": ["redundancy"]},
  {"step": "decide", "title": "决定是否采用", "description": "综合各项证据，决定采用、修改或放弃。", "presets": ["decide"]},
  {"step": "tell", "title": "向用户汇报结论", "description": "向用户说明结论、主要证据和下一步建议。", "after": ["decide"]}
]})
```

返回的 `ready` 只有 `goal`。完成后上报：

```json
workflow_step({"step": "goal", "status": "done", "refs": {"FactorSpec": "factor-mining/btc-momentum/spec.md", "EvaluationProtocol": "factor-mining/btc-momentum/protocol.md"}})
```

之后是 `prep`、`make`，再到同时可以做的 `check` 与 `redund`。检查未通过时如实上报：

```json
workflow_step({"step": "check", "status": "done", "produced": ["SanityResult:fail"], "note": "有 3% 的时点用到了未来数据"})
```

此时 `evaluate` 等待，原因是检查结果不符；`decide` 可以开始。上报 `FactorDecision:revise` 后，`tell` 可以开始，`attention` 说明 `register` 需要 `FactorDecision:accept`，并列出可重做的待办；`tell` 也完成后，`plan.status` 为 `blocked`。决定换一个公式时：

```json
workflow_step({"step": "make", "status": "started"})
```

`make` 进入第 1 轮。它产出新的 `FactorExpression` 后，依赖旧公式的产物失效，用过它们的已完成待办（`check`、`redund`、`decide` 等）回到待办，进入下一轮。

只完成一部分时用 `presets` 写明。例如 `evaluate` 只做完了有效性评价：

```json
workflow_step({"step": "evaluate", "status": "done", "presets": ["effectiveness"], "note": "稳健性检验需要另取一段数据，下一步再做"})
```

`robustness` 回到预设参考，`attention` 提示它依赖已齐、没有安排。需要时用 `revise` 加一条待办：

```json
workflow_plan({"action": "revise", "steps": [
  {"step": "robust", "title": "检验稳健性", "description": "在 2021–2022 年数据和三组参数上重复评价，看结论是否成立。", "presets": ["robustness"]}
]})
```

## 用 Run 执行待办：传入 task 标签

待办通过 Run 执行时，把 `ready[].task` 原样带上。宿主把它记在 Run 上，之后才能把这次执行的耗时、模型用量和工具调用准确归到这条待办。

委派子 Agent：

```json
{
  "title": "计算候选因子",
  "objective": "在 development 分区计算给定的 3 个公式，返回 valuesRef。",
  "instructions": "只完成这一项计算并返回结果引用。不评价因子，不开展其他工作。",
  "input": {"snapshotRef": "<ResearchData 的固定引用>", "formulas": "<FactorExpression 的固定引用>"},
  "plugins": ["sesame/auto-factor-mining"],
  "allowedCalls": [{"pluginId": "sesame/auto-factor-mining", "capabilityId": "factor_compute"}],
  "output": {"type": "none"},
  "_task": {"step": "make"}
}
```

直接调用会返回 Run 的业务能力：在该能力自己的参数之外加 `_task`。

```json
{"<该能力自己的参数>": "…", "_task": {"step": "make"}}
```

经 `host_capabilities_invoke` 调用：放在外层的 `task` 里。

```json
{"id": "sesame/auto-factor-mining#factor_compute", "input": {"<该能力自己的参数>": "…"}, "task": {"step": "make"}}
```

- `step` 使用当前计划的待办名，宿主自动补齐计划、工作流及轮次。
- 需要报告输出时与 `output` 合用：`_task: {"step": "make", "output": {"type": "report", "space": "research", "path": "factor-review.html"}}`。
- 只有会产生 Run 的调用接受 `_task`（工具说明里写明返回 Run）。即时返回结果的能力和主 Agent 自己完成的待办不需要标签，照常上报即可。

## 把待办交给子 Agent：短任务

子 Agent 拿到的是一件边界清楚的事，不是工作流：

- 写明这条待办的目标、可核验的完成判据、输入及其固定引用（来自 `ready[].presets[].refs`）、允许调用的能力、是否交付报告。
- `allowedCalls` 按这条待办实际要做的事来定。`uses` 里的能力是其中的核心部分，不是完整清单：读取输入、读取方法资料、写作和发布报告等所需的能力要另外授予，少给会让子 Agent 中途卡住。
- 不转交工作流定义、计划或流程提示，不要求它判断下一步做什么。
- 同一条待办同一时间只交给一个执行者。对进行中的待办再次上报 `started` 不会新开一轮，`attention` 会提示它已在进行以及关联的 Run。
- 一条待办的工作量大时，拆成互不重叠的几个短任务，由带标签的父 Run 组织，子 Run 继承标签。交回后汇总，上报一次 `done`。
- 子 Agent 交回后，主 Agent 读取同一 Run 的真实输出，核对后再上报。上报的结果和引用必须来自实际输出。

## 结果、失败、放弃与重做

- **结果**：工作流为某个产物声明了取值（如 `SanityResult` 为 `pass` / `fail`）时，上报必须带结果。下游只在结果符合其要求时可以开始。
- **失败**：`failed` 表示这次没有完成。待办留在 `failed` 里，下游继续等待。`presets` 列出的预设步骤照常记为完成。重试时再次上报 `started` 或直接上报 `done`。
- **放弃**：`skipped` 表示本计划不再做这条待办，其中还没完成的预设步骤一并放弃。只把它们当作可选依赖的待办可以继续；硬性依赖的待办和目标会变为不可达，`attention` 会说明。
- **不需要**：待办里还没完成的预设步骤都已不在通往目标的路径上时（例如决定放弃因子后的冗余度评价），这条待办变为不需要，不用再做，也不用上报。
- **重做**：对已完成的待办上报 `started` 开启新一轮。它的产物更新后，用过旧版本的下游产物失效，相应的已完成待办回到待办。
- **目标暂不可达**：`plan.status` 为 `blocked` 时，`attention` 给出阻断原因和可重做的待办。重做上游，或用 `workflow_plan` 的 `close` 如实结束。

依赖是推荐，不是闸门：每完成一条待办，流程提示会推荐依赖已齐的下一批。对还没被推荐的待办上报 `started` 或 `done` 也会照常记录，`attention` 列出缺什么，并把这条待办标记为偏离。先看缺的是什么：确实需要就先补上；确有理由不需要（例如产物已从别处取得）就在 `note` 里写明后继续。

## 回退工作流

待办里的预设步骤声明了 `fallback` 而自身无法完成时，进入回退计划。例如策略开发中包含 `factors` 的待办找不到合格因子：

```json
workflow_step({"step": "pick_factors", "status": "failed", "fallback": "sesame/auto-factor-mining:factor.development", "gap": "StrategyFactorGap", "note": "因子库没有适用于 4h 周期的动量类合格因子", "refs": {"StrategyFactorGap": "strategy/btc-trend/factor-gap.md"}})
```

返回的是回退计划的流程提示（`plan.parent` 指向原计划的这条待办）。回退计划参考回退工作流，开立时没有待办，按 `reference` 写好再继续。在回退计划完成或关闭之前，三个工具都作用于它。它完成后自动回到原计划，原来的待办进入下一轮。

## 条件步骤与复用

- 带条件的预设步骤（如 `report`，条件 `user_requests_report`）只有在 `conditions` 里设为 `true` 时才计入计划，也才能放进待办。用户中途提出要求时用 `workflow_plan({"action": "revise", "conditions": {"user_requests_report": true}, "steps": [...]})`；已完成的计划也可以这样重新打开。
- 复用已有产物时，先核对品种、周期、数据版本和评价证据是否仍然适用，再在 `have` 中声明并给出 `refs`。被复用产物的生产步骤不再需要执行，只包含这些步骤的待办变为不需要。

## 不参考工作流的计划

没有适用的已声明工作流时，只写待办，用 `after` 排先后：

```json
workflow_plan({"action": "open", "title": "黄金周度复盘", "steps": [
  {"step": "collect", "title": "取行情与事件", "description": "取本周黄金行情和影响它的主要事件，整理成后面两项分析共用的材料。"},
  {"step": "structure", "title": "分析价格结构", "description": "判断本周的趋势、关键价位和波动变化。", "after": ["collect"]},
  {"step": "events", "title": "分析事件影响", "description": "逐个说明主要事件对价格的影响方向和持续时间。", "after": ["collect"]},
  {"step": "report", "title": "综合并发布报告", "description": "把两项分析合成一份周度复盘报告并发布。", "after": ["structure", "events"]}
]})
```

`after` 里的待办完成后这条才可以开始。这类计划不能使用 `presets`、`have` 和 `conditions`，标签中的工作流 id 为 `adhoc`。

## 关闭与取代

- 待办都已完成，并且参考工作流的目标已经达成（没有参考工作流时不看目标），计划自动完成。
- 只做工作流的一部分时，做完后用 `workflow_plan({"action": "close", "outcome": "completed"})` 结束。
- 中途改变目标或放弃：`workflow_plan({"action": "close", "outcome": "abandoned", "note": "…"})`。
- 已有活动计划时开立新计划，需要 `supersede: true`；旧计划记为放弃。

## 出错时

出错的调用不改变计划，流程提示照常返回。

| `error.code` | 含义与处理 |
| --- | --- |
| `no_active_plan` | 还没有计划。先 `workflow_status` 看目录，再 `workflow_plan` 开立。 |
| `plan_active` | 已有活动计划。继续它，或带 `supersede: true` 开立新计划。 |
| `open_requires_one` | 开立时 `workflow` 和 `steps` 都没传。 |
| `unknown_workflow` | 没有这个工作流 id。返回里附目录。 |
| `plugin_unavailable` | 工作流所属插件被禁用或加载失败。 |
| `invalid_plan` | 待办重名、`after` 引用了不存在的待办或成环、要移除的待办还被引用、超过 20 条。 |
| `no_reference` | 计划没有参考工作流，却用了 `presets`、`have` 或 `conditions`。 |
| `unknown_preset` | 预设步骤名不在参考工作流里，或上报时不在这条待办里。`fix` 给出最接近的名称。 |
| `preset_taken` | 这个预设步骤已在另一条未结束的待办里。 |
| `preset_inactive` | 这个预设步骤的条件没有打开。 |
| `todo_locked` | 待办已开始或已完成，不能替换或移除。要再做一次就上报 `started`。 |
| `unknown_step` | 当前计划没有这条待办。`fix` 给出最接近的名称。 |
| `already_done` | 待办已完成。要重做先上报 `started`。 |
| `step_skipped` | 待办或预设步骤已放弃，本计划不再执行它。 |
| `unknown_artifact` | 产物名不属于这次完成的预设步骤或参考工作流。 |
| `outcome_required` / `invalid_outcome` | 这个产物必须带结果，或结果不在声明的取值内。`fix` 列出允许值。 |
| `note_required` | `failed`、`skipped`、放弃计划时需要说明原因。 |
| `close_incomplete` | 还有待办没有结束，不能以 `completed` 关闭。 |
| `run_not_found` / `run_foreign` | Run id 不存在，或不属于本会话。 |
| `run_unsettled` | Run 还在运行或处于中断。等它结束或先恢复，再上报。 |
| `fallback_undeclared` / `gap_invalid` | 待办里没有预设步骤声明这个回退工作流，或缺口不是回退工作流的外部输入。 |
| `unknown_condition` | 条件名不在参考工作流的声明里。 |
| `not_main_agent` | 只有主 Agent 可以使用流程导航。 |

## 业务插件如何声明工作流

每个工作流保存为独立的 `workflows/<id>.yaml`，宿主安装时读取和校验。跨包回退写完整标识，产物来源在 imports 声明。

```yaml
workflow: factor.development        # 工作流 id
goal: EffectivenessEvidence         # 目标产物
artifacts:
  SanityResult: {outcomes: [pass, fail]}
steps:
  compute:
    title: 计算因子
    requires: [FactorExpression, ResearchData]
    uses: [tool/factor_compute]
    produces: [FactorValues]
  effectiveness:
    title: 评价有效性
    requires: [FactorValues, "SanityResult:pass"]
    produces: [EffectivenessEvidence]
```

| 键 | 含义 |
| --- | --- |
| `requires` | 全部满足才就绪。`"Name:outcome"` 要求该产物的结果为指定值。 |
| `requires_any` | 至少满足一项。 |
| `requires_if_valid` | 仅当本步骤 `requires` 里的产物都有效时才要求（有效指其结果没有违背工作流里对它的任何限定要求）。生产步骤已被放弃的条目不再要求。 |
| `uses` / `uses_any` | 这一步用到的元素 ID；`uses_any` 表示任选其一。 |
| `produces` | 这一步的产物。每个产物只能有一个生产步骤。 |
| `fallback` | 这一步无法完成时可以转入的工作流 id。 |
| `when` | 条件名。只有开立或调整计划时把它设为真，这一步才计入计划。 |

- 这些步骤是给主 Agent 的参考。主 Agent 按任务把它们编进自己写的待办，一条待办可以包含几个步骤；步骤的 `title`、`hint` 和依赖会出现在流程提示里。
- 没有步骤产出的产物是外部输入，由主 Agent 在 `have` 中声明。
- 依赖关系不能成环；回退关系也不能成环。
- 用 title 给步骤命名，用 hint 写提示，用顶层 description 描述工作流。
- 只写真实的依赖，不写固定顺序：前置产物齐全即可执行，能并行的步骤自然会同时就绪。
- 在插件的描述和 `instructions.md` 里写明工作流 id，方便主 Agent 在插件清单里看到。

## 导航器不做的事

- 不执行任何待办，不启动 Agent、Run 或业务工作流。
- 不替主 Agent 写待办，也不要求预设步骤全部安排。
- 不授予工具、数据或交易权限。
- 不校验产物内容，只记录主 Agent 上报的结果和引用；结果的真实性由主 Agent 依据实际 Run 输出负责。
- 不代替业务插件的参数合同、评价标准和报告交付要求。
