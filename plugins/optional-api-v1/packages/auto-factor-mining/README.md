# 自动因子挖掘

本插件只编排研究协作：主管规划、并行假设、候选实现、证据评审、复盘、冻结选择、最终评估、一次总结。模型、研究能力和评估实现由用户分别选择；没有默认 MT5、券商、AST 或其他执行后端。

## 组合方式

`config.research = {plugins:[插件ID], tools:[可选精确工具子集]}`。插件类型不限，支持只有技能的插件。未提供 tools 时采用这些插件的全部可委派工具；空数组只加载技能/提示。主会话专用工具不会发给研究角色。显式选择不存在、停用、主会话专用、名称冲突的能力会失败，不猜测替代。版本和摘要在创建时冻结，恢复和新任务前复核。

`config.evaluator = {plugin_id, tool, arguments?}` 必填。任何已安装且实现 `sesame.factor-evaluator/v1` 的可委派工具都可选择，没有品牌白名单。工作流将 candidate 作为不透明 JSON，保存该工具实际返回的指标、资格、冗余和冻结选择回执，拒绝模型自己提供的指标。计算方法、字段、公式语言、成本及门槛由 evaluator.arguments 和该能力的契约决定。

同样支持任意已配置模型；`auto_factor_models` 提供当前描述，每个角色可以在 agentModels 指定 provider/id。研究轮数、方向数、任务预算和并行分支数是工作流设置，与执行能力无关。

## 示例

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
      "arguments":{"dataset":{"trainEnd":"2024-01-05T00:00:00Z","validationEnd":"2024-01-09T00:00:00Z","horizon":1,"costBps":10,"quantile":0.25},"minRankIC":0,"minCoverage":0.6,"maxCorrelation":0.95}
    },
    "directions":["动量与反转","量价关系"],
    "rounds":3,
    "parallelism":2,
    "maxTrials":12,
    "maxTasks":80
  }
}
```

能力引用以宿主提供的完整声明为准。上例中的数据只能包含 validationEnd 及之前的开发观察。`dataset_id` 是否必需由所选评估器决定；自定义实现可以在 arguments 指定其他输入。

## 留出与调用边界

选择任意研究插件（包括技能）时，工作流要求 evaluator.prepare 使用 development-only：评估器不能在该会话接收留出数据，也不能最终宣称完成留出检验。独立的 factor-evaluator 会拒绝 validationEnd 后的行。这是因为通用 data/workspace 能力可能读取已注册原数据，不能一边开放它们一边声称同一份数据封存。

未选研究插件时可使用评估器的受限工作流模式：每个角色仅有声明的上下文和结构化提交能力；评估工具拒绝直接 Agent 调用。prepare 只给出开发集；select 冻结后由原生工作流直接调用最终评估。不把最终结果回流研究。原生插件本身是受信代码，这不是对恶意原生代码/外部进程的隔离承诺。

跨插件调用只发生在有效的 auto_factor_start、auto_factor_submit 与 auto_factor_workflow 能力调用里。后台工作本身是声明的 native Run，研究角色通过 host.agent.run 执行；最终评估和归档直接使用代码。评估器版本改变或依赖不可用会明确中断，等待恢复原选定实现；普通计算或业务错误仍按失败保留证据，不悄悄切换实现。

## 原生任务与报告

`auto_factor_activity({run_id})` 打开宿主原生 Run 界面。工作流与普通子 Agent 使用同一组运行、观察和取消接口；每个节点对应实际 Run，交接只在后续角色真正读到前序产物时产生。插件保留结构化研究断点，不复制公开消息和工具状态，也不提供第二套 HTML 监控。

工作流预先绑定研究报告目标，由宿主准备目录。完成、失败或预算耗尽且子任务已退出时，原生代码发布一份 report artifact：`report.html` 加 `run.json`、`dataset.json`、`factors.json` 证据附件。报告不占研究 Agent 预算。失败会保留证据并让实际 Run 失败，不能返回正常完成。暂停是非终态中断，不发布最终失败报告；显式恢复沿用原宿主 Run、会话、业务 ID、角色 assignment/RunRef 和已提交成果。取消、失败和预算耗尽是终态，不能通过恢复换 ID 绕过。

`auto_factor_runs` 支持 list/read/pause/resume/cancel；`auto_factor_report` 只读取当前已发布的同一份报告，尊重用户对宿主绑定文件的移动、编辑和删除。没有有效候选、空选择或提前停止都是合法研究结果。

宿主在 `auto_factor_workflow` 的 `requires` 中调用只读 `auto_factor_dependencies({run_id})`，返回 `{available,reason?,details?}`。它核验冻结数据完整性、剩余阶段选择的模型配置及 evaluator/research 声明修订；不会重做 prepare、创建新评估会话或启动 Agent。现有 evaluator 协议没有独立只读 session 探针，评估器持久会话的实际可读性仍由下一次真实 operation 核验，不把声明存在当作评估已成功。

依赖不可用时宿主中断整个工作流并释放运行资源，主 Agent 沟通和修复后用 `host.runs.resume` 恢复；`auto_factor_runs` 的 pause/resume 只是同一宿主控制的业务 ID 便捷入口。恢复前重新预检，仍不可用继续挂起。运行中结构化 `DEPENDENCY_UNAVAILABLE` 与 `RUN_INTERRUPTED` 必须向宿主传播，不能变成某个 trial 的普通失败或报告终态。

`auto_factor_runs({action:"read",run_id})` 返回 `interrupts:[{id,reason,requirements,...}]`。主 Agent 获得中断后的用户回复并处理对应事项后，可调用 `auto_factor_runs({action:"resume",run_id,interrupt_ids:["读到的中断ID"],response:{resolution:"实际处理结果"}})`；`response` 可省略。它转发为 `host.runs.resume(workflow,{interruptIds,response})`，沿用宿主对用户回复的确认。即使只有一项也明确选 ID；只解决部分事项时，其余中断继续等待，不默认批准全部。

原生执行声明 `resumable:true`，通过 `execution.checkpointState`、`execution.attempt/resume` 与 `await execution.checkpoint(state)` 保存阶段位置；业务成果继续存于原有 durable checkpoints。角色派发前保存请求和固定 operationId，接受后保存 RunRef；恢复只观察或恢复该 Run。已完成角色输出、评估回执、reflection、selection 与 finalEvaluation 直接复用。评估器协议要求同一 session/trial/selection 的冻结请求具有幂等回执；不能换 trial ID 或改输入重试未知结果。

## 验证与复现

包内 `node --test tests/*.test.js` 运行组合解析、报告、可信归属和真实工作流结果等测试。跨包生命周期、真实独立计算、非 AST 协议、归档及复现脚本测试位于外层 `plugins/optional-api-v1/tests/auto-factor-mining-runtime.test.mjs`；`auto-factor-mining-packages.test.mjs` 用官方 buildLock 验证两个包的独立分发边界。外层 `auto-factor-mining-host.test.mjs` 使用真实安装器、Store、后台工具循环及本地 SSE 模型夹具。

在 `plugins/optional-api-v1` 设置 `SESAME_PLUGIN_SDK_LOADER` 为匹配宿主的 SDK loader 文件 URL 后运行 `npm test`，既有运行器会同时收集包内及外层测试。定向运行使用 `node --import <SDK-loader-file-URL> --test tests/auto-factor-mining-runtime.test.mjs tests/auto-factor-mining-packages.test.mjs`。

数值实现、数学测试和独立复现脚本现位于所选评估插件。例如 factor-evaluator 提供 `node scripts/reproduce.mjs <run.json> <run.dataset.json>`；工作流不规定通用计算公式。研究结果不等于实盘可用信号。

## 宿主 API v2

capabilities.json 是能力、输入输出、生命周期、状态集合和报告 schema 的唯一声明；createCapabilities 仅绑定实现。所选研究能力使用 pluginId#capabilityId 精确引用，模型来自 context.models。workflow 能力有独立任务会话，子 Agent 继承真实父 Run；state 保存 CAS 索引，resources 保存不可变断点与报告。views.open 只打开宿主原生 Run 界面。最终评估与报告归档由代码完成。
