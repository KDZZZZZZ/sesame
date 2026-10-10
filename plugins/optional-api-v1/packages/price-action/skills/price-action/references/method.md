# Price Action：先上下文，再可重复观察

Al Brooks 的出版社书目信息与作者公开 glossary/market-cycle 资料将价格行为放在趋势、区间和后续表现的上下文中。本包参考其主题，不复制章节或图，不把作者经验性概率当当前样本的统计事实。[作者术语表](https://www.brookstradingcourse.com/price-action-trading-terms-glossary/)；[作者区间讨论](https://www.brookstradingcourse.com/how-to-trade-manual/trading-ranges/)。

## 本包自动子集

给定左窗口 L、右窗口 R（各 1..20），柱 i 的 high 严格大于两边所有柱 high 才确认高 pivot；low 严格较小才确认低 pivot。相等的顶/底不猜 tie-break。最早到 i+R 闭合时才能知道结果。每侧只跟踪最新已确认 pivot，并在之后的首个 close 严格越过其 level 时记录 close-break；影线越过与恰好等于不算。新 pivot 取代同侧旧的未突破锚点，这一约定不等于所有价格行为流派。

脚本没有自动趋势/区间分类、High 2/Low 2、wedge 或完整 Brooks setup。输出的 swing/close-break 是离散事实层，仍需人工核对上下文和 source coverage。

## 手工分析卡

事先写价格基础、周期和摆动规则，然后分栏记录：推进方向与收盘、相邻柱重叠、回撤幅度/持续时间、相对既有边界的位置、后续确认。描述“趋势候选”时同时写出何种重叠或反向收盘会削弱它；描述“区间候选”时写出需要怎样的闭柱突破与后续才改变判断。

人工画的边界必须引用当时已知锚点。后续把宽度扩大或换高低点是新修订，不改旧预测。高周期收盘未发生时，不把它当确认条件；只有 OHLC 时也无法知道同柱内先高后低或先触止损后止盈。

社区对照参考 `ovels/al-brooks-price-action` 的 MIT skill，取其语境先于图形名称的研究组织方式；本包没有复制正文、模板或行动评分，不接收其授权假设。固定来源与许可证见 PROVENANCE。
