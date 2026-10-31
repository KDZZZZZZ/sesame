# 来源与实现边界

本插件由 Sesame contributors 原创实现，MIT。工作流借鉴 Microsoft RD-Agent v1.0.0 的 research → development → evaluation → feedback 闭环、实验父子谱系、成功/失败经验记录；没有复制或捆绑 RD-Agent 源代码、Qlib、CoSTEER、Docker/Conda 环境或模型权重。

参考基线固定于 [RD-Agent v1.0.0](https://github.com/microsoft/RD-Agent/tree/v1.0.0)，commit `484776c211e4fbbeef03e0ec00d6bbee7362a4f4`（上游 MIT）：

- [RDLoop](https://github.com/microsoft/RD-Agent/blob/v1.0.0/rdagent/components/workflow/rd_loop.py)：阶段与实验反馈闭环。
- [proposal / Trace](https://github.com/microsoft/RD-Agent/blob/v1.0.0/rdagent/core/proposal.py)：实验、反馈与父关系。
- [CoSTEER knowledge](https://github.com/microsoft/RD-Agent/blob/v1.0.0/rdagent/components/coder/CoSTEER/knowledge_management.py)：实现反馈与经验复用思路。
- [Qlib factor runner](https://github.com/microsoft/RD-Agent/blob/v1.0.0/rdagent/scenarios/qlib/developer/factor_runner.py)：执行评价和结果反馈边界。

Sesame 本地 `manual-trading`（MIT）提供已验证的 多角色研究、固定模型、结构化断点与单份报告的业务设计。这里只复用该机制，未复用盯盘、账户、目标仓位或交易执行业务。

原有 `engine.js`、数学测试和复现脚本已移至独立 `sesame/factor-evaluator` 插件。它是可明确选择的有界 AST 与统计诊断基线，不是上游 Qlib 的复现，也不宣称当前 SOTA。工作流只定义通用评估工具协议，其他实现无需接受 AST 或相同指标。演示 HTML 的研究与收益数字为合成示例。

实时 HTML 使用两个插件共同维护的原生展示资产；本体 SSE 经隔离 MessagePort 推送，角色不会创建报告文件。模型图标来自 LobeHub，来源与 MIT 许可见 [MODEL-ICONS.md](MODEL-ICONS.md)。

- [ChatDev 2.0](https://github.com/OpenBMB/ChatDev/tree/4fb2db0ea90375ce1059f44fe03ffbd191a7a169), Apache-2.0, inspected 2026-10-14: [real node events](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/frontend/src/pages/LaunchView.vue#L2236-L2317), [SVG path movement](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/frontend/src/pages/LaunchView.vue#L1971-L2092), and [busy node actions](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/frontend/src/components/WorkflowNode.vue#L47-L88) informed the event-driven animation. Sesame's own implementation moves model badges on successful structured report reads, without copying ChatDev code, characters or branding. SSE remains the read-only transport; reconnects do not replay old animation. Only the whole run produces a final summary file.
# Version 1.2.0 integration

Original Sesame MIT-licensed factor-research and strategy-research guidance is integrated in references/research-guide.md, factor-method.md, strategy-evidence.md and the optional CLI contracts. scripts/reference-factor.mjs and scripts/reference-experiment.mjs are unmodified copies of those original Sesame reference CLIs, with their synthetic example inputs retained under examples/reference-factor and examples/reference-strategy. They remain optional local resources, not native capabilities or automatic duplicate evaluators. The explicit single-Agent mode is an original Sesame state machine over the same independent evaluator protocol and host checkpoints; no third-party optimizer or trading engine is introduced.

# Version 1.3.0 optional native validation

The optional native controller is original Sesame code over declared Backtrader, vnpy and MT5 plugin capabilities. It preserves frozen source/configuration, bounded input windows, actual operation receipts and predeclared development-only selection. Backtrader optimization uses the separately installed upstream Cerebro `optstrategy` API; no optimizer implementation is copied into this workflow. MT5 optimization accepts only the currently declared `tester_run_optimization` schema and explicit configuration bindings. Local native execution remains outside the factor evaluator's restricted environment. Conditional use retains evidence, failures and limitations; measured results are not automatically confidence estimates or live-trading approval.


## 1.3.1 报告布局

发布正文显式标记证据明细，由统一报告骨架集中末尾附录。关键适用、失效和停用条件仍在正文；从附录返回隐藏试验时恢复对应试验选择。分析、选模、评估和原生执行逻辑未更改。
长任务书、评审和复盘只显示有界原文摘录，并明确链接完整记录；附录使用试验身份与轮次定位，避免重复完整假设。完整原文和运行快照不变。
