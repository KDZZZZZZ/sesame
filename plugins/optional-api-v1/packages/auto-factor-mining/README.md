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
    "research": {"plugins":["sesame/financial-research"],"tools":["financial_research_query","financial_research_read"]},
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

工具名应先从本机 plugins.inspect/discover 核实。上例中的数据只能包含 validationEnd 及之前的开发观察。`dataset_id` 是否必需由所选评估器决定；自定义实现可以在 arguments 指定其他输入。

## 留出与调用边界

选择任意研究插件（包括技能）时，工作流要求 evaluator.prepare 使用 development-only：评估器不能在该会话接收留出数据，也不能最终宣称完成留出检验。独立的 factor-evaluator 会拒绝 validationEnd 后的行。这是因为通用 data/workspace 能力可能读取已注册原数据，不能一边开放它们一边声称同一份数据封存。

未选研究插件时可使用评估器的受限工作流模式：每个角色仅有交接工具和评估协议工具；评估工具拒绝直接 Agent 调用。prepare 只给出开发集；select 冻结后由真实 finalizer 任务调用最终评估。不把最终结果回流研究。原生插件本身是受信代码，这不是对恶意原生代码/外部进程的隔离承诺。

跨插件调用只发生在有效的 auto_factor_start、auto_factor_submit、auto_factor_finalize 工具调用里。后台调度器读取持久回执，不用 service host 冒充会话。评估器版本改变或不可用会明确失败；不悄悄切换实现。

## 实时协作与总结

`auto_factor_activity` 在 Sesame 报告面板打开临时 HTML。真正的任务状态、公开文字、工具状态及同伴读取事件由宿主 SSE 经 MessagePort 推送进隔离 iframe；不生成每个角色的日报，不保存实时视图的文件/报告行，不显示思维链或工具原始参数。所有 Agent 使用 output:none。页面支持拖拽缩放流程、模型图标、Markdown 和消息交接动画。

只有 completed/cancelled/exhausted 且所有研究任务结束时，在研究目录 `自动因子挖掘/` 写一份最终 HTML、账本/数据/候选三份 JSON 和不可变证据引用。暂停、失败、中断只保留账本和实时页，可显式恢复。报告/最终评估不消耗研究任务预算。重复归档不会新建第二份；尊重移动、编辑和删除。

`auto_factor_runs` 支持 list/read/pause/resume/cancel；`auto_factor_report` 可重试待归档总结。断点沿用已确认产物和冻结回执。没有有效候选、空选择或提前停止都是合法结果。旧版本未选择独立 evaluator 的活动运行不能混合续跑；保留原账本，开始新的显式配置运行。

## 验证与复现

包内 `node --test tests/*.test.js` 运行组合解析、报告和实时观察等自包含测试。跨包生命周期、真实独立计算、非 AST 协议、归档及复现脚本测试位于外层 `plugins/optional-api-v1/tests/auto-factor-mining-runtime.test.mjs`；`auto-factor-mining-packages.test.mjs` 用官方 buildLock 验证两个包的独立分发边界。外层 `auto-factor-mining-host.test.mjs` 使用真实安装器、Store、后台工具循环及本地 SSE 模型夹具。

在 `plugins/optional-api-v1` 设置 `SESAME_PLUGIN_SDK_LOADER` 为匹配宿主的 SDK loader 文件 URL 后运行 `npm test`，既有运行器会同时收集包内及外层测试。定向运行使用 `node --import <SDK-loader-file-URL> --test tests/auto-factor-mining-runtime.test.mjs tests/auto-factor-mining-packages.test.mjs`。

数值实现、数学测试和独立复现脚本现位于所选评估插件。例如 factor-evaluator 提供 `node scripts/reproduce.mjs <run.json> <run.dataset.json>`；工作流不规定通用计算公式。研究结果不等于实盘可用信号。

需要 Sesame >=0.2.3-dev.8，使用实时报告面板、delegatable_tools、agents.submit.plugins 和 tools.invocation，并依赖嵌套调用的完整活性校验及后台任务的调用作用域隔离。安装器会在加载前拒绝旧版宿主；能力缺失仍会给出升级错误。
