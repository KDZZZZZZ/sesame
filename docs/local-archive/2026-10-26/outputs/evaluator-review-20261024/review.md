## 修复后独立复核

时间：2026-10-24T15:11:44.210Z。FE-REVIEW-1 已由主线程修复，本审阅仍只读。当前没有未解决发现。

相同稀疏输入从 6,060ms 降至 112ms；10ms 取消的观察延迟从 2,410ms 降至 51ms。旧/新六类输入的状态和结构均一致，稀疏/截面输出完全一致，少量时序 IC 区间差异最多 1.11e-16（浮点累加次序）。全部七项诊断在新实现上用相同输入和 seed 重跑两次，完整结果 deepEqual 一致。

详见 [修复验证](<E:/brief2great/sesame/outputs/evaluator-review-20261024/post-fix-verification.json>) 和 [逐场景对照](<E:/brief2great/sesame/outputs/evaluator-review-20261024/bootstrap-comparison.json>)。历史审阅结论保留如下。

---

# 因子评估扩展只读审阅

结论：发现 1 项 P2 工作量/取消问题。未发现阻塞发布的时点泄漏、留出集提前读取、随机 seed 失效或未测假通过问题。代码未修改。

## P2：稀疏多品种 bootstrap 的工作量预算低估千倍

位置：[diagnostics.js:279](<E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/factor-evaluator/diagnostics.js:279>)（预算位于 sampling；共享抽样循环位于 270–284 行）。
每个品种都遍历 sampledTimes 全部市场时间，再过滤自己没有的数据。共享时间抽样是正确方向，但在各品种交易时段错开/数据稀疏时，开销变成 品种数 × 市场时间并集 × 复样次数；工作量上限却按观测行数估算。

- 合法合成输入：1,000 品种、15,000 行、2,083,871 字节；每品种 2 条训练、12 条错开时间的验证、1 条留出记录。
- bootstrap={samples:20,seed:1,blockSize:2}；11,000 条有效观察被计为 220,000 次复样工作，实际循环含 220,000,000 次 Map.get，实测约 5.99 秒。
- 首次批次开始后安排 10ms 取消，约 2.41 秒才被观察；现有取消测试在首个 yield 前发出取消，未覆盖这段密集循环。
- 最小修复：每次共享时间抽样只构建一次时间出现次数，各品种遍历自身观测并应用共享次数；保留相同市场 draw、配对和缺失结构。大型批次内补取消检查，或按真实笛卡尔扫描量限制预算。

复现：[reproduce-sparse-bootstrap.mjs](<E:/brief2great/sesame/outputs/evaluator-review-20261024/reproduce-sparse-bootstrap.mjs>)。执行 node 加该文件路径即可；只用本地合成数据。

## 已核验范围

- 开发阶段截断 holdout；walk-forward 阈值只拟合更早训练数据，跨折末端标签被 purge。
- 共享时间块及 factor/label 配对；重复品种不凭空增加独立确认。
- 单项异常隔离、取消传播、not-requested/unavailable/partial 等状态。
- plan/seed 进入固定候选证据与归档复现；最终留出依赖冻结选择。
- 大量品种的回执明细有上限，汇总保留全体；schema/协议与新诊断名一致。
- 独立复跑 diagnostics.test.js：15/15 通过（403.54 ms）。父侧已有 71+3 测试结果未重复作为本审阅运行。

详细结果和源码指纹：[review.json](<E:/brief2great/sesame/outputs/evaluator-review-20261024/review.json>)。未跑全局清单/锁，未操作 live Sesame，未取真实行情或调用模型。
