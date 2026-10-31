# 研究依据与历史对照的呈现

让读者在一屏内读完「观察 → 解释 → 历史对照」，再落到一句判断。桌面横向三列、窄屏纵向排列；列之间用留白，判断上方只留一条细线。完整机制、成立条件、固定引用与验证记录折叠。页面不显示获取/计算/推断类型徽章，也不显示插件覆盖或路由信息。

这是一套基于公开参考做出的 Sesame 适配设计，不是参考来源规定的标准布局。实现复用 Sesame 的颜色与字体变量，已有 K 线、分布、基准和条件树继续作为主体图；新增 helper 只压缩证据的文字阅读路径。

现行范围仅是结果形式。任何指标、特征或算法名称都只是示例内容；模板不选择方法、不要求扫描或执行方法，也不把插件覆盖审查变成默认依赖。

## 一手参考与采用的部分

| 公开原始参考 | 具体设计观察 | 本次采用 |
| --- | --- | --- |
| [Financial Times Visual Vocabulary](https://github.com/Financial-Times/chart-doctor/blob/main/visual-vocabulary/README.md) | FT 将图型按读者需要理解的关系组织，例如变化、分布、排序和构成，强调图形与文字协作。 | 按问题复用已有内置图：M02 看价格/事件，M13 看历史分布和基准；解释区不再画一张泛化流程图。 |
| [Observable Plot：Text mark](https://observablehq.github.io/plot/marks/text) | 官方示例把数值直接标在柱上，也示范只标注时间序列的关键端点，避免标签拥挤。 | 历史小比例条直接写 `count/resolved` 与比例。关键数值始终可见，不要求 hover；解释不再重复轴或图例已经交代的文字。 |
| [Vega-Lite：阈值标注实例](https://vega.github.io/vega-lite/examples/layer_bar_annotations.html) | 该例用原柱形、阈值 rule 和短 text 标注突出超过阈值的部分。 | 观察句紧贴本次图的实际参照，解释句说清这个参照为何相关。阈值仍来自研究结果，不在 UI 中推导新阈值。 |
| [Vega-Lite：直接显示预计算区间](https://vega.github.io/vega-lite/docs/errorband.html#using-error-band-to-visualize-aggregated-data) | 官方文档明确支持直接绑定已有上下界；同一图型也可执行聚合，所以需要区分输入方式。 | Sesame 只展示方法已提供的估计和区间；helper 不运行 bootstrap、平均投票或置信度估计。 |
| [ONS：图表中的不确定性](https://service-manual.ons.gov.uk/data-visualisation/guidance/showing-uncertainty-in-charts) | ONS 建议在不确定性会改变解释时呈现它，并警惕高不确定性下没有意义的视觉比较。 | 精确置信度、定义与给定区间保留；没有可比历史时直接显示缺口，不用默认数值填空。完整不确定性口径在展开区。 |
| [Observable Plot：可访问性](https://observablehq.github.io/plot/features/accessibility) | 文档区分描述性标签与可从辅助技术隐藏的装饰元素。 | 比例条本身 `aria-hidden`，旁边的结果名、分子/分母和比例提供完整文本；三列按 DOM 阅读顺序排列，展开入口可键盘操作。 |

引用页面于 2026-10-28 查阅。本实现没有引入 Observable、Vega 或 FT 的运行时代码、样式模板或网络依赖。

## 读者看到什么

| 区域 | 可见内容 | 不自动生成的内容 |
| --- | --- | --- |
| 观察 | 1–4 条短事实，使用来源实际数值与口径。 | 新指标、技术信号、价格点或获取方式标签。 |
| 解释 | 1–4 条已提供的公开解释，说明观察与判断的联系。 | 模型内部思考文本、自动补出的因果链或方法投票。 |
| 历史对照 | 一句可比性说明；已结算数量；有完整互斥计数时可画小比例条；支持/冲突/混合/不足用短文字。 | 从基准描述中解析出的百分比、因样本多而制造的可信度或默认 50%。 |
| 判断 | 一句结论；方法提供的置信度、定义和区间。 | 把历史比例改标成未来概率，或把多个特征支持率平均。 |
| 完整依据 | 机制、条件、预期观察、对照解释、方法、历史口径与固定引用。 | 整段 JSON、插件清单或内部路由信息。 |

比例条仅在 `historical_basis.sample.resolved` 为正整数、结果为 1–4 个互斥类别、全部 `count` 为非负整数且总和等于 `resolved` 时出现。条长只计算 `count / resolved`；标签明确为「历史比例」，分子/分母保留精确值。更多结果、零样本或无法对账时不用比例条，完整给定记录仍能展开。

这不是替代 M13 的新历史图层：需要连续结果分布、尾部或条件/基准比较时，继续使用已内置的 `outcome_chart`、`cases_chart`、`baseline_chart`。M14 仍只承担综合摘要，R02/R03 的最终情景仍集中到 M15。

## 输入与集成 API

新增纯呈现模块 `plugins/api-v1/packages/reports/report-reasoning.js`：

```js
import { renderReasoning, renderInference } from './report-reasoning.js';

const helpers = { escape, tr, historyHTML, confidenceHTML, historyDisplay: field.history_display };
renderReasoning(resultRowOrInference, helpers); // 无 reasoning 时返回 ''
renderInference(inference, helpers);           // 兼容没有 reasoning 的旧字段
```

输入使用完整结果行或单项 inference；无需把方法、知识依据或历史数据改成 HTML：

```js
{
  claim, reason, status, method_ref, confidence,
  historical_basis, validation, knowledge_basis,
  reasoning: {
    observations: ['短事实一', '短事实二'],
    steps: ['公开解释一', '公开解释二'],
    conclusion: '一条有条件的判断',
    history: {
      status: 'linked', // linked | pending | unavailable | not_applicable
      note: '与本次相同的结果定义和期限'
    }
  }
}
```

上例只有格式字段，没有虚构统计值。契约验证由调用方负责；helper 不执行历史检索、方法调用、统计验证或交易。

- `escape(value)`、`tr(zh, en)` 沿用宿主。所有直接读取的文本和翻译标签都经过转义；引用作为文本，不自动生成 URL。
- `confidenceHTML(confidence)` 接收原始对象，返回宿主可信 HTML；不改写估计或区间。未提供 callback 时紧凑显示精确原值、定义和区间；完整原值与区间方法也保留在展开区。
- `historyHTML(basis, validation, display)` 保持现有签名。实际 `historical_basis` 的完整内容放在折叠区。如果 `linked` 只依赖外层上下文，可由回调在 `basis === undefined`、`display === 'summary'` 时返回指向真实历史依据的摘要或链接。返回空值表示未能关联，呈现会显示「历史依据待关联」；helper 不捏造链接、样本数或历史记录。
- `pending`、`unavailable` 直接显示给定 note 或 reason；`not_applicable` 允许确定性观察说明为何不需要历史预测比较。
- `knowledge_basis.agreement`（或显式同名 `status`）的四种对照结果只映射成简短文字，不判断支持程度。原有 `report-knowledge.js` 保持独立且未修改。
- `historyDisplay` 可选 `full`（默认）、`summary`、`hidden`，直接接收 `field.history_display`。`summary` 只调用摘要回调或显示已给定样本数，不画比例条、不展开完整历史；`hidden` 不显示历史对照列、样本或历史详情，也不调用历史回调。置信度保持独立可读，知识机制仍可展开。
- 返回的 HTML 已包含给定置信度、历史摘要/完整依据、知识机制与引用。接入 compose 时只渲染一次，不再附加旧的重复 confidence/history/knowledge 区块。
- CSS 独立位于 `assets/report-reasoning.css`。全部选择器以 `report-reasoning-*` 组织，没有 body、宿主主题、module 或 backtest 全局改写；root 将该资产加入统一模板。

## 验证范围

`tests/report-reasoning.test.mjs` 覆盖可选输入、原文保留、历史比例边界、不解析基准文本、缺历史/外层关联、确定性观察、四种对照结果、旧字段完整依据、callback 精确传值、XSS、CSS 隔离和实际浏览器的三列/窄屏布局。

浏览器测试从 `SESAME_HOST_ROOT` 加载已有 Playwright，检查键盘展开、长引用换行、390px 无页面横向溢出、无框外观、深色变量和原生回测旁路样式。`SESAME_REASONING_SCREENSHOTS=1` 可把虚构测试截图写入 `/tmp/sesame-reasoning-{desktop,mobile,dark}.png`；截图只证明本地组件呈现，不是市场结论或宿主发布记录。
