# 因子数值评估

可独立选择的真实数值计算插件。它不编排 Agent、不绑定模型/券商、不执行交易。工作流通过 `sesame.factor-evaluator/v1` 工具协议选择它，也可以选择任何实现同一协议的已安装工具。

示例选择：

```json
{"plugin_id":"sesame/factor-evaluator","tool":"factor_evaluate","arguments":{"dataset":{"trainEnd":"2024-01-05T00:00:00Z","validationEnd":"2024-01-09T00:00:00Z","holdoutEnd":"2024-01-13T00:00:00Z","horizon":1,"costBps":10,"quantile":0.25},"minRankIC":0,"minCoverage":0.6,"maxCorrelation":0.95}}
```

输入二选一：顶层 `dataset_id` 指向注册数据集，或者 `arguments.inputRef` 指向完整固定 DataRef。后者由工作流原样传给评估器的 `options.inputRef`，不需要创建宿主 dataset。例：

```json
{"plugin_id":"sesame/factor-evaluator","tool":"factor_evaluate","arguments":{"inputRef":{"id":"<公开回执的 id>","revision":"<原 revision>","digest":"<原 sha256 摘要>","kind":"data","schemaVersion":"1.0.0"},"dataset":{"trainEnd":"2024-01-05T00:00:00Z","validationEnd":"2024-01-09T00:00:00Z","holdoutEnd":"2024-01-13T00:00:00Z"}}}
```

示例占位值必须替换成实际能力回执；不能把路径、SourceRef、ResourceRef 或只有 id 的对象当作 DataRef。固定输入只接受已发布的 `json-rows`，核验完整引用、manifest/blob 摘要、分页字节、rowCount 和来源。每行 `{time,symbol,availableAt,fields}`，fields 为有限数值且必须含正 close。availableAt 不得晚于 time；禁止重复时间/品种。输入最多 20000 行、4MiB，保存不可变副本并核对摘要。原始行情到数值面板的真实转换与执行证据由研究/数据能力负责，本插件不会补造字段。

prepare 的 `data.inputRefs` 保留完整引用，`provenance` 和 `dependencies` 保留源 manifest 的记录；完整 Ref 参与输入摘要，同一会话不能更换 revision，即使新版本的行相同。工作流最终报告应将 inputRefs 绑定为 Artifact 依赖，让输入的原证据谱系继续可查。

候选为有界 AST：field、constant、add/sub/mul/div、neg/abs/log/rank/zscore、lag/delta/mean/std/sum；窗口 1..252。不会执行模型生成的任意代码。更换实现或公式语言只需选其他协议工具，工作流不包含 AST 解析器。

真实计算保留训练/验证/留出边界、跨段标签 purge、PIT 校验、缺值、样本数和训练集冗余。Rank IC 为截面 Spearman；ICIR 未年化。收益诊断采用非重叠持有期、多空各半、每次从空仓到空仓，扣双边成本；不是券商回测。最少四个对齐品种，常量/缺值/不完整远期标签不会制造指标。

restricted 模式仅通过工作流给角色开发集，select 冻结候选后 finalize 才计算留出。调用工作流在给受限角色的上下文中应移除原 inputRef、inputRefs 及可追溯原始数据的 provenance 引用，仅保留开发证据和不可用于寻址的来源摘要；主会话与归档保留完整来源。宿主基础资源读取能力可以读取完整已发布 Ref，不能只隐藏 rows 却暴露读取留出的地址。development-only 模式要求所有行不晚于 validationEnd，不计算留出，明确返回 holdoutMode:none。原始注册数据可被其他通用数据工具读取，因此带研究工具的工作流不能声称该数据仍封存；本插件也不承诺对抗恶意原生插件。

独立复现：`node scripts/reproduce.mjs <run.json> <run.dataset.json>`。比较全部已计算开发指标和冻结选择的最终指标，任何输入漂移都会失败。未完成选择的封存归档不包含原始留出数据，不能用于完整复现。

验证：`node --test tests/*.test.js`。所有测试使用合成价格，没有远程数据、模型或交易调用。需要支持 `executionContext.provenance` 的当前 Sesame dev 主体；能力缺失时直接失败，不回退。
