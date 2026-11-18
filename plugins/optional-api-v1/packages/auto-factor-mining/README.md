# 因子研究 3.1

`sesame/auto-factor-mining` 提供搜索、Qlib 计算、纯因子评价、因子库和策略因子池。主 Agent 或 Agent 工作流直接调用这些能力，决定搜索方向、并行分支、验证步骤和何时交付。

## 公开入口

| 工具 | 输入重点 | 结果 |
|---|---|---|
| factor_environment | inspect / prepare，pythonPath 可选 | 实际环境核验 |
| factor_prepare | source、layout、资源预算 | 固定 snapshotRef |
| factor_search | open 固定搜索空间；propose 请求一批；read 读进度 | 候选公式与 checkpoint |
| factor_compute | snapshotRef、明确公式、partition | 固定 valuesRef |
| factor_evaluate | valuesRef、profile、已计算的 referenceValues | 纯因子评价及入库 ID |
| factor_library | register / query / read / annotate | 用户定义、来源和独立评价历史 |
| factor_pool | read / decide / feedback | 策略选用与应用反馈 |

数值步骤返回原生 Run；调用者通过宿主 Run read/wait 读取最终 output，再安排依赖它的工作。搜索一次只返回本批候选，计算不隐式评价，评价不发起新搜索。不会自动选留出候选、改策略池或生成报告。

完整字段见 [contracts.md](references/contracts.md)，操作方法见 [SKILL.md](skills/auto-factor-mining/SKILL.md)，运行恢复见 [execution.md](references/execution.md)。

## 使用方式

先查因子库。证据已满足目标时可直接引用；已有公式而证据不足时，明确调用数据冻结、计算和评价；缺定义时可按需参考外部公式或开启搜索。独立假设可以并行使用同一快照，不必先生成虚假的搜索请求。

[外部因子来源](references/external-factor-sources.md) 只收参考链接和使用方法。Agent 按任务读取选中的公式，适配成当前类型树，用 factor_library register 保存名称、假设、来源版本、许可证和改写说明。定义属于用户工作区，不随官方插件批量分发；登记无需先跑数值任务。后续真实评价追加到相同数学定义，策略自行决定是否纳入因子池。

Agent 明确指定开发/留出区间、目标、评价标准和搜索空间。开发评价可按 `{factorId,evaluationId}` 回馈搜索器，分数从真实存档读取；留出结果不作搜索反馈。选择候选后，Agent 显式请求 holdout 计算与评价。需要参考比较时，先在同一快照和分区计算参考公式，再传入其 Values 引用。

研究及复杂任务由 Agent 使用报告插件交付统一视觉的报告；策略成员选择与回测由策略研究负责。因子评价不会生成仓位、PnL、Sharpe 或回撤。

## 环境、数据与执行

`factor_environment inspect` 核验真实导入。缺依赖时 prepare 使用已有 64 位 CPython 3.12 创建包私有环境；缓存与临时文件也在私有目录，不修改全局 Python。已验证 Qlib 0.9.7、DEAP 1.4.4、Optuna 5.0.0，完整锁见 python/requirements-lock.txt。

Source 是实际 `{datasetId}` 或固定 `{ref}`（kind:data）；行形状为 `{time,symbol,availableAt,fields:{close,...}}`。UTC 固定网格保留缺失柱，window/horizon 按网格位置计数。目标字段与特征分离，开发标签的未来端点不能越过开发结束；特征可以使用分区前历史预热。

Formula 使用 `qlib-expr/1` 类型树。Ref 仅正滞后，Rank 是滚动时序排名。真实 Qlib `D.features` 批量计算，单项失败保留同批成功项；大矩阵和 provider 分片为不可变资源，返回有界摘要与固定引用。

每个操作声明资源预算；搜索会话累计候选尝试（含重复/失败）、活动时长与 worker 输入/输出字节（含请求、结果及数值文件）。JS 元数据另受声明和资源大小上限约束。每个 Python 块单进程、最长 540 秒；跨块并行由 Agent 与宿主安排。原生 Run 支持观察和控制；中断恢复核对已保留回执，不盲目重放。

## 验证

设置 `SESAME_PLUGIN_SDK_LOADER` 为匹配宿主公开 SDK loader 的文件 URL、`PYTHON` 为核验私有解释器，在包目录执行 `npm test` 和 `npm run schemas:check`。真实宿主夹具配置见 [VALIDATION.md](VALIDATION.md)。

因子定义、评价及策略池的数据模型保持独立。研究调度与报告交付由调用方 Agent 或工作流负责。
