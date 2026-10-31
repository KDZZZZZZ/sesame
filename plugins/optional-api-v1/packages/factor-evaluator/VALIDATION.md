# 验证范围

`tests/engine.test.js` 保留真实算术的固定答案：完美/反向排序、成本、ICIR、非重叠持有期、跨段 purge、留出不影响开发、训练冗余、PIT、时间戳、重复行、不可变副本、缺值、窗口、溢出、缺失远期报价、有界 AST。

`tests/protocol.test.js` 验证真实工具回执、不可变候选与选择、冻结前不能最终评价、调用者绑定、直接 Agent 调用拒绝，以及 development-only 输入不得含留出行。

`tests/diagnostics.test.js` 使用可复现合成数据覆盖单品种时序、显式多品种时序等权聚合及七项可选评估：真实信号与置换对照、随机种子复现、MC 的不同终值路径、配对 block-bootstrap CI、共同市场时间块、无未来泄漏、walk-forward 窗口隔离、参数邻域、状态小样本、development-only OOS 状态、单项错误不阻塞、异步取消、250 品种结果大小。复制同一个序列为第二品种时，bootstrap 区间不会因为伪独立样本变窄。

协议测试也验证：负相关在未设阈值时仍可继续研究；仅用户明确硬门槛生效、旧参数建议化；诊断缺字段／参数或失败不影响基础可测候选；全无可测结果时空选择完成且不声称评估留出；最终 OOS 元数据仅在选择冻结后产生。

外层 `plugins/optional-api-v1/tests/auto-factor-mining-runtime.test.mjs` 验证与工作流的真实计算、冻结选择和独立复现脚本；`auto-factor-mining-packages.test.mjs` 用官方 buildLock 验证两个包均无跨包源码导入。实际宿主安装与调用边界由外层 `auto-factor-mining-host.test.mjs` 覆盖：真实 Store/插件安装器/工具循环，仅模型传输和价格为本地合成夹具。设置匹配宿主的 `SESAME_PLUGIN_SDK_LOADER` 后，在 `plugins/optional-api-v1` 运行 `npm test` 会自动收集这些测试。此验证不构成市场有效性结论。


1.2 新增 `tests/search-diagnostics.test.js`：原论文 DSR 示例（约 0.9004）、46/88 次对照、矩估计与年化单位、非正态与多重试验方向、手算 CSCV 反转 1／持续赢家 0、同分和列置换不变性、上下界、缺失／常量／不完整矩阵、失败试验、区间不一致、持有集改动无影响及取消。`tests/evaluation-plan.test.js` 验证建议与用户硬要求、子情景条件证据、完全不可测、计划摘要、拒绝 holdout／原型路径。协议回归验证先 deferred 后全试验统计、未入选者仍参与、不可变候选、失败尝试允许合法修正、显式硬要求在 select 解析和未满足时不冻结。

这些测试是合成数值及协议验收，不能证明任何实际市场因子盈利。未估计串行相关修正、有效独立试验数或上游未登记搜索；未连接原生成交矩阵。不可算状态本身是验证结果，不伪造完成值。

真实合成分层回归中，全局关联接近零但两个事前状态层约为 +1/-1：建议阈值下可 conditional 研究，显式 user required 的同一全局阈值下不能入选。完整 40 试验／20 所选／40 建议阈值／9 诊断验证候选 64KiB 与选择 512KiB 回执边界。便携复现测试还核对完整搜索数值，移除未入选输家或改写 DSR 值都会失败。
