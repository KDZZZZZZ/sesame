# 方法说明

上游参考：`abupy/PickStockBu`，固定提交 `d602d847677e4c2b77b0a122df30816ea68b5710`。

本实现保留“从有界股票池中筛出候选”的思想，使用四个透明特征：`momentum` 为 N bars 收益；`trend` 为窗口回归斜率除以最新价；`efficiency` 为首尾净变化除以绝对路径；`price_position` 为最新价在窗口最高最低之间的位置。

各特征做横截面 rank score 后等权平均；并列值使用平均名次。历史不足的 instrument 标为 `insufficient_history` 并排除出 top，不用低分伪造完整观察。所有 instrument 的最新 bar 时间必须一致，否则拒绝横截面排名。

差异：不复制 ABU 多个 picker 类、并行选股、相似度筛选或旧数据供应商。Agent 可以加入行业中性、流动性过滤、成本、风险暴露和严格时间序列验证。
