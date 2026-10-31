# 模块的内置可视化与历史证据

优先用产品已有图表解释研究结论。K 线复用行情工作台的 Lightweight Charts；其余图型复用 reportKit / SesameCharts。候选不是必选：按用户目标、已有数据和可解释性选择，避免重复表达；用户可以删改或要求纯文本。图表只能增强证据的可读性，不能增强证据本身的效力。

## 19 个模块的图表候选

`report_structure({template_id})` 返回每个 `type:chart` 字段的 kind、映射、原始列和 data_requirements。以下字段可直接放进该模块的 fields；省略 fields 时它们是可选字段，没有结果就不会出现空图。

| 模块 | 候选字段与内置图型 | 所需研究结果 |
| --- | --- | --- |
| M01 行情 | price_chart：K 线；relative_chart：横条 | 同标的周期 OHLC；同窗口资产收益 |
| M02 技术 | price_chart：K 线与方法价格叠加；scenario_chart：决策树；method_comparison_chart：方法检测时间线 | 同一固定 OHLC、方法特征、首次可得时间；触发、失效和结果节点 |
| M03 基本面 | growth_chart：多序列折线；cash_bridge_chart：瀑布 | 同财期收入与现金流；可对账现金流组成 |
| M04 估值 | sensitivity_chart：热力图；peer_chart：横条 | 已计算估值网格；同口径可比倍数 |
| M05 共识 | revision_chart：哑铃；dispersion_chart：散点 | 同目标前后共识；估计分歧与覆盖 |
| M06 事件 | event_price_chart：K 线；reaction_chart：折线 | 实际事件窗口 OHLC；对齐后的本次与参照路径 |
| M07 新闻 | attention_chart：折线；themes_chart：横条 | 去重消息数量；主题覆盖，不能当作影响概率 |
| M08 情绪 | sentiment_chart：折线；crowding_chart：散点 | 同口径情绪与参照；历史拥挤指标及后续实际收益 |
| M09 波动 | term_chart、skew_chart：折线 | 同截点波动期限和偏斜，不补造报价 |
| M10 期权 | payoff_chart：折线；cost_chart：瀑布 | 方法计算的净损益曲线；成本对账 |
| M11 筛选 | ranking_chart：横条；tradeoff_chart：散点 | 方法产出的排序依据；可比风险收益特征 |
| M12 组合 | exposure_chart：矩形树图；dependence_chart：热力图 | 同截点非负敞口层级；同方法完整依赖矩阵 |
| M13 历史 | outcome_chart：直方；baseline_chart：哑铃；cases_chart：逐笔点 | 匹配后的实际结果、登记分箱、样本数和基准；少样本优先逐次原值 |
| M14 预测 | outlook_chart：柱形；evidence_chart：哑铃 | 同目标概率；各项推断的条件结果与基准，逐项附历史依据 |
| M15 监测 | action_chart：决策树；monitor_chart：哑铃 | 用户条件与行动；同单位当前值及阈值 |
| M16 复盘 | calibration_chart：折线；evaluation_chart：哑铃 | 冻结预测、结算结果、组内样本量；同指标方法与基准表现 |
| M17 日历 | timeline_chart：事件时间线；calendar_chart：日历热力图 | 已知计划/实际时间、事件状态与引用；按明确时区聚合的每日事件数，零和缺失分开 |
| M18 回测 | equity_chart/drawdown_chart：折线；market_matrix_chart/parameter_heatmap：热力；parameter_sensitivity_chart：折线；validation_chart：横条；funnel_chart：柱；pnl_chart：瀑布 | 同期净值/回撤、完整参数试验与预选标识、同条件参数切片、分段验证、阶段计数和可对账损益；原生参数下钻保留 |
| M19 构建 | weights_chart：哑铃；changes_chart：有符号横条 | 当前/目标权重、现金和多空口径、建议变更；图表不下单 |

目录当前合计 **55 个候选图表**。除上表重点图外，M02.lifecycle_chart 为技术事件时间线；M03.factor_chart 为同量表因子横条；M04.price_estimates_chart 并列现价、公允价值、模型与分析师目标；M05.ratings_chart 为评级数量；M08.subjectivity_chart 和 fear_chart 分别呈现主观性与恐惧历史；M09.iv_history_chart 和 expected_move_chart 分别呈现历史 IV/HV 与各期限价格范围；M12.stop_chart 比较给定预算下的止损距离与规模。不同量表不画成同一分数，不从价格范围推导胜率。

日历与时间线输入须在 value.options 中声明实际 IANA timezone；币种、价格单位和原始尺度由数据提供，可覆盖候选 options。示例使用 America/New_York 不代表所有事件的默认时区。金额图保持同币种，跨币种先由指定方法处理并保留原值。规则记录、日历和权重的同列平面数组自动呈现可横向查看的表格，嵌套结果保留完整结构。

11 种组合的 suggested_charts 提供优先呈现建议：R01 行情 K 线/相对表现/新闻关注，R02 技术 K 线/历史分布/综合概率/基准对比，R03 事件 K 线/反应路径/条件基准，R04 财务趋势/估值敏感性/共识修正，R05 相对表现/主题/候选排名，R06 期限/偏斜/损益，R07 敞口/关联/监测，R08 校准/方法基准，R09 事件时间线/日历，R10 筛选/策略净值/回撤，R11 权重变更/暴露/历史净值。组合只引用模块字段，不再复制一套图表实现。

R02/R03 默认开头只给综合判断、概率/区间和历史依据摘要，完整结果分布和逐项推断放 M13。技术章节不重复画情景树，最后的 M15 用一个综合树统一表达触发、失效及后续观察；不在树里再次展开历史统计。单独的 M02、M14 仍保留完整候选，用户可以改变组合或要求多个树。字段的 history_display 可选 full/summary/hidden；summary 引用同份报告中实际存在的匹配历史章节。

## 图表字段及固定结果

例如用户只要 K 线和情景树：

```json
{"sections":[{"module_id":"M02","fields":["price_chart","scenario_chart"]}]}
```

绑定结果仍是一行一个字段，完整图表数据存于既有固定 json-rows DataRef：

```json
{
  "section_id":"M02",
  "field":"price_chart",
  "method_ref":"实际研究方法及版本",
  "value":{
    "rows":[{"time":"2026-10-01","open":"100.00","high":"102.00","low":"99.00","close":"101.00"}],
    "options":{"digits":2,"unit":"实际单位"},
    "takeaway":"填写本图由真实数据支持的发现",
    "source_note":"填写来源、范围、周期、时间口径和必要限制"
  }
}
```

以上价格只是格式演示。`options` 可调整已有图表参数；不能传 rows/data/kind/title、回调或原型属性。自建 chart 字段需 chart:{kind,options?,columns,data_requirements,evidence_role?}；`evidence_role` 为 descriptive / historical / prediction。更换图型时仍使用已声明的内置 kind 及其数据契约。网络等图型的 nodes 作为 value.nodes 固定在同一源结果中。

图表会在标题、结论和来源旁显示，并提供可展开原始数据表；点击标记选择对应原行。K 线保留十字线、缩放、价格轴和时间轴；条件树复用内置缩放与拖拽。资产按需要内联一次，离线页面不依赖 CDN。隐藏图表不进入运行时配置。每图最多 2500 行；统计和聚合由研究方法先计算并登记，Report 不重算。

## 置信度来自可比历史情景及实际结果

这里的“推断依据”是可核查的业务命题、方法和证据，不要求暴露模型内部思考文本。每项特征推断要有自己的历史依据；最终综合判断另有联合情景或综合方法的历史评价，不能平均特征置信度、把同一事件的重复报道当独立证据。

提供 probability / distribution / confidence，以及标记为 historical / prediction 的 chart 时，结果必须有 method_ref、validation 和 historical_basis：

```json
{
  "scenario":"在历史当时可观察到的特征条件及相似性范围",
  "matching_method_ref":"实际情景匹配方法及版本",
  "target":"与本次预测一致的结果定义",
  "horizon":"与本次预测一致的观察期限",
  "window":{"start":"2018-01-01","end":"2026-09-30","as_of":"2026-10-01"},
  "sample":{"matched":43,"resolved":40,"pending":1,"excluded":2},
  "outcomes":[{"label":"结果 A","count":22},{"label":"其他结果","count":18}],
  "baseline":{"status":"unavailable","description":"说明缺少可比基准的具体原因"},
  "dependence":"实际采用的重叠事件、重复样本及相关性处理",
  "uncertainty":"所选方法给出的区间、有效样本信息或尚未估计的原因",
  "limitations":["实际适用性、样本限制和选择偏差"],
  "refs":["此处实际传完整固定历史情景/结果引用对象，不能传字符串"]
}
```

此例计数仅解释格式。真实 refs 为 `{id,revision,digest,kind,schemaVersion}`；基准 status:provided 时还要 baseline.ref。样本数 matched=resolved+pending+excluded；互斥结果计数之和为 resolved。连续结果可以提供一个“全部已结算”计数并引用连续统计成果，不强制用某一分箱。历史窗口包含已知的实际结果，不能超过本次 as_of；匹配规则不能偷看未来结果。

每个 historical_basis 还需 sampling，默认先找当前品种近期同类情景：

```json
{
  "policy":"same_instrument_recent_first",
  "subject":"当前品种的明确标识",
  "recent_window":{"start":"2026-04-01","end":"2026-09-30"},
  "primary_search":{"status":"matched","eligible_count":40,"ref":"实际传固定检索结果引用对象"},
  "selected_scope":"same_instrument_recent",
  "instruments":["当前品种的明确标识"]
}
```

日期只是格式示例，近期长度由方法和任务决定。primary_search 保存已执行检索的固定结果；matched 时必须有符合样本，并且实际采用的同品种样本处于该近期窗口内。只有 status:no_match 且 eligible_count:0 才按默认顺序采用 selected_scope:cross_instrument，并注明替代 instruments 及 comparability（周期、目标、价格/收益口径、市场结构等适用差异）。检索 unavailable 时 eligible_count:null，不能据此宣称零匹配。保留少量本品种样本及其不确定性，不为凑数量自动混入其他品种。

用户明确指定不同来源或更长历史时，可用 policy:user_override、selected_scope:custom（或相应范围），记录 override_reason；跨品种仍说明 comparability。方法负责真实检索与可比性分析，Report 只核对选择记录和引用，不执行历史搜索。

`confidence` 值为 `{definition,estimate?,assessment?,interval?}`。estimate 如提供为 0–1；definition 说明是历史支持率、模型概率还是其他由方法估计的量。interval 如提供为 `{lower,upper,level,method_ref}`，不是统一固定的估计方法。没有足够历史证据时用 unavailable/pending 和 reason；不能用 50%、0 或模型主观打分填缺口。样本数量本身不证明有效性，方法须评价基准、相关性、偏差、时变和样本外表现。

M13/M14.inference_evidence 的类型为 inferences，每项为 `{id,claim,method_ref,confidence,historical_basis,validation,knowledge_basis?}`。组合报告集中放 M13；单独使用 M14 时仍可包含。knowledge_basis 的机制、假设、可检验预期与历史支持/冲突并列，详情见 module-templates.md 和 technical-research.md。每项历史情景、结果口径和来源独立记录；未支持的项使用 `{id,claim,status:'unavailable',reason}`，不能附置信度。综合结论的 confidence/probabilities 使用其自己的 historical_basis。

字段和引用检查只确认数据契约。`researchValidation:not_evaluated` 保持不变；历史频率、未验证估计、样本外记录、前瞻记录分别呈现。缺少历史证据的概率结果会在写入前被拒绝；改为明确缺项后仍可完成其他有证据的图表。

## 可复现演示

`node scripts/build-module-fixtures.mjs` 生成 `examples/module-visual-fixtures.json`：全部候选图表的虚构数据、160 次虚构方向事件、6 次独立期权结算，以及从这些事件实际计数的单特征/联合情景支持率。示例的 Wilson 区间是演示方法选择，不是模板默认算法。`history` 引用是显式占位，实际使用前冻结 history_rows 并换成返回的 DataRef。宿主集成测试会替换占位并为全部 19 个模块和 11 种组合及用户裁剪示例生成、发布、检查报告。技术多方法扫描是独立演示，未完成历史检索的 FVG/ATR 等特征保持 pending，不继承另一组事件的概率。

## 图表与研究摘要卡

每个模板的阅读问题、主辅图与详情入口见 [module-layouts.md](module-layouts.md) 和 `templates/module-visual-plans.json`。优先使用适合任务的图表；核心数字没有合适图型或用户偏好摘要时，使用 `presentation`：

| 视图 | 适合内容 | 数据要求 |
| --- | --- | --- |
| metric | 公允价值、模型目标、IV Rank、语料数等单值 | `value` 指定原值属性；`caption/meta` 指向已有解释。不同性质的目标分别命名。 |
| range | 历史高低范围中的当前值、已提供价格范围 | `lower/upper` 指定真实端点，`reference` 或 `value` 指向真实位置；不推导中点、不补概率。 |
| scores | 用户选用的同尺度因子横条 | `label/value` 指定属性，明确 min/max；有 `scale/scale_label` 时原量表必须匹配，不能平均生成总分。 |

例如 `{"kind":"metric","value":"值","min":0,"max":100,"scale":"尺度","scale_label":"0–100","caption":"定义","meta":["窗口"]}`。属性名来自所选方法真实结果；用户可改映射或传 null 关闭。单位可用 unit_field 核对原值，保留精确原值在“定义与完整数据”。错误映射、不同量表、缺失位置或不支持的区间会使用完整事实布局，不强迫改分析结果。卡片不替代已有主图，也不重复同一结论。

横条/区间的选择参考 [Carbon Bullet Charts](https://charts.carbondesignsystem.com/bullet) 对紧凑度与参照位置的说明。本包使用自身组件与主题，不引入该库；没有方法提供的好/坏阈值，不增加定性背景色带。

## 同一 K 线上的多方法特征

`candlestick` 的 `options.overlays` 可传最多 12 个 `{field,label,group?,style?,visible?}`，直接映射固定 OHLC 行中已计算的**价格**列。相同 group 通过复选框一起切换，style 为 solid/dashed。边界只在方法声明的有效时间段有值，其余为 null；原始数据表保留叠加列。指标计算与 FVG 识别都在独立方法完成，绘图层不识别特征。

ATR 原值属于价格尺度的波动幅度，不能在绝对价格轴上伪装成价格线。只有方法明确提供的 ATR 派生价格边界才可叠加；原始 ATR、成交量、震荡指标等宜用独立轴/图或摘要。不同流派的状态放 method_comparison_chart，方法扫描与输入缺口在 method_scan，所有特征和历史检索状态在 feature_signals。多条相近信号不等于多个独立证据。

## 策略图表的延续

M18 的净值/回撤之外，可选择市场矩阵、参数网格、敏感性、训练/留出对照、信号漏斗、损益构成。完整策略报告继续用原生源码逻辑图和 backtest-explorer：指标切换不重选获胜组，点格查看全部参数试验和分页，敏感性点能回到完整参数。组合摘要可以折叠次要图；用户要求完整策略报告时保留这些入口，见 [backtest.md](../report-writing/backtest.md)。


## 末尾证据附录

正文保留判断、主要 K 线/热力图/统计图、关键数字、精简读图说明、推理步骤与影响决策的条件。来源、真实原始数据、样本清单、复核计算、参数和完整方法细节统一集中在报告末尾可折叠附录；正文只留小锚点，点击展开对应附录并可返回。不要把主图或全部指标移入附录，不改变研究方法、数据或结果。

原始证据使用 `details` 内容块，或放入 `content.appendix` 中的 `details`。Report 集中到末尾并生成正文与附录的往返锚点，保留完整原值与固定引用，不复制样本或重新计算。正文的主要图表、必要控件和关键条件保持可见；验收锚点往返、窄屏及打印完整性，不自行编写 DOM 标记。
