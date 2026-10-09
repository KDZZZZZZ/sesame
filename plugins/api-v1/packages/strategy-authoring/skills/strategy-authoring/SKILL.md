---
name: strategy-authoring
description: 编写平台无关 SVL/1 策略源，验证并发布固定修订，从同一 AST 生成图，回放固定输入，再按目标插件的真实 profile 翻译与测试。
license: MIT
---

# SVL strategy authoring

1. 确定输入、时间口径、入场/退出、仓位、风险和缺数政策。不要因目标是 MT5 就先写 MQL5 再补一张解释图。
2. 使用包内 `examples/crossover.svl.json` 了解实际支持的结构。它是明确标注的教学示例，参数和品种不代表用户策略。
3. 通过工作区工具写 `.svl.json`。语言为 `svl/1`、schemaVersion 为 `1.0.0`，Decimal 用字符串，JSON number 仅安全整数。节点、事件与步骤引用必须真实存在。`functions` 和 `extensions` 当前只接受空数组；不声称已实现自定义函数/扩展。
4. 调用 `strategy_validate` 修复结构、类型、引用、预算与原语错误。`strategy_graph` 从发布的同一源 AST 生成图；不能单独编辑图的判断后仍保留旧摘要。
5. 调用 `strategy_publish`，保存返回的完整 `ref`（id/revision/digest/kind/schemaVersion）。更新需要真实 parent 和乐观锁，不能用“最新”解释历史。
6. `strategy_replay` 读取固定的 JSON 事件序列。事件、参数和初始状态来自明确记录；没有数据就指出缺口。示例 replay 只用教学价格，不是回测。可用 operation_id 保留输入与结果的 resource artifact。
7. 需要原生运行时，加载目标插件并读取 TargetProfile。例如 `sesame/mt5` 的 `mt5_target` 返回 `sesame.mt5.mql5/1` profile；`mt5_translation` 接受源/目标 ArtifactRef、mode、相对路径代码、source_map 与 adaptations。Agent 负责按该 profile 翻译，随后按工具 schema 编译、回放比较、回测及运行。不能猜测或统一所有供应商工具参数。

## 当前求值边界

- SDK 提供 34 位十进制、half-even、缺失 not_ready、按输入顺序处理、重复事件忽略、每事件状态与意图原子提交、错误暂停。
- 工具返回 `validationScope`，SVL 求值成功只说明这些固定输入上的逻辑结果。没有网络、报价流、成交撮合、MT5 Tester 或实盘启动。
- 形成中柱不能当已闭合柱；未知挂单或未决意图不能被当成零；缺历史预热保持 not_ready。
- 原生 double 与 decimal34 的差异必须在目标翻译与验证记录中说明，不能自动宣称等价。
- 只有真实运行采集的 DecisionTrace 才能解释成交路径。教学 replay、图布局和报告解说不得冒充原生交易证据。

本插件通过 `host.svl`、`host.workspace`、`host.artifacts` 工作，不读取私有 Store、Runtime 或 MT5 模块。
