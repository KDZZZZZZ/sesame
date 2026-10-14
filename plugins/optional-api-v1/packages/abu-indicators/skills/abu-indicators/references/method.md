# 方法说明

上游参考：`abupy/IndicatorBu`，固定提交 `d602d847677e4c2b77b0a122df30816ea68b5710`。

本实现保留的有用部分：常见技术指标作为透明研究特征。替换部分：不引入 ABU 的 pandas/绘图/旧环境，改为无依赖 JavaScript；EMA/MACD 从首个可见收盘价初始化，ATR 使用 true range 的简单滚动均值，RSI 使用窗口内简单平均涨跌。

点时约束：每一行输出都带 `available_at`，为该行计算所用观测的最大可见时间。warmup 输出为 `null`，不向前填充，不使用未来行生成当前行指标。

建议实验：保留 baseline，分别测试 Wilder ATR/RSI、不同 EMA 初始化、复权价格、交易成本和不同市场频率；在固定 holdout 上比较，不自动替换已挂载策略。
