# 因子数值评估

可独立选择的真实数值计算插件。它不编排 Agent、不绑定模型/券商、不执行交易。工作流通过 `sesame.factor-evaluator/v1` 工具协议选择它，也可以选择任何实现同一协议的已安装工具。

示例选择：

```json
{"plugin_id":"sesame/factor-evaluator","tool":"factor_evaluate","arguments":{"dataset":{"trainEnd":"2024-01-05T00:00:00Z","validationEnd":"2024-01-09T00:00:00Z","holdoutEnd":"2024-01-13T00:00:00Z","horizon":1,"costBps":10,"quantile":0.25},"minRankIC":0,"minCoverage":0.6,"maxCorrelation":0.95}}
```

`dataset_id` 指向注册的数据集。每行 `{time,symbol,availableAt,fields}`，fields 为有限数值且必须含正 close。availableAt 不得晚于 time；禁止重复时间/品种。输入最多 20000 行、4MiB，保存不可变副本并核对摘要。

候选为有界 AST：field、constant、add/sub/mul/div、neg/abs/log/rank/zscore、lag/delta/mean/std/sum；窗口 1..252。不会执行模型生成的任意代码。更换实现或公式语言只需选其他协议工具，工作流不包含 AST 解析器。

真实计算保留训练/验证/留出边界、跨段标签 purge、PIT 校验、缺值、样本数和训练集冗余。Rank IC 为截面 Spearman；ICIR 未年化。收益诊断采用非重叠持有期、多空各半、每次从空仓到空仓，扣双边成本；不是券商回测。最少四个对齐品种，常量/缺值/不完整远期标签不会制造指标。

restricted 模式仅通过工作流给角色开发集，select 冻结候选后 finalize 才计算留出。development-only 模式要求所有行不晚于 validationEnd，不计算留出，明确返回 holdoutMode:none。原始注册数据可被其他通用数据工具读取，因此带研究工具的工作流不能声称该数据仍封存；本插件也不承诺对抗恶意原生插件。

独立复现：`node scripts/reproduce.mjs <run.json> <run.dataset.json>`。比较全部已计算开发指标和冻结选择的最终指标，任何输入漂移都会失败。未完成选择的封存归档不包含原始留出数据，不能用于完整复现。

验证：`node --test tests/*.test.js`。所有测试使用合成价格，没有远程数据、模型或交易调用。需要支持 `executionContext.provenance` 的当前 Sesame dev 主体；能力缺失时直接失败，不回退。
