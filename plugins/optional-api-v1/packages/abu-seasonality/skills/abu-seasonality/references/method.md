# Method: UTC Weekday Conditional Return

基线将每个 bar 归入 `time` 的 UTC weekday，并统计同 weekday 的历史 close-to-next-close return。

关键约束：

- 对当前 `t`，只允许 `j + 1 < t` 的样本。
- 不使用当前 bar 之后的 return。
- 不做 full-month 聚合。
- 日历假设固定为 UTC bar close，不代表交易所当地时区。

限制：

- 小样本 weekday edge 极易过拟合。
- 不考虑节假日、半日市和夜盘。
- 上游参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710`，本实现是独立 GPL baseline。
