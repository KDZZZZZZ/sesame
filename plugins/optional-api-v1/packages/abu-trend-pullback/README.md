# ABU Trend Pullback Baseline

这个插件把 ABU 中趋势回撤、黄金分割类示例整理为独立研究基线。它不是标准答案；Agent 可以根据市场结构改进，但必须保存 baseline、假设、改动、试验和 holdout。

## 输入与参数

输入为 UTC 可见 bars。默认参数：

通过 Sesame 原生工具调用时，运行时登记固定输入和输出，返回完整 `input_artifact` 与 `result_artifact`；直接运行 CLI 只把结果写到 stdout 或 `--out` 文件，不自动发布固定成果。

- `trend_window`：长趋势窗口。
- `pullback_window`：短回撤窗口。
- `min_trend_return`：长窗口最小涨幅。
- `min_pullback` / `max_pullback`：短窗口高点到当前 close 的回撤范围。
- `golden_tolerance`：当前 close 距趋势区间 0.382 回撤的容差。

## 公式

`trend_return = (close[t] - close[t-trend_window]) / close[t-trend_window]`

`pullback = (recent_high - close[t]) / recent_high`

`golden_ratio = (trend_high - close[t]) / (trend_high - trend_low)`

若趋势收益达标、短回撤在区间内、当前 close 反弹高于上一 close，则输出候选信号；若同时接近 0.382，则标注 `near_382`。

## 上游差异

参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710` 的趋势回撤与黄金分割示例。本实现只提供一个透明 baseline，不复制 ABU 源码，不声称重现 ABU 完整因子。

## 改进纪律

调阈值、加形态、加量能或接入 Agent 判断时，必须留存原基线输出，并用固定样本外数据验证是否真的改善。

## API 2 调用契约

`abu_trend_pullback_analyze({input})`：组合长趋势、短回撤及反弹条件，输出趋势中回撤的研究观察。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 pullback_window < trend_window，min_pullback <= max_pullback；比例使用小数，例如 0.05 表示 5%。

observations.latest/series 为条件和触发观察，decision_available_at 为最新证据可用时点。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

这是历史形态启发式，不识别市场状态、流动性或订单可执行性，不证明后续反弹。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

## 文件与能力边界

本包属于 `analysis / function`，提供给定证据上的局部确定性处理。算法和调用身份保持独立；研究目标、方法组合、数据来源、原生回测及交易交由调用方选择。

| 文件 | 职责 |
| --- | --- |
| `index.js` | 绑定现有能力，处理调用前取消，委托计算和成果登记 |
| `scripts/baseline.mjs` | 本包算法、参数约束、观察值和局限；保留原 CLI 入口 |
| `scripts/runtime.mjs` | 输入/时间校验、证据摘要、固定成果和 CLI 协议，独立包内交付 |
| `skills/abu-trend-pullback/` | 用法与按需公式参考，不重复实现算法或调度研究 |
| `examples/input.json`、`tests/baseline.test.mjs` | 合成输入、手算预期与异常回归 |

共用 runtime 的源码在仓库 `plugins/optional-api-v1/scripts/abu-runtime.mjs` 维护，以 `sync-abu-runtime.mjs --check/--write` 核验或同步。安装包只导入自己的副本，不相对引用其它插件；公式只在本包 baseline 修改。`implementation_sha256` 继续包含原算法和 runtime 字节，既有固定成果不会重绑。

无需额外配置、API Key 或账户连接；计算参数仍是本次输入，不能移成全局配置。已有固定输入和输出由宿主资源接口管理，无私有研究调度器或交易状态。
