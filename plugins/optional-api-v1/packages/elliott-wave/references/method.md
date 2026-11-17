# Elliott：结构约束、候选与时间

Frost 与 Prechter 的《Elliott Wave Principle》首版于 1978 年出版；出版方 EWI 的公开 Waveopedia 提供结构说明，并强调保留替代计数。[书目信息](https://www.elliottwave.com/books/elliott-wave-principle/)；[作者出版机构 Waveopedia](https://www.elliottwave.com/waveopedia/)。不从出版方营销文字推导盈利承诺。

## 标准推动结构的有限检查

明确采用标准 impulse（不把 diagonal 例外混进来）后，逐项检查：wave 2 不超过 wave 1 的起点；wave 3 不是 1、3、5 中最短；wave 4 不进入 wave 1 的价格区域。用声明的端点价格和方向计算，含糊/相等边界记录原值及所采用版本，不为通过检查临时换尺度。规则来源见 [EWI 说明](https://www.elliottwave.com/articles/elevate-your-elliott-wave-analysis/)。

这些检查是必要约束，不足以证明计数唯一或未来 wave 5 将发生。本包不实现完整结构树、自动分级、斜三角/复杂修正分类或自动选最优数浪；需要这些时列出缺项，不能仅凭三条约束宣布完整自动识别。

## 候选表

每个 candidate 至少包含：方法版本、结构类型/degree、端点 id/revision/time/price、anchor confirmation time、首次标注时间、硬规则状态、主/替代角色、失效条件和后续区分观察。形成中端点写 provisional；图画在历史柱上不意味着当时已确认。

当点位或类别改变，创建新 candidate revision 并引用旧版/修改原因。旧版的失效记录必须保留。Fibonacci 比率可报告计算口径和区间，但不能升级为必然目标。没有足够信息时，合法输出是“结构未完成/无法区分”，无需硬凑五浪。
