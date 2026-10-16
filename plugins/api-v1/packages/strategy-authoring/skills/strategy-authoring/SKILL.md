---
name: strategy-authoring
description: 编写平台无关 SVL/1 策略源，验证并发布固定修订，从同一 AST 生成图，回放固定输入，再按目标插件的真实 profile 翻译与测试。
license: MIT
---

# SVL strategy authoring

目标是得到与声明规则一致、能追溯版本的策略源及实际验证证据。按已有输入选择能力；已有源文件或固定成果可以直接使用，无需每次重复读取全部资料或重新验证同一版本。

| 能力 | 入口与产物 | 证据边界 |
| --- | --- | --- |
| `strategy_validate` | `{source_path}` → `sourceDigest/operators/diagnostics/graph` | 源结构、引用、预算和原语检查；不运行事件。 |
| `strategy_publish` | `{operation_id,source_path,title,change_summary,...}` → 完整 `ref/sourceDigest/graph` | 内部执行同一静态验证后冻结源；不要求预先调用 validate。更新用真实 parent、artifact_id 和 expected_revision。 |
| `strategy_graph` | `{source:完整ArtifactRef}` → 同一源的逻辑图 | 图从固定 AST 派生，不能单独修改判断后仍使用旧摘要。 |
| `strategy_replay` | `{source,fixture_path,output_path?,operation_id?}` → 实际事件求值、`validationScope/nativeEngineExecuted`，可选固定 evidence | 检查固定事件上的分支、类型与状态；不接行情、不撮合。 |
| `strategy_functions` | `{output_path}` → 扩展身份、digest、函数名和保存路径 | 写出 RSI、ATR、MACD、Bollinger、Donchian、z-score、波动率纯函数；并未发布或执行策略。 |

语法入口是 `plugin_read({pluginId:"sesame/strategy-authoring",part:"resource",path:"skills/strategy-authoring/references/language.md"})`，完整参考包含结构、类型、当前原语、控制流、回放格式、预算和错误定位。新建或修改源时按需读取；需要理解设计取舍时读 `references/architecture.md`，它说明需求、时间、信号、分配、风险、执行与恢复，不新增语法。合法示例为 `examples/close-threshold.svl.json` 与 `.replay.json`；交易意图示例为 `examples/crossover.svl.json` 与 `.replay.json`。这些教学数据分别演示状态更新、交叉入场意图，不能证明实盘策略完整。

源中的 `parameters/inputs/state` 是具名对象。参数 `type` 是字符串，状态为 `{"type":{"kind":"decimal"},"initial":"0"}`；Decimal 用字符串，JSON number 仅安全整数。遇到对象形状错误，依错误路径核对具名集合、状态 type 与节点 inputs。不要发明自由文本表达式或未声明原语。1.0 的 functions 必须为空，1.1 增加类型化纯函数、窗口与时间原语，1.2 支持声明的集合、统计和冻结扩展。需要指标函数时读 `references/quant-functions.md`，将 strategy_functions 返回的完整扩展嵌入匹配的 1.2 源；只改版本号不能获得目标支持。

重放文件为 `{runId,parameters,initialState?,events}`，source 单独使用发布的完整引用。参数、状态和事件来自明确记录；预期结果依据规则独立给出，不能由待测翻译代码生成。operation_id 可保存输入与结果的固定 evidence。原生执行另由目标插件的 TargetProfile 和已声明能力决定；只有事件、单位、数值、保护、归属及恢复均可表达的范围才能进入其翻译、编译和验证。缺失能力保留 unsupported/limited，不因写策略自动安装后端，也不补隐藏原生逻辑后宣称全部可视化。

## 信号、组合、风险与执行

需要组合策略、多个信号源或 Agent 参与判断时，先用 `plugin_read` 读取 `skills/strategy-authoring/references/pipeline.md`。按“信号 → 目标组合 → 风险调整 → 执行”固定输入输出、时间线与引用。已有目标可用 `strategy_pipeline` 检查；需要实际筛选品种和计算仓位时，继续读取 `references/methods.md`、`references/execution.md`，调用 `strategy_workflow`：动态排名、等权/置信度/逆波动率、汇率与合约数量、预算余量、回撤与总净/分组风险、拆单/保护/反向分段、部分成交/改单/撤单/恢复都有可重放结果。固定输入推演不调用模型、不连接券商、不成交。保留经典事件状态机，别把紧密关联的入场/退出逻辑强塞进组合分配。

Agent 作为信号或非技术风险来源时，再读 `skills/strategy-authoring/references/agent-inputs.md`，使用 `strategy_decision` 提交隔离判断、查询/取消、使旧请求失效、导出固定时间线或启动目标适配器可消费的本机桥。实时结果和历史结果使用同一外部输入契约，按首次可消费时间进入策略；回测重放固定输出，不在每个优化参数下重新请求模型。账户反馈判断不能跨不同参数的模拟账户复用。硬风险规则、判断过期、断连和迟到结果的处理必须预先定义。源语言、图和固定事件测试通过，不意味着目标后端已经完成实盘消费或语义一致性验证。

## 当前求值边界

- SDK 提供 34 位十进制、half-even、缺失 not_ready、按输入顺序处理、重复事件忽略、每事件状态与意图原子提交、错误暂停。
- 工具返回 `validationScope`，SVL 求值成功只说明这些固定输入上的逻辑结果。没有网络、报价流、成交撮合、MT5 Tester 或实盘启动。
- 形成中柱不能当已闭合柱；未知挂单或未决意图不能被当成零；缺历史预热保持 not_ready。
- 原生 double 与 decimal34 的差异必须在目标翻译与验证记录中说明，不能自动宣称等价。
- 只有真实运行采集的 DecisionTrace 才能解释成交路径。教学 replay、图布局和报告解说不得冒充原生交易证据。

语言验证与固定重放使用公开 `@sesame/plugin-sdk/svl`；文件、固定成果、私有状态、事件和隔离模型任务通过 API 2 的 `host.resources`、`host.state`、`host.events`、`host.capabilities`、`host.runs` 处理。插件不需要读取私有 Store、Runtime 或 MT5 模块。
