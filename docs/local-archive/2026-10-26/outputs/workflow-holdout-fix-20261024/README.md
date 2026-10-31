# 研究方法组合与留出隔离修复交付

2026-10-24；插件源码已冻结，可由主 Agent 更新分发锁、构建并在当前任务空闲后交付。

- auto-factor-mining：1.1.7 → 1.1.8。
- abu-parameter-search：2.0.1 → 2.0.2。
- 15 个文件变化，准确绝对路径及改前/改后 SHA-256 见 [change-index.json](./change-index.json)。已有脏改动先保存于 before/ 和 pre-existing-diff.patch，本次独立差异在 task-changes.patch，交付快照在 after/。
- 未修改宿主、factor-evaluator、全局 lock/inventory、其他插件或线上工作区。未发送模型消息、读取真实行情、研究投资标的或交易。

## 根因与行为

原 composition.js 将除了精确 plugin_read 之外的全部选中工具视作通用数据读取。resolveResearch 默认选中研究插件的所有 Agent 可调用能力，所以 factor-research + abu-parameter-search 会在工具尚未执行时进入 development-only。完整含留出输入随即被 factor-evaluator 的 validationEnd 边界校验拒绝。这是能力组合分类错误，不能证明工具已经泄露或读取了留出数据。原有 after holdoutEnd 错误则是独立的真实日期边界问题，仍然拒绝。

现在只对受信原生 immediate JSON 函数接受显式组合契约：

```json
{"researchDataAccess":{"schemaVersion":1,"reads":"input-only","writes":"none"}}
```

需要发布自身输入/结果工件时 writes 使用 derived-artifacts-only，仅接受 resources.create/resources.publish 两个精确效果。实现可以清理本次创建且已发布的临时 blob，不授权任意资源删除；可以读取固定本包源码计算实现摘要，不读取调用者提供路径或 Ref。

普通函数的 binding/kind/execution/transport、requires/allowedCalls/collaboration、effects 及所在包 hooks/sources/services/stateCollections 必须与该契约一致。无声明、未知版本、外部读取、Run、MCP、Agent、graph、子调用、任意 Ref 读取或未知效果仍按通用能力分类。新增 generalDataPlugins 仅针对自动 hooks；未选择调用的来源/服务/状态声明自身不构成自动取数证据，因此 tools:[] 的纯知识组合与既有精确公共 plugin_read 不被误降级。

计算声明解析为冻结的 inputOnlyTools，并与 generalDataPlugins、插件版本和完整修订摘要在恢复时重新核对。历史 development-only 不自动升级；声明或实现变化要求新运行，不能重新标记已见数据为未触碰留出。prepare/candidate/select/finalize、调用参数及回执协议保持不变。

真实 ABU 原生路径经代码核对及执行捕获：只计算 args.input；文件读取恰为固定 baseline.mjs 和 runtime.mjs；host 调用恰为 create → publish → remove-own-created 两次。输入附带伪造路径/Ref 仅作为来源标签保留，不解引用；无网络、账户、数据读取、跨能力或模型调用。没有修改它的算法或运行接口。声明是受信插件行为契约及测试证据，不是恶意原生代码的操作系统沙箱。

## 验证

最终定向回归 **79/79 通过、0 skipped、0 failed**，日志 full-targeted-tests.log。其中本次新增 11 项，覆盖：

1. input-only 原生纯计算和派生工件工具保留 restricted。
2. 缺失/未知/矛盾契约、未知 effects、外部读取、运行及子调用均保守。
3. 自动 hooks 不被 tools:[] 隐藏；普通服务/来源/状态声明不被当成自动取数。
4. 按选中能力分类，无计算插件名称白名单，调用者不能注入内部分类字段。
5. 声明、实现摘要及分类变化不能改变已冻结运行。
6. 真实 factor-research + ABU + 完整含留出数据，经真实 evaluator 与原生工作流完成报告和 holdout。
7. 未声明 effects:[] / 任意 Ref 读取工具仍只接受开发数据。
8. 两类运行恢复变更均拒绝继续，不重放任务、不重建会话、不升级留出。
9. input-only 组合仍拒绝超过真实 holdoutEnd 的行。
10. 真实 plugin-manager manifest 的精确公共文本读取保留隔离。
11. 真实参数工具读取与自身工件生命周期捕获。

命令（工作目录 E:/brief2great/sesame/sesame）：

```powershell
$env:TEMP='E:/brief2great/sesame/outputs/workflow-holdout-fix-20261024'
$env:TMP=$env:TEMP
node --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js --test plugins/optional-api-v1/packages/auto-factor-mining/tests/*.test.js plugins/optional-api-v1/packages/abu-parameter-search/tests/*.test.mjs plugins/optional-api-v1/tests/auto-factor-research-access.test.mjs plugins/optional-api-v1/tests/auto-factor-mining-runtime.test.mjs plugins/optional-api-v1/tests/auto-factor-evaluator-diagnostics.test.mjs plugins/optional-api-v1/tests/abu-capability-contracts.test.mjs
```

另使用真实宿主 validateCapabilityManifest 完成两包全部 schema 编译：valid:true，diagnostics:[]，版本一致；见 manifest-validation.log。4 个 JS 文件 node --check 通过、oxlint 通过、git diff --check 通过。代码为原生 JS，本次无 TypeScript 工程变化。

红测证据：red-tests.log 保留原分类错误造成的 4 个预期失败；red-activation.log 保留自动 hooks 在空工具选择下漏判的失败；修复后全部通过。

## 主 Agent 集成

直接更新两包分发锁与组包，等待当前工作完成后切换；既有研究运行和数据不迁移。后续 Sesame 主 Agent 可按任务使用 factor-research 知识、ABU 参数方法及独立 evaluator：方法工具消费工作流已经公开的开发数据，最终留出仍由冻结选择后的原生 evaluator 执行。工具可调用本身不再使隔离作废。真实市场数据、模型长任务与新构建的 UI 交付由主 Agent 继续验证，本子任务未操作 live 应用。
