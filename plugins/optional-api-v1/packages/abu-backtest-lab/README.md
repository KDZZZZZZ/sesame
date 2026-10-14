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
