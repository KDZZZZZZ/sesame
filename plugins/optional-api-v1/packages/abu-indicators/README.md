# 技术指标基线

**这是基线，不是标准答案。** Agent 可以根据任务改进参数、公式、数据源和验证方法，但必须保留原版结果、修改假设、试验记录和固定样本外对照。

本包把 ABU `IndicatorBu` 中常见指标主题翻新成一个无依赖 Node.js 研究工具：SMA、EMA、MACD、RSI、布林带和 ATR。实现强调可复核、可解释和时间可见性，不声称与 ABU 逐行等价。

输入为 `schema_version=1` 的 JSON。K 线 `time` 可以是来源日历日期或真实 UTC 收盘时刻，同一序列保持一种精度。`available_at` 未知可省略或为 `null`；输出保留未知状态，不据此声称历史点时有效。未来观测被拒绝；warmup 输出 `null`。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_artifact` 与 `result_artifact`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游参考固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`。本包以 GPL-3.0-only 发布；来源、差异和信任边界见 `PROVENANCE.md` 与 `skills/abu-indicators/references/method.md`。

## API 2 调用契约

`abu_indicators_analyze({input})`：在固定 OHLCV 上计算 SMA、EMA、MACD、RSI、布林带与 ATR，提供可复核的指标基线。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,bars}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 保留真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条 OHLCV，time 严格递增且不重复，全部为日期或全部为 UTC 时刻；不能包含晚于 as_of 的观测。每行含 time、open/high/low/close、volume；available_at 未知可省略或为 null，已知时满足 time <= available_at <= as_of（日历日期按日期比较）。价格为正且 high/low 覆盖 open/close，volume >= 0。 FMP 行情行显式转换为 {time:row.data.date,open:row.data.adjOpen,high:row.data.adjHigh,low:row.data.adjLow,close:row.data.adjClose,volume:row.data.volume,available_at:null}，按 time 排序；保留供应商价格调整警告，adj* 字段名本身不能证明已经复权。首次可用时间未知不妨碍历史样本计算，但不能宣称结果已通过历史点时有效性验证。 可按任务覆盖 parameters 中的窗口；省略的参数使用 Schema 中默认值。macd_fast < macd_slow，bars.length <= max_bars。

observations.rows 为行数，latest/series 为最新/完整指标，baseline_note 说明公式差异；预热不足的指标为 null。 latest/series 同时返回 true_range、atr、atr_percent；未知 available_at 保留 null。TR = max(high-low, abs(high-previousClose), abs(low-previousClose))，包含前收盘价到本根高低价的跳空，不能仅以 high-low 替代。输入第一根没有前收盘价时 true_range=null；atr_window=N 时需要 N 个有效 TR，即至少 N+1 根连续输入，ATR 为这 N 个 TR 的简单算术均值，atr_percent=100*atr/close。未满窗口时 atr、atr_percent 为 null；此口径不是 Wilder 平滑 ATR。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

EMA 由首个可见 close 初始化；ATR 使用简单滚动均值，不能声称与 Wilder 或其他平台数值完全一致。指标本身不证明收益。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；未知首次可用时间在输出中保留 null，不能据此宣称历史点时有效。日期精度不代表精确收盘时刻。synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

## 文件与能力边界

本包属于 `analysis / function`，提供给定证据上的局部确定性处理。算法和调用身份保持独立；研究目标、方法组合、数据来源、原生回测及交易交由调用方选择。

| 文件 | 职责 |
| --- | --- |
| `index.js` | 绑定现有能力，处理调用前取消，委托计算和成果登记 |
| `scripts/baseline.mjs` | 本包算法、参数约束、观察值和局限；保留原 CLI 入口 |
| `scripts/runtime.mjs` | 输入/时间校验、证据摘要、固定成果和 CLI 协议，独立包内交付 |
| `skills/abu-indicators/` | 用法与按需公式参考，不重复实现算法或调度研究 |
| `examples/input.json`、`tests/baseline.test.mjs` | 合成输入、手算预期与异常回归 |

共用 runtime 的源码在仓库 `plugins/optional-api-v1/scripts/abu-runtime.mjs` 维护，以 `sync-abu-runtime.mjs --check/--write` 核验或同步。安装包只导入自己的副本，不相对引用其它插件；公式只在本包 baseline 修改。`implementation_sha256` 继续包含原算法和 runtime 字节，既有固定成果不会重绑。

无需额外配置、API Key 或账户连接；计算参数仍是本次输入，不能移成全局配置。已有固定输入和输出由宿主资源接口管理，无私有研究调度器或交易状态。
