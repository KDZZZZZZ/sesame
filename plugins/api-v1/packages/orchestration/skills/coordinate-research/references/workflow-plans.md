# 工作流计划与可调整阶段

当前可调整的实际入口：

| 工作流 | 可调整内容与边界 |
| --- | --- |
| Investment Research | workflow.stages 选择成员、角色、阶段顺序及并行组，可增 custom 角色；synthesis 指向最后阶段唯一综合成员。省略时沿用默认八成员；研究交付需绑定报告，由 synthesis 发布，内部成员不各自制作报告。 |
| Auto Factor Mining | config.workflow 指定假设、实现、评审、反思和选择的成员，同一人可兼任；plan/review/reflection 可显式设 null 跳过，省略字段则沿用默认角色。真实 evaluator、候选资格、固定选择和独立留出验证仍需满足。 |
| Trading Decision | plan.workflow.reviews 添加顺序复核；execute:false 只形成决策与报告。复核阻止时不能执行，复核成员无下单权限；原账户、授权和风险约束保持有效。 |

计划随受理的 Run 冻结，暂停/恢复沿用同一计划与已完成成果。改变计划需创建新一轮并明确复用哪些固定证据；不要改运行中身份、重放已完成外部动作，或用未声明的输入伪装成流程调整。因子与策略研究指南可用于设计其他流程，ICT 等专业知识只回答其中的具体问题。

## 自定义协作与业务工作流的选择

几个独立阶段由主 Agent 直接调用 `host_agent_run` 即可；如果希望一个独立协调者管理成员、收集结果并统一交付，可按下面示例创建带协作声明的 Agent Run。现成业务工作流已经有适合的控制逻辑时，优先使用后文列出的公开计划字段。

以下 JSON 是参数结构示例，`<...>` 要替换为真实输入。已有目标和输入可以直接组织执行，不要求用户先填写角色表。每个成员仍有独立 Run，协作关系不把所有成员变成一个 Run。

### 自定义协调者：host_capabilities_invoke

本例由协调 Agent 安排两个内部证据整理成员，取得结果后交给综合成员，再由协调 Agent 负责唯一的阶段报告。内部准备节点仅整理已提供材料；独立研究阶段仍应绑定报告。

```json
{
  "id": "host.agent.run",
  "input": {
    "title": "证据与替代解释协作",
    "objective": "围绕原问题核对已有证据与替代解释，交付一份综合研究报告。",
    "instructions": "你被明确分配为协调者，可以委派已声明成员。先并行安排 evidence 和 alternatives 整理给定材料；保存两个真实 Run 引用，等两者 completed 后把实际输出交给 review。成员调用使用对应 task.agentId；整理节点返回证据，不各建报告。取得综合结果后由你实际编写、发布并核验本任务报告。缺少业务能力时向所属主 Agent 报告具体需要，不给成员不存在或自己未获授予的工具。",
    "input": {"materials": "<真实固定材料及其来源>", "question": "<用户已经表达的问题>"},
    "allowedCalls": [
      {"pluginId": "host", "capabilityId": "agent.run"},
      {"pluginId": "host", "capabilityId": "capabilities.invoke"},
      {"pluginId": "sesame/plugin-manager", "capabilityId": "plugin_read"},
      {"pluginId": "sesame/reports", "capabilityId": "report_template"},
      {"pluginId": "sesame/reports", "capabilityId": "report_publish"},
      {"pluginId": "sesame/reports", "capabilityId": "report_check"},
      {"pluginId": "sesame/reports", "capabilityId": "report_read"},
      {"pluginId": "sesame/workspace", "capabilityId": "read"},
      {"pluginId": "sesame/workspace", "capabilityId": "write"},
      {"pluginId": "sesame/workspace", "capabilityId": "edit"}
    ],
    "output": {"type": "report", "space": "research", "path": "evidence-synthesis.html"}
  },
  "task": {
    "collaboration": {
      "agents": [
        {"id": "evidence", "title": "证据整理"},
        {"id": "alternatives", "title": "替代解释"},
        {"id": "review", "title": "综合复核"}
      ],
      "relationships": [
        {"from": "evidence", "to": "review"},
        {"from": "alternatives", "to": "review"}
      ]
    }
  }
}
```

`host#agent.run` 允许再次委派，`host#capabilities.invoke` 允许使用带 `task` 选项的包装调用；两个调用能力都需要授予。成员需要的方法知识和业务工具，也要先在协调者可用范围内，随后才可下传。根据实际任务添加数据、知识和计算能力；不要把这个只整理给定材料的示例当成完整数值研究的工具清单。

### 成员绑定：host_capabilities_invoke

由上面的协调 Agent 发起，不是主会话脱离该协调任务单独调用：

```json
{
  "id": "host.agent.run",
  "input": {
    "title": "证据整理",
    "objective": "整理给定材料中的来源、时点、支持证据和缺失项，返回给协调者。",
    "instructions": "这是综合报告的内部准备节点，只整理已给材料，不启动独立研究、不再次委派、不另建报告。返回实际摘取的事实和来源，不编造缺失信息。",
    "input": {"materials": "<从父任务传入的真实材料>"},
    "allowedCalls": [],
    "output": {"type": "none"}
  },
  "task": {"agentId": "evidence", "stage": "evidence", "iteration": 0}
}
```

其他成员采用其声明的稳定 ID；再次处理同一成员职责时复用该 ID，保留各次真实 Run。`task.agentId` 绑定最近的协作声明，`stage` 和 `iteration` 标识阶段与轮次。成员需要额外读取或计算时，显式授予协调者已经具有的相应工具。

**协作图不负责调度。** `task.collaboration.relationships` 只描述成员关系与可视化：不会创建成员、等待依赖或传递结果。协调者必须实际提交独立调用、等待前序 completed，并把真实输出传给后继。成员是承担任务的 Agent，不是工具调用、思考片段或一般处理步骤。给已有业务工作流换一张协作图，也不会改变其实际执行顺序。

如果改由某个成员发布共同报告，只有在其直接父 Run 已绑定报告时才可使用 `output:{type:"report",target:"parent"}`，并授予实际写作、发布和核验工具；指定唯一交付者，避免多个成员同时覆盖同一报告。主会话本身没有隐含父报告。

## 定制现成业务工作流

下面三个 JSON 都是完整启动参数中的局部计划片段，不包含模型、来源、账户、评估器等实例配置。先读取相应公开入口的实际 schema，用当前已配置且可用的真实引用补齐完整请求。

### Investment Research：workflow

公开入口：`sesame/investment-research#investment_research_analyze`。将下列对象放入启动参数的 `workflow`，把默认八人研究改为“数据与方法并行 → 综合”：

```json
{
  "stages": [
    [
      {"id": "facts", "role": "custom", "title": "数据核查", "instructions": "独立核对共享固定数据的来源、时间口径与缺失项，交回证据和影响判断的缺口。"},
      {"id": "method", "role": "custom", "title": "方法研究", "instructions": "独立使用共享固定输入与所选知识方法检验假设，交回支持、反证与待验证条件。"}
    ],
    [{"id": "editor", "role": "manager", "title": "研究综合"}]
  ],
  "synthesis": "editor"
}
```

- 同一阶段内并行，阶段之间串行。前提是 facts 与 method 都可独立使用共享固定输入；如果方法研究要等待数据核查取得数据，就把两者拆成连续阶段。
- 成员 ID 全计划唯一；自定义 ID 显式写 `role`，`role:"custom"` 必须写非空 `instructions`。最后阶段只包含 `synthesis` 指定的综合成员。
- 可选内置角色为 market、fundamentals、news、sentiment、bull、bear、risk、manager，也可自定义；不强制保留默认八人阵容。
- `research.plugins` 组合真实知识、方法和数据插件，`research.tools` 按合同限定可委派的读取能力。知识本身不增加工具；`research.tools:[]` 表示只提供知识。
- `model` / `agent_models` 使用实际模型目录返回的描述，成员模型可按自定义 ID 选择。报告放在宿主调用选项 `task.output`，不是 `workflow` 中，由指定综合成员交付。

### Auto Factor Mining：config.workflow

公开入口：`sesame/auto-factor-mining#auto_factor_start`。下列对象放入 `config.workflow`；本例省去单独规划和反思，让评审者兼任候选选择：

```json
{
  "plan": null,
  "hypothesis": {"id": "researcher"},
  "code": {"id": "builder"},
  "review": {"id": "reviewer"},
  "reflection": null,
  "selection": {"id": "reviewer"}
}
```

- 生命周期仍是插件实现的因子研究流程；这里分配人员与可选咨询步骤，不是任意重排执行程序。
- plan、review、reflection 可显式设 `null` 跳过；hypothesis、code、selection 不能设 `null`。同一个成员 ID 可兼任，所有未给出的步骤都沿用默认角色。
- `plan:null` 时直接采用 `config.directions`。方向是并行单位，`directions` 1–6 项、`parallelism` 1–3、`rounds` 1–10，按目标与资源设置。
- 关闭文字 review 不取消真实 evaluator、候选选择和留出验证。使用实际模型与 evaluator，并补齐它要求的数据、候选和评价参数；不能用编排文本冒充数值验证。
- `auto_factor_workflow` 是内部控制入口，Agent 使用公开的 `auto_factor_start`。

### Trading Decision：plan.workflow

先通过 `sesame/trading-decision#trading_decision_plan` 的 `action:"save"` 保存完整计划；下列对象位于 `plan.workflow`：

```json
{
  "reviews": [
    {"id": "evidence_check", "instructions": "核对固定研究证据与当前账户是否支持本次目标。"},
    {"id": "risk_check", "instructions": "检查适用风险规则与组合暴露。"}
  ],
  "execute": false
}
```

取得真实 `plan_id` 后，用 `sesame/trading-decision#trading_decision_run` 的 `plan_id/request_id` 启动。完整计划还需要真实模型、账户与执行绑定；示例仅展示编排片段。

- reviewers 按数组顺序逐个运行，随后是 manager 和可选 executor；不支持将 reviews 配成并行。成员 ID 唯一，不能占用 manager 或 executor。
- 复核成员只读，实际 block 会阻止执行器。`execute:false` 只形成决策与报告，不创建执行器或应用交易；没有设置时默认 execute 为 true，因此只研究的请求要显式使用 false。
- 研究成果通过固定 `research_refs` 输入；这里调整交易决策复核，不重新设计研究团队。账户、执行授权和风险约束不会因为自定义复核而改变。
- `trading_decision_workflow_execute` 是内部入口，不能替代公开 plan/run 流程。

## 何时实现新的工作流能力

临时拆分、并行、讨论与综合可以使用上述宿主 Agent 协作。需要发布一个可发现、可复用、具有固定输入输出合同的业务流程，或让程序负责确定性的依赖、分支、循环与检查点恢复时，再使用 `sesame/plugin-manager` 的开发指南新增或扩展工作流插件。

宿主具备已注册 graph 能力的执行器，但没有现成的 `host.graph`、`host.workflow.run` 或“提交任意图 JSON 即执行”的通用 Agent 工具。插件必须声明真实能力及其执行绑定；不要把测试样例注册的能力当作产品已有入口。原生控制器的 `execution.setCollaboration()` 也不是 Agent 工具。
