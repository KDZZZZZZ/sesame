# 验证范围

数值验收使用真实 Windows x64 / CPython 3.12 私有环境：pyqlib 0.9.7、deap 1.4.4、optuna 5.0.0、numpy 1.26.4、pandas 2.2.3、scipy 1.15.3、mlflow 2.22.2、filelock 3.20.0，以及 python/requirements-lock.txt 的实测传递依赖。Qlib、D.features 和原生 rolling 扩展实际导入；uv pip check 核验全部安装依赖兼容。

设置 `SESAME_PLUGIN_SDK_LOADER` 为匹配应用的公开 SDK loader 文件 URL，设置 `PYTHON` 为该私有解释器绝对路径，在包目录运行 `npm test`。入口先运行本包 JavaScript 测试（其中包含 compute_python.py），再按文件名顺序执行 tests/*_test.py。未配置 PYTHON 会显示数值测试跳过提示；没有 SDK loader 则立即失败。缓存、TEMP/TMP、MPLCONFIGDIR 指向任务私有目录。环境测试通过真实子进程核验，失败不发布 ready。另用 `npm run schemas:check` 检查生成声明一致性。

2026-11-09 最终包级入口实跑：JavaScript 76 项通过，1 项真实宿主测试因未启用其隔离夹具而显式跳过；其中已运行真实 Qlib、环境核验与 worker 全链路。独立 Python 评价 57 项、搜索 12 项全部通过。未配置 PYTHON 的分支已验证会显式跳过数值检查，并输出数值未验收提示；缺少 SDK loader 的分支以非零状态失败。静态声明检查和 git diff --check 通过。

tests/compute.test.js 与 compute_python.py 覆盖真实批量 Qlib 的嵌套滚动、正 Ref、排名并列、零分母、缺失网格、历史预热、未来扰动不变性、开发标签边界、留出目标端点、冻结 covariates、Qlib sensitivity 邻居、provided 目标隔离、摘要损坏拒绝，以及旧 attempt 路径失效后的 provider 重新物化。共享夹具 rowOrderDigest 和开发边界标签逐项匹配。

tests/compute-provider.test.js 使用真实 worker 生成 260 个特征文件，经资源发布与重新物化、原 attempt 目录失效后再次运行 Qlib，数值逐行匹配；每个清单直接依赖不超过 130。Python 另验证 16,385 个特征索引条目的递归分层，以及嵌套组的实际 Qlib 读取。

tests/formula.test.js 核验 Python/JavaScript canonical JSON 和公式身份，包含整数浮点、负零、指数和 Unicode。tests/environment.test.js 验证真实选择、复用及失败无 ready 回执。搜索与评价专用测试分别覆盖 DSL/checkpoint 和对齐矩阵统计，评价约定见 references/evaluation.md。

宿主验收需要匹配 SDK loader、真实 Store、资源发布和 Run 驱动。tests/host-integration.test.js 另以 `SESAME_HOST_ROOT`、`SESAME_FACTOR_PYTHON`、`SESAME_FACTOR_TEST_ROOT` 三个变量显式选择真实宿主、私有解释器和隔离 E: 夹具目录，缺少配置时显示跳过。数学测试通过不替代安装、恢复、取消屏障、资源恢复或报告渲染验证；外层集成验收单独记录。旧工具测试和历史结果不证明 v2。报告完成、原生运行完成和研究结论分别核验。

同日单独启用该真实宿主验收并通过（150.1 秒）：从当前源码安装包及 reports 提供方，6 个任务、31 次 host.process.exec 全部完成，6 份报告通过实际 Electron rendered 回执，模型请求和交易调用均为 0。覆盖独立计算、独立评价、同一 Values 重复评价的不可变身份、精确查库复用、策略池决策及独立应用反馈、真实参考因子、搜索与冻结留出。禁用报告提供方后恢复，沿用原 Run 的第二次 attempt、原会话、Values、报告文件 ID 和单文件路径；恢复前后数值进程数均为 31。证据写在隔离目录的 latest-host-evidence.json，测试不使用用户账户或工作区。

受控故障回归另覆盖原生 UI 中断后的新调用上下文对账、已取消任务的 CAS 入库屏障、报告发布阶段取消屏障、完整尝试预算、累计字节预留和结算、未知子进程回执恢复、并发配置幂等。模块间独立审查发现的问题均已修复；最后的报告发布 epoch 屏障经主实现者独立检查并通过回归。这些受控测试不替代上述真实宿主证据。

2026-11-09 外部迁移验收：包边界、inventory taxonomy 和 helper 同步共 16 项通过，inventory 为 56 个插件，因子研究声明 function + workflow。路由、方法边界和文档 schema 示例 22 项通过。Ultra 全部 52 项通过，包括 research 的 job.runId、measure 的 runId、复用无 Run、取消及跨会话隔离。历史参考材料 23 项通过，包含真实宿主安装、资源读取、CLI 执行及重开；这些历史字节未修改。

独立报告系统仍有既有验收缺口：workflow-report-service 的 4 项夹具不识别 host.reports.describe；investment-report-workflow-host 在旧宿主内置包与当前源摘要不符时停止。这些失败没有按通过计入，不改写为因子计算成功或报告已渲染。

全仓边界检查保留先前已有的 `sesame/reports: plugin.json` 过期审查登记（7 通过、1 失败）。本插件的 37 项 v2 边界变化已按用户明确授权逐项登记；冻结基线和其他插件登记未改。插件锁和 inventory 检查通过，当前为 11 个 core 加 45 个 optional。最终外围分类、路由、合同测试为 36 通过、2 项条件测试跳过。

合成夹具不能证明市场收益、泛化或实盘适用性。未执行诊断和不可用数据保留缺口。
