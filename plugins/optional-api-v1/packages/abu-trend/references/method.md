# 方法说明

上游参考：`abupy/TLineBu`，固定提交 `d602d847677e4c2b77b0a122df30816ea68b5710`。

保留点：趋势线、通道和路径效率这类可解释结构。替换点：本包只做滚动线性回归；不复制 ABU 的绘图、polyfit 搜索、支撑阻力和 notebook 交互。

公式：窗口内用 `x=0..n-1` 对 close 做最小二乘回归；`normalized_slope = slope * window / latest_close`；通道为最后拟合值上下 `channel_stddev * residual_std`；路径效率为首尾净变化除以窗口内绝对路径长度。

改进方向：可比较 Theil-Sen、对数价格、成交量权重、基准相对趋势和不同市场频率。任何改进都应保留 baseline 并在固定 holdout 上评估。
