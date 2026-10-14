# ABU Seasonality Baseline

这个插件把 ABU weekday/monthday 类周期统计翻新成严格可见性的 UTC weekday 研究基线。它不是标准答案；Agent 可按交易所日历、会话或品种改进，但必须保留 baseline、假设、变更、试验和 holdout。

## 输入与参数

输入为 UTC close bars。参数：

通过 Sesame 原生工具调用时，运行时会自动登记输入和输出数据集，返回可复核的 dataset id；直接运行 CLI 只把结果写到 stdout 或 `--out` 文件，不登记数据集。

- `min_samples`：生成方向标签所需最小历史样本数。

## 公式

对当前 bar 的 UTC weekday，只使用更早的、已完成的 close-to-next-close return：

`return[j] = (close[j+1] - close[j]) / close[j]`

样本条件：`weekday(time[j]) == weekday(time[t])` 且 `j + 1 < t`。

因此当前 bar 到未来下一 bar 的收益不会进入自身统计，也不计算完整月份未来聚合。

## 上游差异

参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710` 的 weekday 统计思想。本实现只保留最小可审计 UTC weekday 条件收益，不复制 ABU 代码，不声称适配交易所节假日日历。

## 改进纪律

若改成交易所日历、月内效应或 session 分桶，必须显式写出日历来源、缺失日处理、样本外切分和成本假设。
