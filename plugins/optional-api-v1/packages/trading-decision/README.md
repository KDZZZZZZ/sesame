# 交易决策

`sesame/trading-decision` 将已有固定研究成果、当前账户和用户风险规则转为目标仓位，并通过明确选择的执行能力取得真实回执。默认工作流是交易经理和执行员，可显式增加前置复核或只交付决策。它不获取新闻、重做研究；研究问题交给 `sesame/investment-research` 等独立工作流。

## 配置与输入

`trading_decision_plan` 的 `plan.workflow` 可为 `{"reviews":[{"id":"concentration","instructions":"核对集中风险和账户适用规则。"}],"execute":false}`。最多 12 位复核者按列出顺序执行，随后经理综合固定研究、完整复核文字和结构化结论；`agent_models` 可按复核者 ID 指定模型。复核者不能保存目标或下单，必须调用 `trading_decision_check({run_id,verdict:"allow"|"block",reason})` 保存自己的不可变结果。

`execute:false` 交付冻结决策与日报，不启动执行员；即使 owning main 直接调用 apply 也被拒绝。任一复核 `block` 同样阻止本轮执行，成果标明 `executionDisposition:withheld_by_review`；这不是成交或已实施风控。省略 workflow 保持原 manager→executor。原 Run 冻结计划及复核，重试不改结论；更改流程或复核需要新计划修订/新运行。账户、风险规则、数量约束、执行幂等与未知订单对账要求保持有效。

| 配置 | 输入与来源 | 缺失或变化时 |
| --- | --- | --- |
| 交易授权 | 用户明确允许的目标、账户、品种及限制写入 instructions；周期/事件计划须有相应持续授权 | 普通研究请求不授权交易或调度 |
| 模型 | `trading_decision_models` 返回配置后的 `{provider,id,configurationDigest}`；`model` 是默认值，`agent_models` 可指定 manager/executor 及实际复核者 ID | 未配置或模型版本改变时暂停原工作流 |
| 执行绑定 | `portfolio_execution_configure` 或符合 [COMPOSITION.md](COMPOSITION.md) 的实现返回 `{plugin_id,context_tool,apply_tool,arguments}`，整个对象作为 execution | 账户、终端及凭据由执行/原生插件配置；读取失败暂停，不伪装空账户 |
| 固定研究 | `research_refs:[{id,revision,digest,kind:"data",schemaVersion:"1.0.0"}]`，例如 `investment_research_analyze.result_ref` | 经理核对适用范围、时间和局限；必要证据不足则交主 Agent 补充研究。已授权降风险或平仓不需等待无关新研究 |
| 风险规则 | 启用 `sesame/memory`，经理读取 `memory_trading_context`/`memory_read` | 增加风险前核验已确认且适用于该账户的红线；偏好和策略认知不能代替红线 |
| 数据读取 | 启用 `sesame/data-access`，经理用 `data_read` 读取已有固定研究 | 缺少能力暂停原运行；本插件不存储任何 API Key，不自行选来源 |
| 调度 | 可选 `interval_minutes`、`event_keys`、`account_events`；默认不创建周期 | 保存 enabled=true 的已授权调度会产生后续交易轮；pause 取消未来/活跃决策，不能撤销成交 |

```json
{
  "action": "save",
  "plan": {
    "title": "已授权组合调整",
    "execution": {"plugin_id":"sesame/portfolio-execution","context_tool":"portfolio_execution_context","apply_tool":"portfolio_execution_apply","arguments":{"binding_id":"实际返回的绑定ID"}},
    "model": {"provider":"已配置供应商","id":"已配置模型"},
    "research_refs": [],
    "symbols": ["准确品种名"],
    "instructions": "用户允许的目标、账户与执行限制",
    "enabled": false
  }
}
```

`research_refs` 的空示例仅表示尚未选择成果，不提供任何研究依据；需要研究的目标应先取得真实 result_ref。不存在 mode、debate_rounds 或 research.plugins/tools 选项。数据引用必须包含完整版本与摘要，计划更新不会悄悄替换正在执行的一轮。

## 能力

| 能力 | 作用 |
| --- | --- |
| `trading_decision_models` | 列出配置模型及默认 manager/executor 角色；复核者由 workflow 定义 |
| `trading_decision_plan` | list/save/pause/resume 持久计划；仅主会话 |
| `trading_decision_run` | 用稳定 request_id 开始一轮，重复请求不重放 |
| `trading_decision_event` | 为授权计划传入去重事件 |
| `trading_decision_runs` | 读取保存状态/回执或取消活动运行 |
| `trading_decision_activity` | 打开已有宿主工作流过程 |
| `trading_decision_context` | 分页读取冻结账户、历史、经理/执行员记录和决策记忆 |
| `trading_decision_check` | 仅本轮实际复核者保存自己的 allow/block 与具体理由，不修改目标 |
| `trading_decision_decide` | 经理保存目标、依据和风险条件；完整研究引用自动随决策冻结 |
| `trading_decision_apply` | 执行员通过选定实现执行冻结目标 |
| `trading_decision_report` | 读取已归档的报告，不重建被用户编辑或删除的文件 |
| `trading_decision_review` | 用真实后续证据复盘交易判断，不从目标推导收益 |

工作流内部使用 `trading_decision_workflow_execute` 与 `trading_decision_workflow_dependencies`，由宿主统一 Run 控制启动、中断、恢复和检查点。它们不构成第二套 Agent 接口。

## 执行与成果

经理读取固定研究、当前账户与适用风险红线，核算数量/币种/合约/费用和全组合暴露，再保存结构化目标。`unchanged:true` 对应空 targets；明确 quantity:"0" 关闭该品种所有来源仓位，未列品种保持不变。策略停止与平仓是两个独立结果；未部署的 SL/TP 不能声称已保护。

执行员只消费冻结目标并返回真实回执。submitted/unknown 不是成交，未知结果必须按原操作 ID 核对，不能新建运行重发。依赖问题中断时保留同一 Run、角色和已有成果；主 Agent 可在现有授权内修复并显式恢复，不要求所有暂停都等待用户回复。

执行结束后由 Report 生成并归档一份经理总结报告，冻结 `run.json` 保留账户、固定研究、目标、执行和复盘依据。最终正文不拼成员全文，不增加报告员。研究的图表展示由独立研究报告能力负责；交易总结不能把建议、目标或已接受订单写成成交。

旧包历史数据不在此次更名中导入、迁移或删除。

## 包内职责

`runtime.js` 保留原能力门面、工作流执行、授权、持久状态和启动/停止生命周期。`scheduler.js` 负责事件与周期准入、账户串行队列和账户订阅，使用同一个 runtime 的 host、时钟、队列、订阅表与 Run 执行作用域，不创建第二份状态。

重启继续保留已接受的 Run 和原回执；未知执行不重发。账户流断档沿原重试时间恢复，取消与停止仍由 runtime 关闭订阅并等待原任务。决策复盘继续使用既有 `memory.js`，不与个人记忆或判断准则台账合并。

Report presentation follows the host-selected provider. The fixed document adapter first calls `host.reports.describe` and uses the `sesame/reports` facade only when that provider and its declared content/style schema are supported. An incompatible provider returns a specific unsupported result with the frozen decision and evidence retained; it never changes host settings or repeats execution. An Agent can instead read `host_reports_describe`, adapt the existing evidence to the returned inputSchema and publish through `host_reports_publish`; content/style is a Reports vocabulary, not the generic host schema. Do not upload HTML, CSS or scripts, or require a template step. Keep judgment, chart annotations, brief reasoning and material risk conditions in the body, with original account/research/execution records in the end appendix. The default Reports provider owns blue/gray borderless styling, LaTeX and reusable declarative style versions. Persist the exact published ref before checking; a failed inspection rechecks that ref and never replays trades. Presentation changes neither authorize execution nor reinterpret accepted orders as fills.
