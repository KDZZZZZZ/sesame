# ABU Position Sizing Baseline

这个插件把 ABU ATR 仓位、Kelly 仓位和价格分位仓位思想整理为独立研究基线。它不是标准答案；Agent 可以按经纪商、合约乘数、组合风险或风控政策改进，但必须保留 baseline、假设、改动、试验和 holdout。

## 输入与参数

需要 `account.equity`、`account.currency`、`instrument.price_currency` 与 UTC 可见 `bars`。如果提供 `instrument.quantity_unit`，也必须同时提供 `instrument.point_value`；否则输出会明确标记为数学上的 cash-per-price-point，而不是 broker 数量。

通过 Sesame 原生工具调用时，运行时登记固定输入和输出，返回完整 `input_artifact` 与 `result_artifact`；直接运行 CLI 只把结果写到 stdout 或 `--out` 文件，不自动发布固定成果。

参数：

- `atr_window`
- `atr_stop_multiple`
- `risk_fraction`
- `kelly_win_probability`
- `kelly_avg_win_loss_ratio`
- `kelly_fraction_cap`
- `kelly_fraction_multiplier`
- `price_rank_window`

## 公式

`risk_amount = equity * risk_fraction`

`price_risk = ATR * atr_stop_multiple`

若 `price_risk` 为 0 或过小，输出 `status: undefined_price_risk`，仓位估计为 `null`，不会输出 Infinity。

`cash_per_price_point_estimate = risk_amount / price_risk`

如果声明了 `instrument.point_value` 和 `instrument.quantity_unit`：

`quantity_estimate = cash_per_price_point_estimate / point_value`

`raw_kelly_fraction = p - (1-p) / avg_win_loss_ratio`

`capped_kelly_fraction = clamp(raw_kelly_fraction, 0, kelly_fraction_cap)`

`effective_kelly_fraction = capped_kelly_fraction * kelly_fraction_multiplier`

`price_rank` 为当前 close 在最近窗口 close 中的百分位排名。

历史序列使用同一个 `account.equity` 对每一行做常量权益假设，即 constant-equity hypothetical scenario，不代表账户净值随历史交易变化。

## 上游差异

参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710` 中 ATR/Kelly/价格分位仓位思想。本实现不复制 ABU 代码；只有在输入声明 point value 和 quantity unit 时才输出数量估计，否则只输出 cash-per-price-point。

## 改进纪律

Agent 可加入合约乘数、最小交易单位、组合风险预算、货币换算和相关性约束，但必须显式验证单位，并保留原基线和样本外对照。

## API 2 调用契约

`abu_position_sizing_analyze({input})`：在明确权益、币种和标的单位假设下计算 ATR 风险预算、分数 Kelly 与价格排名仓位基线。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 account:{equity>0,currency}；instrument:{price_currency,quantity_unit?,point_value?}。币种和数量单位代码须为 2..32 字符的大写标识；quantity_unit 与 point_value 必须同时提供或同时省略。point_value 表示每个数量单位每一个价格点对应的资金金额，不能把它误作最小跳动。

observations.account/instrument 保留单位假设，latest/series 给出风险/仓位观察，decision_available_at 为证据可用时点。省略数量换算时只得到资金/价格点维度的计算，不是券商下单手数。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

equity 是整段计算的固定假设，不是模拟权益轨迹。Kelly 的概率和盈亏比来自输入假设；未校准概率不能当作可靠盈利概率。本能力不发单。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

## 文件与能力边界

本包属于 `analysis / function`，提供给定证据上的局部确定性处理。算法和调用身份保持独立；研究目标、方法组合、数据来源、原生回测及交易交由调用方选择。

| 文件 | 职责 |
| --- | --- |
| `index.js` | 绑定现有能力，处理调用前取消，委托计算和成果登记 |
| `scripts/baseline.mjs` | 本包算法、参数约束、观察值和局限；保留原 CLI 入口 |
| `scripts/runtime.mjs` | 输入/时间校验、证据摘要、固定成果和 CLI 协议，独立包内交付 |
| `skills/abu-position-sizing/` | 用法与按需公式参考，不重复实现算法或调度研究 |
| `examples/input.json`、`tests/baseline.test.mjs` | 合成输入、手算预期与异常回归 |

共用 runtime 的源码在仓库 `plugins/optional-api-v1/scripts/abu-runtime.mjs` 维护，以 `sync-abu-runtime.mjs --check/--write` 核验或同步。安装包只导入自己的副本，不相对引用其它插件；公式只在本包 baseline 修改。`implementation_sha256` 继续包含原算法和 runtime 字节，既有固定成果不会重绑。

无需额外配置、API Key 或账户连接；计算参数仍是本次输入，不能移成全局配置。已有固定输入和输出由宿主资源接口管理，无私有研究调度器或交易状态。
