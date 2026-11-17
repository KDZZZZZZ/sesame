# 验证范围

本页记录 3.x 的 Agent 直接调度实现。2.0 的自动研究/报告验证保留在 Git 历史中，不作为新版已移除功能的验收。

## 可复现入口

设置 `SESAME_PLUGIN_SDK_LOADER` 为当前宿主公开 SDK loader 的文件 URL，`PYTHON` 为核验过的私有解释器，在本包执行 `npm test` 与 `npm run schemas:check`。未设置 Python 明确跳过数值验收；缺少 SDK loader 直接失败。

真实宿主测试另设置 `SESAME_HOST_ROOT`、`SESAME_FACTOR_PYTHON`、`SESAME_FACTOR_TEST_ROOT`，分别指定当前宿主源码、私有 Python、隔离测试目录。测试使用临时 Store 和源码安装，不读取用户工作区或账户，不请求模型或交易。

已验证环境为 Windows x64 / CPython 3.12、pyqlib 0.9.7、deap 1.4.4、optuna 5.0.0；完整实测传递依赖在 python/requirements-lock.txt。缓存和临时文件放在 E: 隔离目录。

## 覆盖内容

- 直接 prepare/search/compute/evaluate：每次只执行指定步骤，没有自动查库、计算参考、选留出、下一批、策略选池或报告副作用。
- 原生 Run：固定结果幂等、活动重复拒绝、暂停时间排除、实际子进程回执核对、同 requestId 显式重提、原生取消后的事务屏障。
- 搜索会话：固定空间和 checkpoint、累计尝试及资源预算、同会话并发 CAS、pending 请求恢复；反馈必须来自同一快照/profile/候选/参考的真实 development 评价。
- 计算：真实 Qlib 批量运算、缺失网格、预热、正 Ref、嵌套窗口、排名并列、零分母、未来扰动、开发标签边界、辅助值、重新物化。260 特征文件真实 provider 与 16,385 条索引分层覆盖仍保留。
- 评价：真实矩阵统计、关联/覆盖/稳定性/参考比较、state 类别分离、六类可选诊断、required 与 optional 区分。57 项 Python 评价回归与 12 项真实 DEAP/Optuna 搜索回归保留。
- 库与池：用户定义与来源登记、精确评价读取、不可变证据身份、分页历史、显式策略选择、应用反馈不改纯因子评价。登记不依赖环境或数值执行；同公式真实评价保留来源并合并到原 ID。
- 外围：当前 schema 文档示例、目录路由、Ultra 对独立 native function 的并行与取消跟踪；删除仅为旧总控 Job 回执增加的适配。

2026-11-09 最终完整包入口实跑：93 项 JavaScript 通过，2 项真实宿主夹具因未启用其变量而显式跳过；真实 Python 评价 57 项、搜索 12 项全部通过。已包含原生恢复、schema 容量、丢失进程引用和首次异常观察的回归，验证实际失败分支。真实宿主夹具随后按以下独立记录验收。

同日显式启用真实宿主验收：源码安装 3.0.0，20 个有记录的公开原生操作、32 个 process Run、14 次数值 worker 完成。seed/template/random/deap/optuna 五种来源实际执行；搜索尝试 10 次，开发评价按真实库 ID 反馈。holdout 反馈拒绝且不启动 worker；环境、冻结、计算、评价、库、显式池决策分别调用。模型调用、隐式研究工作流和报告创建均为 0。

安全 checkpoint 恢复沿用原 Run 的第 2 次 attempt，数值 worker 数 13→13。取消评价后因子库未改变，再显式同 requestId 新 Run 消费完成回执，worker 数 14→14。最后一次主链复验 122.33 秒。独立真实 SDK 探针 4 项通过，覆盖进程中断后原 Run 返回 RESUME_UNSUPPORTED、安全恢复，以及 state.commit 的异步 schema 校验窗口取消屏障。证据分别为隔离目录中的 agent-directed-host-evidence.json 与 native-sdk-lifecycle-evidence.json。

外围验证：Ultra 52 项通过；文档示例经真实宿主 schema 与语义校验 2 项通过；插件分类 10 项通过。分类现在直接为 function，不再通过额外例外将它标成研究工作流。

全仓既有 `sesame/reports: plugin.json` 过期边界登记不在本次范围，不重写其历史基线。独立报告系统的旧夹具失败也不计为因子插件测试通过。

## 3.1 按需登记（2026-11-10）

官方包只新增外部参考链接及适配说明，没有复制 qlib-factor-zoo 源码或批量导入公式。先在旧实现上取得登记接口缺失的失败证据，再补齐实现。完整包入口实跑 108 项 JavaScript 通过、2 项 opt-in 宿主夹具明确跳过；57 项 Python 评价及 12 项搜索回归全部通过。

新增 12 项库回归覆盖登记/评价同 ID、别名与来源去重、固定结果幂等、同操作冲突、并发登记及评价 CAS、提交中取消、HTTPS 来源与字段上限、禁止手填分数、未评价查询隔离。新增 3 项公开 schema 回归检查闭合字段、文字/来源边界、未评价输出和查询；schema 生成一致性与修改文件语法检查通过。

随后单独启用真实宿主夹具，源码安装 3.1.0，通过公开工具登记合成公式；登记前后 Run、process、worker、模型、工作流及报告均未新增。登记时评价数为 0，真实 Qlib 计算及评价后同一 factorId 的评价数为 1，来源资料保持。完整宿主验收 147.60 秒，20 个原生操作、32 个 process Run、14 次数值 worker，0 模型/券商调用；恢复与取消后重提仍不重复计算。独立实现及契约审查未发现阻塞项，目录分类 10 项通过。证据位于隔离验收目录的 agent-directed-host-evidence.json。
