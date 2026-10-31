# 工作流组合协议

工作流通过现有 `host.capabilities.invoke` 调用已选择能力，不定义后端枚举、安装依赖或账户配置。调用发生在当前 Agent 工具内；调度服务不会冒充 Agent 调用。

`trading_decision_plan` / `trading_decision_run` 仅用于已授权交易决策。研究成果由独立工作流生成，通过完整 `research_refs` 传入；本插件不派发研究角色。模型、账户和风险配置见 README.md。

## 选择与冻结

计划 `execution` 为 `{plugin_id,context_tool,apply_tool,arguments?}`，使用执行实现的绑定能力返回的对象。不能根据相似工具名自行拼装。arguments 是能力配置返回的 JSON 绑定参数，不能包含 `action/run/history_days`，最多 4KB。所选插件及工具依赖必须已加载，缺失时返回前置条件错误。插件身份/摘要、账户、单位和调用参数均冻结在计划中。

已提供的独立实现是 `sesame/portfolio-execution`；其他声明同一契约的实现同样有效。其公开接口关系如下：

| 能力 | 输入 | 结果与用途 |
| --- | --- | --- |
| `portfolio_execution_configure` | `{backend:"mt5"}` 或 `{backend:"qmt"}`；可选稳定 `id` | 为已配置账户创建不可变绑定，返回 `{plugin_id:"sesame/portfolio-execution",context_tool:"portfolio_execution_context",apply_tool:"portfolio_execution_apply",arguments:{binding_id}}`，整个返回对象可作为计划的 `execution`。本操作不下单，也不配置或连接原生终端。 |
| `portfolio_execution_context` | `{binding_id,action:"identity"}` | 返回下述完整组合契约；`action:"snapshot"` 则返回同一账户的观察数据。 |
| `portfolio_execution_apply` | `{binding_id,run}` | 由工作流代码在受托执行调用链中传递冻结目标，返回真实执行回执。它不接受模型绕过工作流直接下单。 |

MT5 的 `mt5_trading_context({action:"identity"})` 只返回 `{account}`，`mt5_trading_order` 执行单笔原生命令，两者不构成上述目标仓位执行契约。不能通过给账户返回值补造 tools、quantityRules 等字段来改变它们的能力。

`plugin_discover({ids:["sesame/portfolio-execution"]})` 查询安装状态；`host.capabilities.list({pluginId:"sesame/portfolio-execution"})` 查询当前可用声明。缺少实现时，`plugin_catalog({plugin_id:"sesame/portfolio-execution"})` 返回可获取的发布目录信息；只能依据实际返回的包与权限使用公开安装/加载接口。目录没有可用版本时明确报告缺少执行能力，不要求 Agent 逆向插件代码。执行契约校验一次列出全部缺项和所选能力 ID，完整声明由实现负责。

context 工具收到 `{...arguments, action:"identity"}`，返回：

```json
{
  "account": {"accountId":"opaque-account", "revision":"opaque-revision"},
  "taskContext": {"bindingId":"opaque-binding"},
  "tools": ["chosen_context", "chosen_apply"],
  "readTools": ["chosen_context"],
  "quantityRules": {"unit":"contracts", "signed":true, "integer":true},
  "accountProvider": {"pluginId":"chosen/account", "providerId":"account"}
}
```

`tools` 包含完整嵌套调用所需工具，`readTools` 为只读子集，不能包含 apply。每个工具必须有唯一已安装且可委派的所有者。原生插件负责正确声明读写语义；此列表不构成对恶意原生代码的沙箱。`accountProvider` 可省略；省略时账户事件明确不可用，不猜测提供方。

可选 `fillSources:[{pluginId,provider}]` 指定该执行实现实际登记成交数据集时的宿主 producer 和准确 provider；pluginId 必须属于本次执行依赖。成交确认必须引用该 producer 直接登记的原始行，不能引用带 input_ids 的派生行；派生数据仍可用于观察。复盘同时核验来源、原生账户、时间、执行 ID 与正数成交量/价，不用报价或目标代替成交。未声明时不接受新的成交确认。

`action:"snapshot", history_days:30` 返回同一冻结账户、capturedAt、summary、positions/orders/fills/historicalOrders/deployments 数组和 historyCoverage。没有记录用空数组，来源不可用必须返回错误或明确覆盖缺口，不伪装完整快照。

## 受托执行

每个角色任务 input 包含 `execution:{pluginId,contextTool,applyTool,arguments,account,context,...}`、`tradingPlan:{id,ownerConversationId,account}`、runId、role。`context` 是 identity 返回的 taskContext，工作流不解释其后端内容。

经理提交目标后，执行角色调用 `trading_decision_apply`；该工具向选中的 apply 工具传递 `{...arguments,run:{id,plan:{id,account,ownerConversationId,slippageBps},decision,decidedAt}}`。执行实现核验当前活跃任务、冻结绑定/账户、executor 角色，以及 `executionContext.provenance.chain` 的真实祖先调用链。模型直接调用 apply 或底层写工具缺少工作流祖先，必须被拒绝。宿主不向插件暴露可伪造 token。

执行返回结构化回执 `{status,orders:[],pauses:[],...}`，可以包含 after、targetReached 和错误。实现持久保存每笔操作的 ID、进度与未知结果，重复请求不得重复发送。工作流只归档真实回执，不转换数量、不推导成交，也不假装取消能撤销已发送操作。

## 固定研究成果

计划 `research_refs` 只接受已有 `kind:"data"` ArtifactRef：`{id,revision,digest,kind,schemaVersion}`。例如 `investment_research_analyze` 返回的 `result_ref` 包含研究问题、时点、成员成果、经理综合和来源引用。经理通过 `data_read` 阅读，不重新选择来源或计算方法；必要缺口由主 Agent 交独立研究工作流解决。经理保存目标时核验并固定这些完整引用，保存在 decision.research_refs 中；结果正文和来源树已由资源系统冻结，不再复制到一份有大小限制的交易快照。

经理额外依赖 `sesame/memory` 与 `sesame/data-access`；执行员仅获得本插件 apply 入口，不继承数据读取或研究能力。主会话、经理、执行员的授权边界由真实宿主调用链校验，而不是提示词中的角色名称。
