---
name: elliott-wave
description: 独立波浪研究：明确结构类型、级别、锚点、标准推动浪约束、替代计数和确认时刻；主观候选与验证分开。
license: MIT
---

# Elliott 波浪候选

1. 先读本 skill 的 `references/method.md` 与 `references/validation.md`，再读 `examples/case.json` 和 `examples/expected.md`；plugin_id=`sesame/elliott-wave`。本包不加载其它方法或自动数浪器。
2. 用现有 data-access 固定数据和源时钟、复权、周期、coverage；明确采用何种端点（high/low 或 close）及锚点确认规则。仅凭截屏缺少完整时间与价格时，输出示意候选而非规则验证通过。
3. 声明结构类型和级别。对标准推动结构逐项核验 method.md 的硬约束；不要把斜三角、延长或修正形态的规则随意混用，不能为了挽救失效计数事后换类别而保留原预测成绩。
4. 保留至少主候选与一个可成立的替代候选；若不足以形成两个完整计数，替代可以是“该级别结构尚未完成/不适用”，不能编造点位。列出区分它们的新观察与各自失效价位。
5. 每条候选保留锚点 id/revision、价格、源事件时刻、最早确认时刻、研究者首次标注时刻、类别/级别与版本。右侧确认不可提前；新极值出现时新增计数修订，不改旧报告。
6. Fibonacci 比例只作为已声明的辅助描述，不能用常见比率替代硬约束或把区间目标当确定预测。给边界及反证，不给未经校准的胜率。
7. 将事实价格、硬规则检查和人工候选分栏交 reports/canvas-control。只有明确的可执行子集才交 strategy-authoring 与目标 profile；不能表达时报告 unsupported，不把自由数浪文字塞进 SVL。

所有相对参考路径位于 `skills/elliott-wave/`；脚本、案例和 PROVENANCE 的路径相对包根，均经 `plugin_read` 授权读取。以下均为研究约定，不是新 SVL schema 或交易权限。先读 `PROVENANCE.md` 的实际访问范围与许可；示例是 demo，不得当真实行情。
