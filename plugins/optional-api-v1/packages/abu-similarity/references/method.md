# 方法说明

上游参考：`abupy/SimilarBu`，固定提交 `d602d847677e4c2b77b0a122df30816ea68b5710`。

公式：先把每个 instrument 的相邻 close 转为 simple return，使用“起点 time + 终点 time”作为收益端点，并用相邻两行最大 `available_at` 标注可见性。两两比较时只取完全相同端点的交集；如果一个标的缺了中间 bar，就不会把 1 段收益和另一个标的的多段收益混为同一观察。

输出：Pearson 衡量线性相关，Spearman 衡量秩相关，sign agreement 衡量非零收益方向一致率。样本不足或常数序列输出 `null`。

差异：不做 ABU 的相似标的搜索、滚动加权相关、协整候选或绘图。Agent 可在保留 baseline 的前提下加入交易日历、滚动窗口和稳健距离。
