# Agent 手工交易工作流

`sesame/manual-trading` 3.0 只负责周期/事件调度、逐角色模型、协作、目标仓位、证据复盘与每轮汇总。账户、下单、策略挂载控制由明确选择的执行能力提供；研究和数据工具由所选插件提供。使用 Host API 2 的完整能力声明、可信调用来源和统一 Run。安装不创建交易计划。

## 配置

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

中断保留原业务 ID、宿主 Run/会话、角色 RunRef、已完成阶段和 SQLite 决策/执行回执，不记为失败，不发布终态报告。`manual_trading_runs(action=read)` 返回 `workflow`；`runs.read(workflow)` 给出中断 ID、原因与依赖。主 Agent 获得中断后的用户回复并处理对应事项后，可调用 `runs.resume(workflow,{interruptIds:["已处理的ID"],response:{resolution:"实际处理结果"}})`；剩余中断继续等待，全部解决才重新预检并恢复同一次执行。用户也可以从宿主界面明确恢复。计划启停控制调度，不能替代这个运行级中断/恢复接口。

原生工作流在安全阶段使用 `await execution.checkpoint({runId,stageIndex})`；`execution.checkpointState` 指向同一个业务运行，`execution.attempt` 变化时清除本轮不可用上下文缓存，只允许重新进行只读检查。角色以固定 role/round 请求及 operationId 接受并保存 RunRef，恢复不重新派发已接受任务。已保存 decision 和 execution 直接复用；执行已经送出而回执尚未保存时，必须先核验原 operation IDs，不能自动重放或创建新决策。`RUN_INTERRUPTED` / `DEPENDENCY_UNAVAILABLE` 向宿主传播，取消仍不代表撤销已成交订单。

## 数据边界

旧插件私有业务历史不会自动导入，也不会物理删除旧库。新的计划和运行只使用本插件明确保存的记录；不读取宿主私库。执行确认只接受冻结 fillSources 与原始 producer 登记的成交行，目标和派生数据不能代替实际成交。

## 用户可见资料

账户、全来源持仓、委托与成交历史、挂载、团队结论和研究数据集均可复核。`manual_trading_context` 分页返回，`manual_trading_runs` 查看和取消所属计划；团队公开结论不包含私有推理。研究数据缺口保留在结果中，不从目标推算成交或收益。

### 原生任务与报告

`manual_trading_activity({run_id})` 打开宿主原生 Run 界面。每轮工作流拥有普通子任务会话，实际研究、经理和执行 Agent 是其子 Run；界面统一展示进度、公开输出、工具回执、实际结果交接和报告。插件不再提供临时 HTML 监控或复制公开任务消息。

每轮绑定 `research/手工交易日报/<计划名称-ID>/<时间-运行ID>.html`，父目录由宿主准备。角色使用 output:none，整轮结束后由代码发布一个 report artifact，包含 `report.html` 和冻结的 `run.json` 附件。失败同样保留已有证据，并让实际工作流 Run 失败；不派机械总结 Agent。`manual_trading_report` 读取同一报告引用，不重新发布或覆盖用户移动、编辑、删除的绑定文件。

取消结束当前父 Run 及其活动子 Run，同时保留目标与真实执行回执。取消不能撤销已经发生的成交；应用重启也不会重放不确定的外部执行。

交易案例按账户、标的和实际已知时间检索，后续通过 `manual_trading_review` 使用真实外部数据集复盘；不将目标、持有不变或报价变化当作成交收益。事前判断登记、固定证据核验、归因、校准和准则由独立 `sesame/judgment-evolution` 提供，需要安装并启用该插件。主 Agent 使用 `host.capabilities.list` 中已注册的 `judgment_record`、`judgment_resolve`、`judgment_reflect`、`judgment_rules` 及其队列和审计能力，依照该插件公开声明调用；缺少能力时明确报告依赖。判断管理只允许主会话，角色可以经允许的 `host.resources.read` 读取主 Agent 提供的准则 ArtifactRef。

计划/任务/案例存于插件私有 SQLite，研究证据存于 datasets。3.1 起本插件不创建判断数据库、不审计主会话回复，也不注册判断转发入口；已有判断账本和导出保留原位，不自动迁移或删除。计划不保存 API 密钥；研究插件仅保存环境变量名。

验证使用虚构账户、来源响应和本地模型协议夹具，不向真实券商发送测试订单。未知发送必须查询原回执；无实盘盈利、零滑点或券商端 exactly-once 保证。
