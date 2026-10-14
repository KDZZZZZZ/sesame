# 方法

来源参考：`bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710` 中的网格搜索和交叉验证思路，许可证 GPL-3.0-only。本实现是可修改、可验证的基线，不是标准答案；Agent 可以按需求改进，但要保留原始输出、假设、变更、试验和固定 holdout 对照。

输入只接受有限 JSON 证据，不执行策略代码或任意表达式。网格值必须是有限的 number/string/boolean，参数名排序后展开；指标由 `objective_metric` 指定，方向为 `maximize` 或 `minimize`。

`phase: "development"`：

- 拒绝传入 `frozen_selection`，避免复用或伪造旧选择。
- 拒绝任何 holdout trial。
- 只用 `split: "development"` 的已可见 trial 排名。
- 选择排名第一的参数，`selected_at` 固定为本次输入的 `as_of`。
- 输出 `development_sha256`、`grid_sha256`、`objective_sha256`、`parameter_hash` 和 `selection_sha256`。

`phase: "holdout"`：

- 必须传入前一次 development 输出的完整 `frozen_selection`。
- 重新计算 development/grid/objective 哈希并逐项匹配。
- 要求 `development.available_at <= selected_at <= as_of`，并且 `selected_at < holdout.available_at`。
- holdout 证据只能包含已冻结参数，非选中参数的 holdout trial 会被拒绝。

这些哈希只能证明当前 JSON 记录内部声明一致，不能单独证明用户没有提前看过 holdout。用户或运行时必须把 development 产物作为外部冻结 artifact 保存。
