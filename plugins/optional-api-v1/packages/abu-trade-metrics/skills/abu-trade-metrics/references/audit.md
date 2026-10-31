# 方法

来源参考：`bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710` 中的回放/回测流程思路，许可证 GPL-3.0-only。本实现是可修改、可验证的基线，不是标准答案；Agent 可以改进审计项，但不要把它描述成新的撮合或组合回测引擎。

输入是已给出的 replay 证据：`bars`、`orders`、`trades`。所有时间必须是 UTC，且每条记录满足 `time <= available_at <= as_of`。`parameters.expected_engine` 若给出，必须与 `engine.name` 一致。

审计规则：

- fill 必须引用存在的 order。
- fill 时间不能早于 order 时间。
- fill symbol 必须等于 order symbol。
- buy fill 价格不能高于 buy limit；sell fill 价格不能低于 sell limit。
- 每个 order 的累计 fill 数量不能超过 order quantity。
- 没有 fill 的 order 是 warning。
- `trade.cost` 必须显式提供，单位由输入来源声明；本工具只做数值汇总，不推断费用模型。

输出的 `fills_by_symbol` 按 symbol 给出 `gross_quantity`、`buy_quantity`、`sell_quantity`、`net_quantity` 和 `cost`。不同 symbol 的数量单位可能不同，因此不输出跨 symbol 总数量。

限制：本工具不重建策略、不撮合、不计算权益曲线、不替代原生 replay/backtest engine。需要真实成交、滑点、组合会计和持仓演进时，应交给已有原生引擎。
