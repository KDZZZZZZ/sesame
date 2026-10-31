# 按需求发现插件与因子工作流适配 — 2026-10-24

已修改、验证、构建并沿用现有本地数据打开新版：

`E:/brief2great/sesame/mt5agent/output/desktop-plugin-discovery-20261024-vYmTEE/package/win-unpacked/Sesame.exe`

## 查到的实际行为

上一轮没有启动因子工作流，并非旧系统提示仍在生效。运行包与源码一致；真实模型日志在研究开始和上下文压缩后均包含新版总提示。模型实际执行了 plugin_discover(factor)、host_capabilities_list(kind=workflow)，也加载了 auto-factor-mining 和 factor-evaluator，随后改为普通子 Agent 与主 Agent 脚本研究。

公开 auto_factor_start 是 function，effects 包含 start:workflow；内部 auto_factor_workflow 才是仅供宿主执行的 workflow。只按 kind=workflow 查找会漏掉公开入口，但本轮已成功加载插件，所以不能把全部原因归为发现失败。

明确转达启动要求后，真实模型调用了 auto_factor_start，评估准备因缺 dataset_id/inputRef 被拒绝，未产生原生因子 workflow Run。其后模型又要求用户切换账户以收集至少四个品种。代码核实当前内置评估器只计算至少四个对齐品种的横截面 Rank IC；单品种 XAUUSD 时序进出场、胜率和盈亏比需要相应评估实现。更换账户不是这个适配差异的修复。

## 本次改动

- 宿主总提示：实质任务和能力缺口触发按目标、输入、交付主动发现插件；不把默认挂载工具当全部能力。读取声明、核对输入形状和评价目标、加载匹配插件并调用；同时识别公开工作流启动函数。最大努力研究须有实际 workflow Run 受理，轻量快速例外保留。
- orchestration 3.1.5：同步发现、适配、实际启动与交付规则。经核对没有合适工作流时说明具体缺口，普通子任务不冒称工作流。
- auto-factor-mining 1.1.5：在发现摘要、公开启动能力、prompt、skill 和 README 中说明因子搜索、多候选试验、组合比较等场景；明确工作流与 evaluator 的职责，以及当前内置评估器的四品种横截面条件。不能为凑现有评估器改变单品种目标或要求切账户。
- 修复 native workflow 新报告输出硬编码 Research：新建任务归 Strategy，恢复已有 Run 沿用原绑定。

未增加单品种时序评估器，也未把横截面指标改名为胜率或策略回测。

## 验证

- 宿主提示词与实际插件加载链 13/13 通过，包括发现→加载→模型上下文、禁止插件状态和限定子 Agent 上下文。
- 新 Strategy 工作流回归修复前失败，修复后通过；验证实际完成的原生工作流、报告绑定与幂等复用。
- 因子运行、独立包边界及统一报告测试 37/38 通过；其中旧 handoff 事件断言失败，用修改前 runtime 快照也重现了同样失败。另行新增的 Strategy 回归通过。记录分别见 factor-regression.log、factor-baseline-handoff.log、factor-space-green.log，未把旧失败算作通过。
- JS 语法、定向 lint、diff 检查与官方包声明/锁文件验证通过。
- Electron 包验证通过；运行中 56/56 插件和 239/239 宿主模块摘要匹配当前源码。部署前确认全部空闲并备份数据库；历史消息、报告修订、Run 状态、模型和插件状态保留。
- 真实模型执行暴露了上述输入/评估器不匹配，不能据此宣称因子研究工作流已启动或研究完成。先前只在发现阶段停止的探针不足以证明执行成功。

精确增量保存在 before/、after/、task-changes.patch 和 task-change-index.json；当前运行版本与数据保留核对见 deployment-verification.json。全部构建、临时文件和备份位于 E 盘。
