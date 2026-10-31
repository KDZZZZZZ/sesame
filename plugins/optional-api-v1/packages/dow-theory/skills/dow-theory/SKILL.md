---
name: dow-theory
description: 独立 Dow 理论研究：主要/次级趋势、收盘与多指数确认；历史版本明确，缺确认保持未确认。
license: MIT
---

# Dow Theory 趋势确认

1. 先读本 skill 的 `references/method.md`、`references/validation.md` 和教学案例；plugin_id=`sesame/dow-theory`。说明采用 Hamilton/Rhea 传统的哪一项操作约定，不混称所有版本是同一机械模型。
2. 用公开提供方获取拟比较的指数各自固定 DataRef、成分/复权/交易时段/来源时钟、收盘定义与样本覆盖。两指数缺一则输出有限单序列描述，不冒称已经相互确认。
3. 事先记录主要趋势、次级反应的判定方式及各指数需要越过的已知收盘极值、锚点引用与确认时间。不得看到后续走势才挑对自己有利的次级点。
4. 按每个市场真实闭市时刻检查收盘越过。不同市场/日期不能用数组位置对齐，也不把盘中影线当日收盘。先后确认允许不同时间发生；最早共同确认时间不能早于较晚一方的信息可得时间。
5. 区分 confirmed、non-confirmation、insufficient-data。单边新高或新低只记非确认/待观察；不能自动翻转主要趋势。三阶段心理故事只能是解释标签，不是参与者动机证据。
6. 报告列两条各自引用的时间线、规则、结论与撤销条件。若用新资产/指数替代传统 averages，明确这是改编，需要独立验证，不能沿用历史结果。
7. 由 reports/canvas-control 展示；策略化须固定成本/确认延迟/执行规则，再进入既有 SVL 与目标流程。源码和本指南均不提供“始终正确”的趋势或收益声明。

所有相对参考路径位于 `skills/dow-theory/`；脚本、案例和 PROVENANCE 的路径相对包根，均经 `plugin_read` 授权读取。以下均为研究约定，不是新 SVL schema 或交易权限。先读 `PROVENANCE.md` 的实际访问范围与许可；示例是 demo，不得当真实行情。
