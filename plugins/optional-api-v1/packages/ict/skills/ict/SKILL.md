---
name: ict
description: 仅按需 ICT：固定参考范围、三柱价格区间、结构转变候选与失效证据；不从 OHLC 反推机构真实订单。
license: MIT
---

# ICT 价格结构研究

1. 先读取 `references/method.md`、`references/execution.md` 和 `references/validation.md`，路径均位于本 skill 目录；用 `plugin_read` 的 plugin_id=`sesame/ict`。只执行用户指定的 ICT 研究，不自动加载其它理论。
2. 固定标的、提供方、周期、价格基础、时段和截止时间。通过 data-access 的公开发现 → `market_read` → `data_read` 保存 DataRef、raw、dataset_id、coverage 和完整 SourceTime；通常请求闭柱。来源时区未知时不猜纽约时刻，不能把任意区间称为 kill zone。
3. 先写本次使用的操作定义：参考高低点怎样提前固定、是否要求闭柱越过、区间分离规则、候选失效规则，以及可得时间。教学作者术语、我们的离散判定和研究者主观解释分栏。
4. 需要区间候选时，按 execution.md 读取本包 `scripts/bar_input.py` 与 `scripts/observe.py`，原样写入工作区，使用已有 Python 执行。脚本只产生三根连续返回闭柱的区间分离观察；不是完整 ICT 入场系统，不推断订单簿、机构订单或缺口必回补。
5. 将脚本结果与预先固定的参考区间、收盘/影线选择、可得时间并列。所谓扫过参考价只证明价格跨过该价；要判断未成交委托或止损簇仍需真实盘口/订单证据。形成中候选必须单列且不得进闭柱规则结果。
6. `research_register` 绑定成功执行、输入 IDs 和脚本；报告用 reports，图表用 canvas-control 的现有接口。每个区域附源柱 id/revision、确认时间、解释、替代解释、失效条件。后续改判新增修订，不把新解释回填旧图。
7. 要评估交易效果，先明确入场/退出/成本/未成交和样本外规则，再交 strategy-authoring 与选定目标后端；本包不扩展 SVL、不发订单、不提供胜率承诺。

所有相对参考路径位于 `skills/ict/`；脚本、案例和 PROVENANCE 的路径相对包根，均经 `plugin_read` 授权读取。以下均为研究约定，不是新 SVL schema 或交易权限。先读 `PROVENANCE.md` 的实际访问范围与许可；示例是 demo，不得当真实行情。
