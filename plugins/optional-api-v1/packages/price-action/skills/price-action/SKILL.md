---
name: price-action
description: 独立价格行为研究：趋势/区间语境、延迟确认摆动和收盘突破，区分确定性观察与人工解读。
license: MIT
---

# Price Action 价格行为

1. 先读本 skill 的 `references/method.md`、`references/execution.md` 与 `references/validation.md`。plugin_id=`sesame/price-action`；无需加载其它流派。
2. 从公开市场工具固定 DataRef 和原始响应，保留周期、价格基础、复权、时段、单位、SourceTime 及 coverage。比较不同周期前先定义聚合与闭柱时刻，不拿尚未闭合的高周期柱证明低周期信号。
3. 先确定研究上下文：趋势/区间是候选判断还是可执行规则，摆动窗口、突破用收盘还是影线、失败/失效怎样定义。人工标注应保留首次提出时间、相反解释和被推翻的版本；“看起来明显”不能作为可复现条件。
4. 需要有限结构观察时按 execution.md 运行本包脚本：左右窗口严格极值确认 pivot，再记录当前最新已确认 pivot 的首次收盘越界。参数在看结果前固定；右侧柱尚不足时不会输出 pivot。它不自动判完整趋势、Brooks setup 或给出交易建议。
5. 展示事件柱位置与 confirmed_at 两个时点；confirmed_at 只是源闭柱后的最早可确认时间，实际收到数据/可以下单的时间可能更晚。将无确认的高低点画为候选，不能把最终 pivot 回填成当时已知事实。
6. 对趋势/区间假设分别记录支持与反证：推进、重叠、回撤、收盘与既有边界。单根大柱不免除上下文检查；源作者的经验概率不得当当前市场的校准概率。
7. `research_register` 登记实际执行对象数组，reports/canvas-control 负责成果与画图。需要规则回测再按 validation.md 固定完整规则并进入现有策略/后端流程；不临时扩 SVL 或把脚本通过等同盈利证据。

所有相对参考路径位于 `skills/price-action/`；脚本、案例和 PROVENANCE 的路径相对包根，均经 `plugin_read` 授权读取。以下均为研究约定，不是新 SVL schema 或交易权限。先读 `PROVENANCE.md` 的实际访问范围与许可；示例是 demo，不得当真实行情。
