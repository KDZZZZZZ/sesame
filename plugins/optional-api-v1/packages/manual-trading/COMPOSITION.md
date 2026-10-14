# 工作流组合协议

工作流通过现有 `host.tools.call` 调用已选择能力，不定义后端枚举、安装依赖或账户配置。调用发生在当前 Agent 工具内；调度服务不会冒充 Agent 调用。

## 选择与冻结

计划 `execution` 为 `{plugin_id,context_tool,apply_tool,arguments?}`。arguments 是能力配置返回的 JSON 绑定参数，不能包含 `action/run/history_days`，最多 4KB。所选插件及工具依赖必须已加载，缺失时返回前置条件错误。插件身份/摘要、账户、单位和调用参数均冻结在计划中。

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

经理提交目标后，执行角色调用 `manual_trading_apply`；该工具向选中的 apply 工具传递 `{...arguments,run:{id,plan:{id,account,ownerConversationId,slippageBps},decision,decidedAt}}`。执行实现核验当前活跃任务、冻结绑定/账户、executor 角色，以及 `host.tools.invocation()` 的真实祖先调用链。模型直接调用 apply 或底层写工具缺少工作流祖先，必须被拒绝。宿主不向插件暴露可伪造 token。

执行返回结构化回执 `{status,orders:[],pauses:[],...}`，可以包含 after、targetReached 和错误。实现持久保存每笔操作的 ID、进度与未知结果，重复请求不得重复发送。工作流只归档真实回执，不转换数量、不推导成交，也不假装取消能撤销已发送操作。

## 研究组合

`research:{plugins:[...],tools?:[...]}` 接受任意可委派插件，含无工具的技能包。未传 tools 时使用所选插件的 delegatable_tools，传入时仅允许精确子集。角色通过 Agent 请求的 plugins 和 tools 挂载固定版本。研究/决策、执行、总结各自持有本阶段工具，main-only 工具不能被借用。调用者负责选需要的能力，不要求同类型插件全部装上。

每个角色的研究与执行依赖合并去重后，最多 32 个插件、64 个工具；保存计划和提交任务时都检查，超出需缩小本轮选择。
