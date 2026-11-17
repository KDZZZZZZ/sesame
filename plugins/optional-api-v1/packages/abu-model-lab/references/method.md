# 方法说明

上游参考：ABU ML demo 概念，固定提交 `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。

这是可验证的基线，不是标准答案。Agent 可以改进或修改模型，但必须保留原始 baseline、训练/评估分离、假设、变化、试验和固定 holdout 证据。

## 数据合同

`feature_names` 定义向量顺序，名称不可重复。每行 `features` 必须包含所有特征。当前实现要求：

- `time <= available_at <= label_available_at <= as_of`
- `available_at <= time`，即特征在该行决策点前已可见
- eval 行必须全部晚于 train 行
- 所有 train 标签必须早于第一条 eval 决策时间可见

这套约束防止训练标签或评估特征泄漏到历史决策中。

## 训练公式

训练集计算每个特征的均值和标准差，标准差为 0 时用 1。特征缩放后加截距项。`regression` 使用线性预测；`logistic` 使用 `sigmoid(dot(w, x))`，并裁剪 sigmoid 输入到 `[-40, 40]`。优化为固定次数梯度下降，非截距权重加 `l2` 正则。

输出的 `scaler`、`coefficients` 和 `chronological_eval` 都来自同一固定输入。评估阶段不重新缩放、不重新训练、不洗牌。

## 改进建议

可以加入稳健缩放、类别特征、正则选择、概率校准、更多指标或外部模型。任何改进都应复制并保留 baseline 输出，声明模型和参数变化，并在相同固定 eval/holdout 上报告结果；不要把默认线性结果称为最优模型。
