# factor-evaluator 1.1.0 交付记录

修改范围仅为 `sesame/plugins/optional-api-v1/packages/factor-evaluator/**`。未更改宿主、工作流、inventory、锁、线上工作区、账户或模型；未获取真实市场数据、执行用户研究或交易，未新增外部依赖。

## 行为

- 单品种可运行同一工作流：`dataset.mode:auto` 自动选择 `time-series`，多品种可显式选择时序（逐品种独立相关性后等权聚合），或使用原截面方法。
- 七项扩展诊断按需求选择，缺省不运行。安慰剂、蒙特卡洛路径、样本外、walk-forward、参数敏感性、状态分层、block-bootstrap 均已实现并各自测试。不适用／数据不足／单项错误记录自身状态，其他评估与交付可继续。
- 三个阈值 `minRankIC/minCoverage/maxCorrelation` 仅显式设置时成为选择门槛；基本关联完全不可测时不会变成 eligible。全不可测可空选择并完成，`holdoutStatus:not-requested`。
- Monte Carlo 回答经验路径分布，bootstrap 回答统计量区间，安慰剂回答信号对齐相对打乱对照的结果；不会把三个问题混作同一个通过条件。
- 多品种时序 bootstrap 共用市场时间块，保留同时冲击；随机循环有预算、种子和取消响应，明细有上限而聚合不漏品种。

## 接口与集成

`sesame.factor-evaluator/v1` 和 prepare/candidate/select/finalize 的必要请求、回执结构保持。新增 `options.dataset.mode`、`options.diagnostics`；七键分别为 `placebo/monteCarlo/outOfSample/walkForward/sensitivity/regimes/bootstrap`，值为 true、false 或项目配置对象。

`metrics.diagnostics` 的状态是 `completed/partial/not-requested/not-applicable/unavailable/error`；completed 表示算完，不表示科学结论通过。`metrics.diagnosticPlan` 用于确定性归档复现。选择前 OOS 明确留出 deferred；选择后 finalize 才给实际留出结果。

主 Agent 集成点：同步 AFM 的可发现说明与单品种/诊断参数示例，保留候选回执的诊断状态进入最终报告；更新锁及分发包。父侧已报告 3/3 真实 evaluator + 原生 AFM 集成通过，包括单品种与知识包组合、可选诊断缺项仍完成、全不可测空选择仍报告。

## 验证

命令：`node --test plugins/optional-api-v1/packages/factor-evaluator/tests/*.test.js`。最终 **71/71 通过**（改前 53/53）。日志：`unit-tests.log`。

- 15 个诊断专项覆盖七项计算、信号/噪声、种子复现、无未来泄漏、walk-forward 隔离、局部参数、状态小样本、置信区间、共同时间块、部分失败、取消、250 品种回执大小。
- 保留原数值、输入身份、PIT、可信调用者、会话 CAS、冻结选择与复现测试；新增门槛显式选择、空选择、OOS 冻结元数据。
- 归档复现测试包含随机诊断计划与最终 OOS 状态，不只比较原基础指标。
- `node --check` 四个修改实现文件和 `git diff --check` 通过。
- oxlint 无错误；`lint.log` 中 4 条 unused 解构警告来自原 `saveSession` 字段排除逻辑，未增加警告。

调研表见 `RESEARCH.md`，七项均有定义、任务适配、方法、依赖成本、可跳过条件、假设、输出、覆盖状态、一手链接和验证方式。实际功能配置说明保存在插件 `DIAGNOSTICS.md`，并加入可发现知识引用。

## 精确改动

`engine.js`；`diagnostics.js`（新增）；`evaluator.js`；`scripts/reproduce.mjs`；`capabilities.json`；`plugin.json`；`package.json`；`prompt.md`；`README.md`；`PROTOCOL.md`；`DIAGNOSTICS.md`（新增）；`VALIDATION.md`；`tests/diagnostics.test.js`（新增）；`tests/protocol.test.js`；`tests/input-ref.test.js`。

完整改前/改后快照为 `before/factor-evaluator/` 与 `after/factor-evaluator/`。本次精确差异为 `task-changes.patch`，15 个变更文件的前后 SHA-256 见 `change-index.json`。未提交其他人的脏改动。

## 方法边界

时序 IC 和训练分位点方向收益是因子研究证据，不是经纪商逐笔成交结果、止盈止损回测、胜率或 R 倍数。walk-forward 测试固定候选，不重新挖掘候选；敏感性是局部单参数邻域；状态分层使用显式 PIT 字段；bootstrap 是区块百分位区间；安慰剂循环移位依赖近似平稳。完整多重检验/PBO、全局参数交互和隐状态模型没有实现，也不作为当前任务的必做门槛。
