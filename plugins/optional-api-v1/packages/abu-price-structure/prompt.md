# 价格结构基线

用 `abu_price_structure_analyze` 提取已确认拐点、支撑阻力聚类与黄金分割参考，说明价格位置和何时可知。

右侧 K 线出现后拐点才确认，因此决策依据是 confirmed_at，不能提前使用 pivot_time。聚类与分割是形态参考；突破或反转仍需后续证据。

这是可修改的研究基线。改进时保留假设、原结果与同一输入上的对照；合成数据保持演示标记。需要核对公式或设计改进时，可读 `skills/abu-price-structure/references/method.md`；参数、返回值与错误恢复由工具说明直接提供。
