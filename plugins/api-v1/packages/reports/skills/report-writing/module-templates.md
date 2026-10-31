# 可调整的报告字段模板

模板提供建议字段与组合。用户当前要求优先，其次是任务已确认的约定、适用偏好，再采用默认建议。用户可以增删字段、改标题、重排、合并章节或完全自定义。本次调整不自动写入公共模板或长期偏好。

Report 定义结果含义并呈现已有研究；理论、数据需求、特征识别、历史匹配、综合算法及置信度计算由用户指定或任务选择的方法完成。不要为填模板补算另一个指标，或静默替换用户指定的方法。方法不可用时说明实际缺口。

## 目录与起点

`report_structure({})` 返回轻量目录；传 `template_id` 获取具体字段。需要完整目录时读取 `templates/module-catalog.json`。业务模板 ID 与 `content.kind` 布局、`chart.kind` 图型是不同参数，不要混用。

所选字段返回 `agent_guidance`，包括定义、输入内容、单位/时间、解释边界和缺失处理；完整按需资料见 [field-guide.md](field-guide.md)。每个模板的 `visual_plan` 给出主图、辅助图、摘要与明细安排，详见 [module-layouts.md](../report-design/module-layouts.md)。这些都是建议。用户改写 meaning/type 后不继承旧语义指导或不兼容展示；显式字段清单不因视觉计划而被补回。

| 模块 | 建议内容 |
| --- | --- |
| M01 行情状态与相对强弱 | 价格表现、趋势、波动、相对强弱、变化 |
| M02 技术事件与价格情景 | 事件、关键位置、情景、触发与失效条件 |
| M03 基本面与财务质量 | 财期、增长、盈利、现金流、负债、同业 |
| M04 估值与价格假设 | 估值、假设、市场对照、敏感性、隐含要求 |
| M05 共识与预期修正 | 覆盖、共识、修正、分歧、实际结果对照 |
| M06 宏观与公司事件冲击 | 事件状态、预期、实际值或分支、反应、更新 |
| M07 新闻主题与关注变化 | 事实、主题、新信息、关注、影响解释 |
| M08 情绪与拥挤状态 | 来源、情绪、变化、拥挤、分歧与背离 |
| M09 波动与期权定价 | 隐含与实际波动、期限、偏斜、事件及尾部 |
| M10 期权结构与损益 | 目标、合约、成本、损益、风险、替代结构 |
| M11 条件筛选与机会候选 | 范围、条件、候选排序、覆盖缺口、后续研究 |
| M12 风险与组合暴露 | 组合、暴露、集中、相关、压力、风险预算 |
| M13 历史同类特征验证 | 特征、匹配、样本、基准、结果、区间、验证 |
| M14 多特征综合预测 | 目标、综合判断、支持与反对、概率、置信度、情景 |
| M15 条件行动与监测计划 | 用户目标、情景、约束、观察、行动状态、复核 |
| M16 预测复盘与校准 | 原预测、结算、实际结果、评价、校准、偏差 |
| M17 经济与公司事件日历 | 跨事件时间表、经济数据、财报、股息、拆股、会议及日程修订 |
| M18 策略回测与历史表现 | 冻结规则、模拟持仓、净值、回撤、基准、成本、区间和验证记录 |
| M19 组合构建与再平衡 | 用户目标、约束、当前与目标权重、变更、再平衡及方案状态 |

| 组合 | 无更明确要求时的起点 |
| --- | --- |
| R01 资产概览 | M01、M06、M07 |
| R02 综合行情预测 | M14、M01、M02、M06、M07、M13、M15 |
| R03 事件冲击研究 | M06、M01、M13、M14、M15 |
| R04 公司价值与中长期展望 | M03、M04、M05、M06、M15 |
| R05 市场日报与机会扫描 | M01、M17 日历摘要、M06、M07、M11 |
| R06 期权波动与策略结构 | M09、M10、M06、M12、M15 |
| R07 持仓与组合诊断 | M12、M01、M15 |
| R08 预测复盘 | M16 |
| R09 经济与公司事件周历 | M17；按需展开 M06 事件研究 |
| R10 筛选策略与回测评估 | M11、M18 |
| R11 组合构建与再平衡方案 | M19、M12 风险摘要、M18 历史表现摘要 |

这些组合不隐含研究授权、持仓读取或某种预测算法。按资产适用性、已有成果和用户需要选取；用户仅要概览时不强制预测。

## 业务字段的细化建议

以下 key 均为可选择的建议，不是必做分析清单。object/array 内的子项按实际方法和资料组织；用户可以直接替换字段、命名或类型。只检查本次采用的字段类型与上下文，不根据候选示例强制算法、指标、阈值或持仓规则。

| 模块 | 补充字段与语义 |
| --- | --- |
| M01/M02 | reference_price、timeframe_states；event_identity/event_times/event_lifecycle、geometry、research_horizons；entry_zone、targets、stop_plan、reward_risk。检测时间、bar 周期、预测期限分别记录；失效位与风险止损也分别表达。 |
| M03 | factor_results、composite_assessment、income、cycle_context。保存每个因子的原值、尺度、标签、方法和同业范围；不固定五因子或综合权重。 |
| M04/M05 | valuation 与 model_target 分开；M05 的 target_prices 另表分析师意见。update_schedule、rating_distribution、analyst_count、target_dates 保存各自日期、期限和覆盖，不相互补空或平均。 |
| M06/M07 | previous_values、surprise、reaction_windows、event_importance；coverage_details、source_mix。前值与修订值不能互换，预期差不自动决定价格方向；新闻去重与来源覆盖影响其解释。 |
| M08 | subjectivity、evidence_volume、trend_indicator、fear_index。供应商证据量 Confidence 只放 evidence_volume，不直接填行情预测 confidence 或 probability。 |
| M09 | quote_context、iv_history、iv_rank、iv_percentile、expected_move、volatility_surface、volatility_cone、liquidity。IV Rank 与百分位按各自方法定义；定价范围不是经校准的实际价格概率。 |
| M10 | max_profit、max_loss、breakevens、profit_probability、expected_profit、greeks、liquidity、settlement。到期损益、最大金额、期望与盈利概率分别表达，成本/乘数/期限一致。profit_probability 与其他概率字段一样需要自己的可比历史结果。 |
| M11/M12 | selection_logic、rank_rules、candidate_details、backtest_refs；stop_variants、stop_distances、position_size、execution_costs、margin。筛选逻辑和止损/规模计算由独立方法提供，字段不产生交易授权。 |
| M15 | scenario_terms 保存同一情景的方向、触发、入场、目标、失效、止损、期限、成本和盈亏比。综合树引用这些条件；不新增重复情景树。 |
| M17 | scope、events、economic_releases、earnings、dividends、splits、meetings、schedule_changes、coverage。实际值未知用 null，未公布与确认无事件不是同一状态；时区由数据声明。 |
| M18 | hypothesis、universe、selection、simulation、window、metrics、benchmark、positions、trades、costs、assumptions、validation、artifacts。可引用现有原生回测成果，M13 的同类情景统计不能替代策略历史表现。 |
| M19 | objective、constraints、current_weights、target_weights、changes、weighting_rules、rebalance、benchmark、performance_refs、risk_refs、action_status。原组合与新方案业绩必须区分，不能把旧权重业绩改名作为新方案结果。 |

每个模块另有默认折叠的 instrument_context、data_times、source_scales：按适用性保存交易所/资产类型/币种/合约单位、数据截点/观察与首次可得时间/时区/bar 周期，以及提供方/原量表/版本。它们是可调整的说明字段，不扩展 section.context 的匹配键；需要严格匹配时仍使用 subject/as_of/target/horizon。固定证据引用继续放结果行 evidence_refs，不以文字描述代替引用。

M18 只展示方法已经生成的回测结果，不会启动回测；M19 只展示构建结果，不调用优化或下单。选择独立方法时，使用用户指定或任务决定的方法引用。没有提供某项可选结果时不出现空章节。

M18 保留原有策略报告路线：真实源码逻辑图、品种×周期热力图、点格查看全部参数组、指标切换与参数敏感性继续使用 [原生回测模板](backtest.md)。新增 market_matrix_chart、parameter_heatmap、parameter_sensitivity_chart、validation_chart、funnel_chart、pnl_chart 供组合摘要或单图报告选用；logic_graph、parameter_trials、selection_rule 连接同源执行结果。摘要图不替代完整原生下钻，也不重新选优。

M02 的 method_scan 记录同一固定 K 线上已尝试方法及无信号/不可运行状态；feature_signals 记录各方法特征、时点、触发失效与历史参照；method_comparison_chart 展示时间与状态，不给流派打分，也不发起分析。结果形式与知识/统计对照见 [technical-research.md](technical-research.md)。示例方法不成为模板默认方法。未覆盖任务可以不指定 template_id，用多模块或完全自建 sections；只要含义、来源、单位和时点清楚，就可借用这些字段和视觉，方法不受模板限制。

例如用户只关心财报与股息，可以用 `{"template_id":"R09","sections":[{"module_id":"M17","fields":["earnings","dividends"]}]}`；日历图和其余事件不会自动加回。可运行的三种裁剪示例保存在 `examples/module-visual-fixtures.json` 的 custom_examples 中，复用相同固定数据。

## 覆盖语义

`report_structure`、`report_publish.content.structure`（kind 为 modules）和预览 helper 的 `structure` 使用相同输入：

```json
{
  "template_id": "R02",
  "locale": "zh-CN",
  "sections": [{
    "id": "technical",
    "module_id": "M02",
    "title": "关键位置与两个情景",
    "method_refs": ["用户实际选择的方法及版本"],
    "fields": [
      "key_levels",
      "scenarios",
      {"key": "counterevidence", "label": "相反证据", "type": "array", "meaning": "用户要求的相反证据", "required": true}
    ]
  }]
}
```

- 省略 `sections` 才采用模板建议；提供后**完整替换**建议章节，不自动把其余章节合并回来。数组顺序就是报告顺序。
- 省略某节的 `fields` 才采用该模块的建议字段；显式数组完整替换，包括空数组。字符串选择已有字段；对象可以覆盖已有字段或定义新字段。
- 新字段需要 `key / label / type / meaning`，已有字段只需 `key` 和要改的属性。可选 `unit / required / display`；`display` 为 `visible / folded / hidden`。
- `presentation` 可选 metric / range / scores，把已有 object/array 映射为数值卡、区间位置、同尺度因子条；`null` 关闭建议展示。`value/label/lower/upper/reference/caption/meta` 只指定结果的直接属性，`min/max/unit/digits` 只规定显示，`scale+scale_label` 与 `unit_field` 可要求原始尺度/单位吻合。所有原值在明细保留；缺失映射、不同尺度或不支持的区间回退为完整事实布局，不改数据、不补中点或平均总分。详例见 module-visuals.md。
- 没有 `module_id` 时，用 `id / title / fields` 定义完全自建的章节。重复模块可使用不同 `id`，例如不同资产或期限分别报告。
- 所有建议字段默认 `required:false`。只有本次明确指定的 `required:true` 缺少结果才形成缺项；用户删除的字段不检查。
- 组合可有自己的建议字段范围。R02/R03 将开头 M14 精简为结论、概率/区间和依据摘要；M13 承担完整历史样本与逐项验证；最后的 M15 提供唯一综合情景树。M02 单独使用仍可带自己的树，用户显式 sections/fields 完整覆盖组合建议。
- `history_display` 为 `full / summary / hidden`，只调整历史依据的显示。summary 在同份报告有对应 M13 详细证据时提供跳转，固定引用和真实验证状态仍保留。
- `method_refs` 只约定结果应来自哪些已选方法，不执行或替换方法。所选字段的提供结果必须携带其中一个 `method_ref`。理论引用放结果行的 `theory_refs`。
- `inference_evidence` 每项可附 `knowledge_basis:{theory_refs?,mechanism,assumptions?,expected_observation,agreement,interpretation}`。agreement 为 supporting / conflicting / mixed / insufficient，由分析方法给出；分别说明知识预期与历史实际结果如何支持或冲突。没有引用可以省略 theory_refs，不能编造；缺少历史的推断保持 pending/unavailable，不附概率。Report 只呈现该对照，不自动认为知识成立或历史频率等于因果。
- `context` 可约定 `subject / as_of / target / horizon`；提供结果的行须逐项匹配。不约定时不推断跨资产或跨期限的一致性。

返回的 `kind:structure` 是已解析的结果，含字段定义与来源版本。使用 modules 内容或预览 helper 时传原始结构输入，不把解析结果当作入参；可以按用户调整更新原始输入后重新解析。模板与用户偏好没有本地隐式持久化。

## 固定研究结果的行格式

modules 内容读取一个已有 `json-rows` DataRef。复用相关方法的固定成果；需要映射原结果时，使用现有数据与工作区能力保留输入引用和实际执行记录，再通过 `research_register` 登记转换结果。宿主已登记的数据可用 `report_data` 冻结。不要为适配模板另造研究数值。

```json
{
  "section_id": "technical",
  "field": "key_levels",
  "status": "provided",
  "value": [{"label": "支撑区域", "value": "来自方法的实际结果"}],
  "method_ref": "用户实际选择的方法及版本",
  "theory_refs": ["实际使用的知识资料版本"]
}
```

固定来源可置于 `evidence_refs`，每项是完整 `{id,revision,digest,kind,schemaVersion}`。不会把 URL 或裸 ID 冒充固定成果。行的 `context` 与结构中的约定一致。一次报告最多 4096 行，每个 `section_id + field` 在被选结果中只能出现一次。

`status` 可为 `provided / unavailable / pending / not_applicable`。未提供结果时省略 `value` 或填 `null`，同时给出 `reason`；不能填 50% 或零代替未知。没有结果行的可选字段不显示占位章节；明确提供的不可用状态保留说明。没有任何提供结果时，完整度为 `empty`。

字段类型：`text / number / integer / boolean / array / object`，以及带明确语义的 `probability / distribution / interval / confidence / inferences / chart`。精确价格与金额可在 text 或对象内保留原始 decimal 字符串；不会转 Number 重新计算。`chart` 是可选的内置图表字段，所有 19 个模块均有候选；K 线、图表数据、置信度及逐项推断输入见 [模块可视化与历史证据](../report-design/module-visuals.md)。

概率字段为 0–1 数值。分布字段格式：

```json
{"target":"实际预测目标","exhaustive":true,"items":[{"label":"结果 A","probability":0.6},{"label":"结果 B","probability":0.4}]}
```

这些数字只说明格式，不能用于真实报告。类别和目标由任务决定；仅 `exhaustive:true` 检查概率和为 1。区间格式为 `{lower,upper,meaning,level?}`，上下限为数值，`meaning` 区分概率估计区间、价格预测范围或其他含义；`level` 如提供须为 0–1。

## 历史证据与置信度

行情预测涉及的特征应关联同类历史研究；M13 是历史结果的表达字段，M14 承接综合方法的判断。如何定义特征与相似性、选择样本、处理重叠、估计不确定性、验证和校准，均由独立方法负责。

采样结果保留当前品种近期同类样本优先的记录；使用其他可比品种时有已完成且零匹配的原检索成果。近期窗口由方法提供，不固定统一天数。historical_basis.sampling 保存该记录、当前品种、检索窗口、原成果与符合数量、最终样本范围及跨品种可比性；用户明确覆盖时保存 override_reason。具体格式见模块可视化指南。

概率、分布、置信度结果行带 `method_ref`、`historical_basis` 和 `validation`。历史依据必须包含相同或可比情景的匹配定义、实际后续结果、样本处理、基准、不确定性及固定引用，不能只贴一个通用来源或让模型给自己打分。每项推断使用自己的历史依据，综合预测另有联合情景或综合方法的历史检验。`validation` 示例：

```json
{"status":"historical_exploration","note":"实际研究的验证范围与局限","history_refs":[]}
```

支持 `unvalidated / historical_exploration / out_of_sample / prospective / not_applicable`。概率与分布不接受 `not_applicable`；声称 `out_of_sample / prospective` 须附历史成果的固定引用。引用可读及字段齐全**不证明研究有效**，工具返回 `researchValidation:not_evaluated`。各特征与历史研究的详细对应关系由 M13 结果保存。

历史频率、供应商评分、定性信心和预测概率分别表达。`confidence` 类型承接指定方法的定义、估计或定性评价、可选估计区间，同时要求历史依据。缺少可比历史结果时使用 unavailable/pending 与原因。没有统计模型时允许定性报告，不补造模型或校准版本。

用户可隐藏历史明细或置信度显示；这不改变固定源结果中的状态。预测字段显示时，其验证状态随值呈现，避免未验证结果被误读为验证通过。

## 装配、发布与检查

直接调用 `report_publish`，使用 `content: {kind: "modules", structure, results_ref}` 和通用 `style`。`structure` 是用户本次选择的原始结构输入，`results_ref` 是已有固定成果；数据与历史证据的完整引用仍须进入对应 `data`、`references`。内容展示所选字段，未采用结果不进入正文。

`report_compose` 是可选预览 helper，可用于检查当前字段提供状态、绑定要求和视觉；其返回的 `publish` 内容与样式可用于正式发布，不编辑或上传预览 HTML。`completeness` 只反映本次字段提供状态，`researchValidation` 不代表研究已验证。字段、方法或上下文不匹配如实修正；缺少结果可呈现明确缺项，不能为凑齐模板补造研究。

发布需要新的 `operation_id`、真实 title/summary、provenance_kind、固定数据及关联证据；演示输入保持 demo。随后用返回的精确 ref 调用 `report_check`。生成页面、固定发布、渲染通过和统计有效是不同结果。需要不同呈现时改内容结构、选择通用 document 组件或调整声明式 style，不能转向任意 HTML/CSS。

改变显示时复用固定成果；改变方法、目标或期限时由编排层判断需要重新研究的部分。不要删除装配绑定来替换来源，应该重新装配。

可运行的演示输入见 `examples/module-report-input.json`：同一份明确虚构的结果分别生成 R02 建议结构和用户指定的技术情景结构。演示不接入行情，也不代表任何理论的预测效果。


## 末尾证据附录

正文保留判断、主要 K 线/热力图/统计图、关键数字、精简读图说明、推理步骤与影响决策的条件。来源、真实原始数据、样本清单、复核计算、参数和完整方法细节统一集中在报告末尾可折叠附录；正文只留小锚点，点击展开对应附录并可返回。不要把主图或全部指标移入附录，不改变研究方法、数据或结果。

原始证据使用 `details` 内容块，或放入 `content.appendix` 中的 `details`。Report 集中到末尾并生成正文与附录的往返锚点，保留完整原值与固定引用，不复制样本或重新计算。正文的主要图表、必要控件和关键条件保持可见；验收锚点往返、窄屏及打印完整性，不自行编写 DOM 标记。
