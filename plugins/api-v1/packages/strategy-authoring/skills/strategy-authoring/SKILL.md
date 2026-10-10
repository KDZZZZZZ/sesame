---
name: strategy-authoring
description: 编写平台无关 SVL/1 策略源，验证并发布固定修订，从同一 AST 生成图，回放固定输入，再按目标插件的真实 profile 翻译与测试。
license: MIT
---

# SVL strategy authoring

1. **先读再写**：用 `plugin_read` 的 `{plugin_id:"sesame/strategy-authoring",path:"skills/strategy-authoring/references/language.md"}` 读取本插件的 [SVL/1 完整创作参考](references/language.md)。该资源含源结构、类型、全部当前原语、控制流、回放格式、预算和错误定位，不依赖本体源码或私有文档。
2. 接着读取 `{plugin_id:"sesame/strategy-authoring",path:"skills/strategy-authoring/references/architecture.md"}`，按需求、数据时间、信号、数量分配、风险、执行账本和恢复逐项定义策略。它是架构检查表，不是新增 schema。再读取 `examples/close-threshold.svl.json` 及 `examples/close-threshold.replay.json`，先掌握合法的状态声明与条件步骤。需要交易意图语法时读取 `examples/crossover.svl.json` 和 `examples/crossover.replay.json`。它们都是教学数据；前者仅更新状态，后者仅演示交叉入场意图，均不是可直接实盘部署的完整策略。
3. 确定用户策略的输入、时间口径、入场/退出、仓位、风险和缺数政策，按目标插件的能力与品种元数据绑定。通过工作区工具写 `.svl.json`。`parameters`、`inputs`、`state` 是具名对象；参数的 `type` 是字符串，但状态必须写成 `{"type":{"kind":"decimal"},"initial":"0"}`。不要发明字符串表达式、自由文本节点或未支持的原语。Decimal 用字符串，JSON number 仅安全整数。旧 `schemaVersion:"1.0.0"` 的 `functions` 必须为空；匹配宿主支持的 `1.1.0` 才能使用类型化纯函数、窗口组合与新增时间原语，先读 reference 和 `examples/function-threshold.svl.json`。`extensions` 仍只接受空数组。
4. 调用 `strategy_validate({source_path:"strategies/example.svl.json"})` 修复结构、引用、预算与原语错误。动态类型和实际分支仍须用固定回放验证。`strategy_graph` 从发布的同一源 AST 生成图；不能单独编辑图的判断后仍保留旧摘要。遇到 `value must be an object`，按 reference 的错误定位表检查具名集合、状态 `type` 和节点 `inputs`，不要通过读宿主代码来猜语法。
5. 调用 `strategy_publish`，保存返回的完整 `ref`（id/revision/digest/kind/schemaVersion）。更新需要真实 parent 和乐观锁，不能用“最新”解释历史。
6. `strategy_replay` 读取固定的 JSON 事件序列，文件顶层为 `{runId,parameters,initialState?,events}`，源单独通过发布的 `source` ArtifactRef 传入工具。事件、参数和初始状态来自明确记录；没有数据就指出缺口。示例 replay 只用教学价格，不是回测。核对 reference 中手工给出的预期，不用待测翻译代码生成预期。可用 operation_id 保留输入与结果的 resource artifact。
7. 需要原生回测或运行时，通过插件目录发现目标，再读取目标插件返回的固定 TargetProfile，核对事件、单位、数值、保护、精确归属和恢复支持。目标包按需安装，不能因创作策略自动下载后端。只有支持的范围才进入目标自己的翻译/编译/验证流程；无法无损表达保护、精确平仓或分配时明确 unsupported/limited，禁止静默加原生外挂语义后宣称全可视化。

## 信号、组合、风险与执行

需要组合策略、多个信号源或 Agent 参与判断时，先用 `plugin_read` 读取 `skills/strategy-authoring/references/pipeline.md`。按“信号 → 目标组合 → 风险调整 → 执行”固定输入输出、时间线与引用，调用 `strategy_pipeline` 检查固定 fixture。该工具只产生可检查的计划与证据，不调用模型、不连接券商、不成交。保留经典事件状态机，别把紧密关联的入场/退出逻辑强塞进组合分配。

Agent 作为信号或非技术风险来源时，再读 `skills/strategy-authoring/references/agent-inputs.md`：实时结果和历史结果使用同一外部输入契约，按首次可消费时间进入策略；账户反馈判断不能跨不同参数的模拟账户复用。硬风险规则、判断过期、断连和迟到结果的处理必须预先定义。源语言、图和固定事件测试通过，不意味着目标后端已经支持新语义或外部 Agent 服务。

## 当前求值边界

- SDK 提供 34 位十进制、half-even、缺失 not_ready、按输入顺序处理、重复事件忽略、每事件状态与意图原子提交、错误暂停。
- 工具返回 `validationScope`，SVL 求值成功只说明这些固定输入上的逻辑结果。没有网络、报价流、成交撮合、MT5 Tester 或实盘启动。
- 形成中柱不能当已闭合柱；未知挂单或未决意图不能被当成零；缺历史预热保持 not_ready。
- 原生 double 与 decimal34 的差异必须在目标翻译与验证记录中说明，不能自动宣称等价。
- 只有真实运行采集的 DecisionTrace 才能解释成交路径。教学 replay、图布局和报告解说不得冒充原生交易证据。

本插件通过 `host.svl`、`host.workspace`、`host.artifacts` 工作，不读取私有 Store、Runtime 或 MT5 模块。
