---
name: wyckoff
description: 独立 Wyckoff 研究：供需、努力/结果与阶段候选；成交量单位、替代解释和反证明确，Composite Man 仅是启发式。
license: MIT
---

# Wyckoff 量价与阶段研究

1. 先读本 skill 的 `references/method.md`、`references/validation.md` 与教学案例；plugin_id=`sesame/wyckoff`。独立分析本方法，不自动载入其它方法。
2. 通过公开行情工具固定价与量、DataRef、复权/时段/时钟/覆盖。先确认是实际成交量、tick 计数还是 unknown；没有实际量时缩小为价格结构候选，不能把 tick 数或 null 当真实资金量。
3. 先定边界和阶段假设，记录为什么选这些区间及其确认时间。用供需、努力与结果作为待检验机制：价格推进/收盘位置/回撤与量的单位明确，不从一根放量柱确定谁在买卖。
4. 阶段/事件标签以候选表呈现：实际价格行为、量证据、原框架标签、至少一条替代解释、需要的确认及失效条件。“吸筹/派发”“Composite Man”不是真实受益人身份或订单记录。
5. Spring/Upthrust 候选需要提前固定区间边界及回到区间的操作规则；价格穿越后反向不能自动证明操纵或完成阶段。若没有可靠日历/缺口资料，保留 unknown 而非补齐路径。
6. 先完成一张带源柱引用/确认时刻的候选表，再用 reports/canvas-control 发布。比较区间的成交量须同单位同口径，不能把手数、股数、tick 数拼成一个柱状图。
7. 要统计效力时，预先定义阶段/事件可重复标准、覆盖全部尝试和样本外区间。没有一致分类就报告解释性分析，不声明已实现完整自动 Wyckoff 或可实盘策略。

所有相对参考路径位于 `skills/wyckoff/`；脚本、案例和 PROVENANCE 的路径相对包根，均经 `plugin_read` 授权读取。以下均为研究约定，不是新 SVL schema 或交易权限。先读 `PROVENANCE.md` 的实际访问范围与许可；示例是 demo，不得当真实行情。
