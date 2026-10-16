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
