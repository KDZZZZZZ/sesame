# 因子研究 2.0

`sesame/auto-factor-mining` 把策略因子需求落实为查库、证据复用、补评或搜索，使用真实 Qlib 计算和纯因子评价保存结果。已有公式可独立计算，已有不可变 Values 可独立评价。因子库与策略池分别保存；策略明确决定自己的成员。

## 公开入口

| 工具 | 用途 | 返回 |
|---|---|---|
| factor_environment | inspect 现有环境；prepare 私有依赖 | 原生 Run 的实际环境核验结果 |
| factor_research | draft：需求、来源、切分、空间、评价、预算 | 匹配因子或后台 Job |
| factor_measure | compute / evaluate / both | 后台 Job |
| factor_job | read / pause / resume / cancel / report | Job 与分页证据 |
| factor_library | query / read / annotate | 定义与独立评价 |
| factor_pool | read / decide / feedback | 策略池或反馈引用 |

完整接口见 [contracts.md](references/contracts.md)，评价约定见 [evaluation.md](references/evaluation.md)。factor_workflow 和配置读写是宿主内部能力。

## 环境与数据

先调用 `factor_environment({"action":"inspect","pythonPath":"已有 Python 可执行文件绝对路径"})`。prepare 在包私有目录安装锁定依赖，缓存和临时文件也留在该目录；全局 Python 仅作基础解释器或只读核验。基准为 Windows x64 / CPython 3.12、Qlib 0.9.7、DEAP 1.4.4、Optuna 5.0.0；完整实测依赖见 python/requirements-lock.txt。核验使用真实导入，包括 Qlib 原生扩展。

源为 {datasetId} 或 {ref}，后者是完整 kind:data 的固定 ArtifactRef。json-rows 为 {time,symbol,availableAt,fields:{close,...}}。时间是 UTC ISO，可得时点晚于柱收盘的字段不作为当时特征。固定频率网格保留缺失柱，window/horizon 计网格位置。提供的目标字段不能作特征。

以下只展示 both 输入形状；数据集、品种和日期必须换为实际数据，示例本身不是研究证据：

```json
{
  "mode": "both",
  "requestId": "measure-mean-2",
  "source": {"datasetId": "实际数据集 ID"},
  "layout": {
    "universe": ["实际品种"], "frequency": "60min", "timezone": "UTC", "availableAt": "bar_close",
    "development": ["2026-01-01T00:00:00Z", "2026-02-28T23:00:00Z"],
    "holdout": ["2026-03-01T00:00:00Z", "2026-03-31T23:00:00Z"],
    "target": {"kind": "forward_return", "field": "close", "horizonBars": 1}
  },
  "formulas": [{
    "id": "mean-2", "hypothesis": "预先声明的价格平滑假设",
    "formula": {"dsl": "qlib-expr/1", "tree": {"call": "Mean", "args": [{"field": "close"}, {"constant": 2}]}},
    "origin": {"method": "seed", "parents": [], "parameters": {}}
  }],
  "profile": {
    "id": "alpha-ts-v1", "version": 1, "kind": "alpha", "axis": "time_series",
    "minPairs": 20, "minCoverage": 0.8, "stabilityWindows": 4, "maxReferenceCorrelation": 0.95,
    "score": "abs_rank_ic", "diagnostics": []
  },
  "references": [],
  "budget": {"maxCandidates": 1, "batchSize": 1, "maxWorkers": 1, "maxSeconds": 120, "maxInputBytes": 8388608, "maxOutputBytes": 8388608, "seed": 7}
}
```

compute 只需 requestId/budget/source/layout/formulas；evaluate 只需 requestId/budget/valuesRef/profile/references。独立评价不重新取数。references 为已有库因子 ID，其值在同一快照上对齐。

## 执行和证据

Formula 是有类型的白名单树，禁止执行用户字符串。Python 每次执行有界块，Qlib D.features 真实批量计算，单项失败保留成功项。单次进程最长 540 秒，kernels=1，共享磁盘缓存关闭，MLflow 使用明确本地 URI。数据、日历、环境和算子版本进入身份。持久资源不保存旧 attempt 路径。

maxCandidates 计入重复和失败的搜索尝试；maxSeconds 累计活动时间，不计暂停。maxInputBytes/maxOutputBytes 是整项任务各工作块累计读写的字节预算，包含请求和结果回执，并按并行槽预留。单批数据超过额度时，应减小 batchSize/maxWorkers 或明确调整预算，不扩大宿主限制。多品种、多字段的 Qlib provider 使用分层清单，每份资源的固定依赖不超过宿主上限。

开发标签的未来端点越过开发结束时会剔除。特征可以使用分区前历史预热；冻结选择后才访问留出。评价涵盖关联、覆盖率、固定窗口稳定性、参考冗余和条件允许的残差关联；state 使用 eta-squared。placebo、bootstrap、walk_forward、regimes、sensitivity、quantiles 按预先声明选项运行，缺失条件保留原因。收益分位只汇总未来标签，不创建交易组合。

暂停在安全点保存，取消提升 epoch 阻止迟到入库，恢复先核对真实进程回执。回执只返回有界摘要和固定引用。报告经宿主报告能力发布，计算完成与报告发布分别记录。

外部策略通过 factor_pool decide 提供策略身份、expectedVersion、operationId、用途、理由和 applicationEvidence。研究与入库不会自动改池。策略回测、成本与成交验证由外部能力负责。

## 验证与历史材料

设置 `SESAME_PLUGIN_SDK_LOADER` 为匹配应用提供的公开 SDK loader 文件 URL，`PYTHON` 为核验过的私有解释器绝对路径，然后在包目录运行 `npm test`：

```powershell
$env:SESAME_PLUGIN_SDK_LOADER='file:///实际路径/sdk-loader.js'
$env:PYTHON='实际私有环境/Scripts/python.exe'
npm test
```

入口运行本包全部 JavaScript 测试，再运行 `tests/*_test.py` 的搜索与评价测试；compute_python.py 已由 JavaScript 数值测试运行。未设置 PYTHON 时明确提示并跳过依赖 Python 的数值测试，不视为数值验收通过。真实安装宿主测试另需显式配置其隔离夹具，见 [VALIDATION.md](VALIDATION.md)。`npm run schemas:check` 核验静态声明。实际数学测试覆盖缺失柱、嵌套窗口、Ref、排名并列、零分母、未来扰动、开发边界、辅助值与重新物化。

2.0 不兼容旧 auto_factor_*、旧 AST、旧工作流状态或独立 factor-evaluator。声明中 Historical 的 references、reference 脚本和合成 examples 保持来源字节；其中旧命令与策略指标不属于当前接口，也不自动执行。
