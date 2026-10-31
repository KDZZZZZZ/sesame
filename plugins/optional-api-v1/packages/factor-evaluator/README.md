# 因子数值评估

可独立选择的真实数值计算插件。支持单品种时序和多品种横截面因子评价，并按研究问题选择稳健性诊断。它不编排 Agent、不绑定模型/券商、不执行交易。工作流通过 `sesame.factor-evaluator/v1` 工具协议选择它，也可以选择任何实现同一协议的已安装工具。

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

真实计算保留训练/验证/留出边界、跨段标签 purge、PIT 校验、缺值、样本数和训练集冗余。`dataset.mode` 默认 `auto`：一个品种选择 `time-series`，多个品种选择 `cross-sectional`；也可明确指定。

- `cross-sectional`：至少四个对齐品种的逐期 Spearman，再取时间平均。ICIR 未年化。方向收益诊断采用非重叠持有期、多空各半、每期空仓到空仓并扣双边成本。
- `time-series`：逐品种的因子与远期收益 Spearman，再对可测品种等权平均。单品种即可使用；不会把不同品种的价格混成同一序列。方向阈值只使用训练期因子分位点，在后续验证与留出固定；每期对触发方向的品种等权，非重叠持有并扣双边成本。时序模式不计算截面 ICIR。
- 两者都不把相关性或理想化方向收益冒充逐笔胜率、止盈止损触发结果或 R 倍数。需要这些结果时，由工作流组合交易规则知识和执行级回测能力。常量、缺值和不完整远期标签不会制造指标。

1.2.0 改变了阈值语义：旧 `minRankIC`、`minCoverage`、`maxCorrelation` 都是建议证据，Agent 传参本身不代表用户要求。新 `options.evaluationPlan` 保存所选 tests、thresholds 和 reasons；只有阈值同时声明 `source:user` 与 `mode:required`，且确有用户明确要求时才限制选择。总体关联、真实方向收益或可测开发子样本可支持继续研究；总体关联不可测但存在分层／前推证据时标记 conditional，保留其范围与局限。所有证据均不可测时 `eligible:false`；空选择仍可完成。没有统一总分，也不要求九项都通过。

`options.diagnostics` 按需选择安慰剂、蒙特卡洛路径、样本外、walk-forward、参数敏感性、状态分层、block-bootstrap 区间、DSR 与 PBO；缺省不额外运行。不适用、缺数据或单项错误均保留状态与原因，其他诊断继续，也不影响已得到的基础测量。九项不是每次必须跑完的清单。配置、状态和方法见 [DIAGNOSTICS.md](./DIAGNOSTICS.md)。

restricted 模式仅通过工作流给角色开发集，select 冻结候选后 finalize 才计算留出。调用工作流在给受限角色的上下文中应移除原 inputRef、inputRefs 及可追溯原始数据的 provenance 引用，仅保留开发证据和不可用于寻址的来源摘要；主会话与归档保留完整来源。宿主基础资源读取能力可以读取完整已发布 Ref，不能只隐藏 rows 却暴露读取留出的地址。development-only 模式要求所有行不晚于 validationEnd，不计算留出，明确返回 holdoutMode:none。原始注册数据可被其他通用数据工具读取，因此带研究工具的工作流不能声称该数据仍封存；本插件也不承诺对抗恶意原生插件。

独立复现：`node scripts/reproduce.mjs <run.json> <run.dataset.json>`。比较全部已计算开发指标、完整试验搜索诊断和冻结选择的最终指标，任何输入漂移都会失败。未完成选择的封存归档不包含原始留出数据，不能用于完整复现。

验证：`node --test tests/*.test.js`。所有测试使用合成价格，没有远程数据、模型或交易调用。需要支持 `executionContext.provenance` 的当前 Sesame dev 主体；能力缺失时直接失败，不回退。

## 文件与能力边界

本包属于 `analysis / function`，对明确候选和固定数据进行局部数值评估；研究目标、候选生成、角色分工和试验调度由选定工作流负责。

| 文件 | 职责 |
| --- | --- |
| `index.js` | 注册原 `factor_evaluate` 能力并传递原执行上下文 |
| `engine.js` | 有界 AST、数据/时间校验、训练/验证/留出数值和比较；不执行外部代码 |
| `diagnostics.js` | 独立可选的稳健性诊断、固定种子、计算预算与单项结果；不作统一通过判定 |
| `search-diagnostics.js` | 完整试验 DSR、CSCV/PBO 数值及缺失／失败／同步检查；只用开发验证期 |
| `evaluation-plan.js` | 任务所选计划、显式用户硬要求及有条件可测证据，不生成统一分数 |
| `evaluator.js` | 原协议与可信调用者、固定输入、候选/选择/最终回执、会话 CAS 与串行写入 |
| `PROTOCOL.md` | 调用方选择评估器、提交候选、冻结选择和结果交接 |
| `DIAGNOSTICS.md` | 九类诊断的任务适配、输入配置、方法和结果解释 |
| `scripts/reproduce.mjs`、`tests/` | 固定证据复现、手算预期和协议/权限/并发回归 |

状态继续由原 `sessions` 集合和宿主资源管理，内存队列只串行化同一会话的变更。它是评估业务状态，不是可编辑配置；不拆出第二个会话所有者。现有两层已经分开纯计算与有状态协议，新增搜索统计与计划模块仍由这个会话所有者调用。

本包没有 API Key、账户或独立模型配置；数据和阈值通过原调用输入指定。真实模型与来源凭据由各自所属入口管理，不增加虚构的 `configurationRequirements`。

DSR/PBO 在 select 使用本会话全部候选的实际逐期诊断组合收益，未入选和不合阈值的候选也在内。候选阶段为 deferred；失败尝试、缺收益、区间不一致、收益零方差均保留原因，不只拿赢家计算，也不以零补齐缺值。这里的收益来自固定理想化方向组合；执行级策略回测需要独立真实成交产物，不能把两者混称。详见 [原始方法与数值约定](./DIAGNOSTICS.md#dsr-与-pbo)。

条件证据默认标记 `exploratory-development`：同一开发集上看到某层较好并不等于该条件已经独立验证。`conditions` 保留可测层／时间段，`invalidations` 保留不可测层与未达阈值；原诊断保留所有正反结果。工作流可据此说明适用范围和后续验证，但不能跳过用户明确硬要求。
