---
name: native-ea
description: 使用有明确修改范围的空模板编写独立 MQL5 EA，声明各模块与状态机，实现原生逻辑并验证真实回测。
---

编写前调用 mt5_inspect；create / checkout 后先读取工程 README.md、strategy.json 和六个 Include/Strategy 模块。平台 SDK 在返回的 sdk_path 下只读。新工程是不可执行的空骨架，不能假设已经实现突破、固定风险或退出策略。不要修改终端标准库，也不要用 Python/Rust 策略循环冒充 MT5。

**先按版本分流。** 新工程模板 3.x 使用 `visual-mql-v1`：必须读取 visual-state-machines skill 及其 `references/language.md`，由解析后的受限源码生成原生类、图和埋点；不写 class/include、辅助文件或 rules.json。本节后续关于手写原生类、规则声明、disabled 和观测归属的细节仅适用于保留的 2.x 工程。不能删除 language 或降低模板版本绕过校验。

## 工程契约

- 平台维护 Experts/Strategy.mq5：生命周期、对象组装、取消、权益、OnTradeTransaction、OnTester 原生结果采集。新工程 save/compile 会拒绝入口修改、额外 EA 入口、平台节点变更及删除 strategy.json。业务 input 放在 Include/Strategy 头文件，不能改入口添加参数。
- Agent 编辑 Signal（机会和方向）、Money（数量预算）、Position（持仓阶段与动作）、Trailing（保护）、Risk（策略准入/冷却）、Expert（原生调度扩展），以及辅助 .mqh、规则图、SET 和 README。六个模块、固定接口和继承边界见工程 README；main/subagent 权限相同。
- strategy.json 每个模块必须选 unimplemented/custom/native/disabled 并说明方案。custom 至少绑定一个真实可观测节点；native 仍需在 MQL 中明确实现适配。只有 Trailing 和策略 Risk 可以 disabled，必须说明原因并显式实现其停用行为。不得停用 Signal/Money/Position/Expert 或平台风控。
- 草稿可以 save/compile；所有模块声明完成、代码通过 Configure() 和原生 ValidationSettings 后才具备测试条件。Tester 校验构建自身冻结 revision，不能通过更新工程 HEAD 启用旧草稿。implementation=declared 仅代表声明完整，不代表算法正确或回测通过。

## 原生分工与状态

CExpert::Processing() 优先处理已有持仓的反转、平仓与 trailing，再处理挂单，最后检查新入场，并且有提前返回。Position.Manage 在 CheckClose 内调用，返回 true 结束该分支；加仓/挂单/调度优先级通过 Expert 的原生方法扩展。修改时同步真实规则和说明。暂停新风险不能跳过退出和保护。

CExpertSignal 方向、强度、权重与阈值不是简单 AND。Advance 推进实际市场事件，LongCondition/ShortCondition/Direction 读取结果；按选定的 tick/已收盘 bar 语义去重。ConsumeSignal 清理意图不等于确认成交。Money 只计算候选数量；Position 管理真实持仓阶段；Trailing 处理保护调整；策略 Risk 和平台限额独立。

有状态模块在 README 说明状态/初始值、记忆、事件、守卫、动作、失效/重置和等待确认。同步 observability/rules.json 与实际 ProductEmit 节点/转移 ID，并在 strategy.json 标明所属模块；无状态策略不需要造状态机。每个自定义节点与状态机只能有一个所属模块。真实发送不等于成交，须通过事务/持仓/历史事实确认。平台已有成交关联有边界，不能声称仅下单时的 trace 是完整跨 K 线机会历史。

保留 CProductExpert 继承和平台注入的交易对象，不直接 OrderSend，也不另建交易对象；只读 SDK 不是任意源码不可绕过的安全证明。当前 SDK 仅支持 Tester，实盘部署、跨 EA 风险预留与未知结果恢复未启用。不要改写 Product_RunId、取消/权益/结果钩子或用手写 JSON 代替原生结果。

新增 input 同步 SET、规则参数说明与 README。CExpertSignal.StopLevel/TakeLevel 使用标准库调整点，五位外汇通常为 10 个报价 point。采用 CMoneyFixedRisk 等原生算法须验算其 balance 基数、最小手数取整和止损预算；平台 equity 限额不会因为选择某个 Money 类而自动一致。

## 保存与验证

通过工作区 read/write/edit/bash 修改 checkout，mt5_project save 保存不可变 revision；revision_conflict 时重新 checkout 并合并。使用明确 revision 调用 mt5_compile，按真实诊断修复工具返回的可恢复问题。可用后使用同包的 mt5_backtest，运行真实 Tester，核对实际参数、原生指标、成交和 trace；编译成功不能写成已经验证的策略。

成功 backtest_ids 交给 report_publish 自动绑定后端数据和交互组件。生成报告默认委派 subagent，主 Agent 保留全部工具权限。已有无 strategy.json 的工程按旧协议维护，不自动重写历史研究或冻结结果。

原生参考：https://www.mql5.com/en/docs/standardlibrary/expertclasses/expertbaseclasses/cexpert
处理顺序：https://www.mql5.com/en/docs/standardlibrary/expertclasses/expertbaseclasses/cexpert/cexpertprocessing
