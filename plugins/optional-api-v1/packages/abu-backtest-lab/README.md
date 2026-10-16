# abu-backtest-lab

这是从 ABU 回放/回测流程思路翻新的审计基线，参考 commit `d602d847677e4c2b77b0a122df30816ea68b5710`。这里的具体代码是基线，不是标准答案；Agent 可以根据需求改进或修改，但要保留来源、假设、变化、试验和固定对照。

## 用途

`abu-backtest-lab` 不做撮合，也不创建新的回测引擎。它只审计已经提供的 replay 证据，检查时间、成本、限价、fill 和 order 的一致性，然后提示交给原生 replay/backtest engine 做真实撮合、滑点、组合会计和权益曲线。

## 必需数据

输入为 `schema_version: 1` 的 JSON。所有时间字段使用 UTC ISO 字符串，且满足 `time <= available_at <= as_of`。

- `source`：声明数据来源和类型。
- `parameters.expected_engine`：可选；若提供，必须等于 `engine.name`。
- `bars`：可选 OHLCV 证据；用于可见性检查，不用于撮合。
- `orders`：每条包含 `id`、`time`、`available_at`、`symbol`、`side`、`quantity`，可含 `limit_price`。
- `trades`：每条包含 `id`、`order_id`、`time`、`available_at`、`symbol`、`quantity`、`price`、`cost`。`cost` 必须显式提供，单位由输入来源声明。

## 输出

输出包含：

- `audit.issues`：unknown order、fill before order、symbol mismatch、limit breach、overfill、unfilled order 等问题。
- `fills.total_cost`：所有 trade cost 的简单合计。
- `fills_by_symbol`：按 symbol 输出 `gross_quantity`、`buy_quantity`、`sell_quantity`、`net_quantity` 和 `cost`。不同 symbol 的数量单位可能不同，因此不会输出跨 symbol 总数量。
- `native_engine_handoff`：建议把撮合、持仓、权益和滑点交给已有原生引擎。

## CLI

```bash
node scripts/baseline.mjs examples/input.json
```

也可以传 `--out result.json` 写入新文件。CLI 与插件工具共享同一套 `analyze(input)` 逻辑。

## 限制

本插件只审计输入证据，不证明真实成交，不提交或取消订单，不计算资金曲线，也不替代 broker、MT5/QMT 或原生回测引擎。

## API 2 调用契约

`abu_backtest_lab_analyze({input})`：审计已提供的订单、成交和 K 线证据，指出时序、成交数量、成本与限价异常，并给出原生引擎交接说明；不执行回测。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 可省略，审计仅有订单和成交的证据时无需补造 K 线。若提供，bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 可选 engine:{name}；orders:[{id,symbol,time,available_at,quantity,limit_price?}] 和 trades:[{id,order_id,symbol,time,available_at,quantity,price,cost}] 默认空。数量和价格为正，cost 非负，各列表 id 唯一；time <= available_at <= as_of。expected_engine 若提供须与 engine.name 一致。

observations.evidence_counts 给出输入条数，audit 是逐项审计结论，fills/fills_by_symbol 为成交汇总，native_engine_handoff 为引擎交接信息。audit 中失败项是研究结果，不是能力调用失败。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

只审计输入证据，不能证明策略生成过程、券商可成交性或复现真实回测。不同标的数量不能相加当作统一仓位。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
