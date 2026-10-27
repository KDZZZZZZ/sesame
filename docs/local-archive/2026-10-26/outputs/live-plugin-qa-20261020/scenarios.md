# 最新插件真实主 Agent QA 场景

源码基线：59bf69da89f0d9ac55e575ee19151bd64ed5c029 加当前未提交修改；更新于 2026-10-20T08:03:39.806Z。这是待执行计划，当前通过数为 **0**。

实际扫描 **55包（9 core + 46 optional）**：**289个capability（199 Agent可见 + 90宿主专用）**，11个纯知识/指南包，356条知识资源（59 skill、60 prompt、237 reference）。11 source的46个操作、3 service的12个操作及27 hook通常绑定已有capability，不能叠加为新功能。MT5动态原生方法须读取当前终端catalog后补充，不能静态宣称全覆盖。

所有业务任务交给**工作台真实主Agent**，沿用现有模型和工作区。外部测试人员仅观察、记录、查bug、修bug和测试，不替Agent取数、计算、补报告或执行模拟/真实交易。先核验运行包版本及内容摘要与JSON一致；只用最新接口，不加旧版兼容要求。

用户已确认模拟盘。模拟下单、改止损、挂单撤单、平仓与策略挂载/卸载已纳入S05/S06。由真实Agent先读取**原始MT5 trade_mode=0/DEMO**并核对账户，只动唯一 `qa-20261020-<run-id>` 标记的本轮QA对象。UI“模拟”标签或归一化demo字段不够；QMT/未知账户/真实资金账户仍只读。

## 八个自然任务

### S01 准备今天的研究工作台

> 检查当前研究工作台的插件和模型是否都是这次最新版本，列出我现有配置能直接使用的数据来源、尚缺的依赖以及对应功能。打开统一配置入口让我看清哪些信息影响哪些能力，保留现有账户、模型和历史暂停任务。不要显示密钥。

验收：当前运行的插件版本/内容摘要与本矩阵的匹配证据；差异按最新包部署问题处理；能力依赖表：configured、authenticated、connected、ready分别记录；配置入口截图，密钥仅显示已配置状态。

边界：模型连通性由真实主Agent的正常回复/任务结果证明；配置存在不算连通；不更换模型，不改账户或凭据，不恢复既有暂停任务；若 catalog 公开版落后于本地最新源码，不安装旧版充数；先由负责部署者解决最新包身份。

效率：一个主Agent自然任务，复用一次发现结果；不对同一不可用依赖循环探测。

### S02 建立可继续研究的跨市场观察页

> 用现有本地行情建立一个黄金、A股和数字货币观察页；每类选择可用代表品种，保留真实来源、时间口径和数据缺口。打开图表，增加一条可编辑的指标和两项绘图标注，切换周期并拖看历史，再回到当前行情。来源具备条件时补少量缺口并订阅更新；没有连接的来源如实说明。

验收：明确SourceRef/连接revision、InstrumentRef及DataRef，覆盖范围、数量单位和closed/forming状态；同一视图冷/热加载及拖动记录；缓存范围与可见范围对照；订阅释放记录；绘图修改后代码与Agent读取结果一致，刷新后保留；K线涨跌色保持原样。

边界：宿主专用market/account能力通过标准data-access与画布路径触发，不从主Agent伪造内部调用；真实来源不具备时只标blocked_dependency，不把合成样本冒充现有行情；MT5缓存清理不触碰真实缓存；QMT下载仅在真实缺口和已配置来源下进行。

效率：同一冻结输入供后续场景复用；每来源一次代表查询，再按确切缺口分页。

### S03 整理有出处的驱动简报

> 围绕观察页中的资产，整理一份这周的宏观、公司和市场驱动简报。核对可用的公告、经济序列、持仓信息和公开新闻，把网页、订阅源和汇率资料整理成可复用证据。列出来源时间、取得时间和覆盖限制；无权限的数据明确留缺口，不用泛新闻替代财报或未来经济日历。

验收：可读的来源完整ref与解析result_ref；大文本分页完整，source_ref直传而非截断preview；可用SEC/FMP/FRED/Reddit/CFTC来源实际响应及权限限制；每个kind分支单独记状态；web-extract/rss-collect/market-data-parser分别有取得材料与解析后字段证据。

边界：解析器只处理已取得材料，不替代联网取数；无密钥分支优先但不冒充有权限分支通过；JSON/XML两种汇率格式均有独立样本；样本若为演示必须保持demo身份；不能读取/打印配置密钥；仅使用主Agent已获准的来源和既有代理配置。

效率：复用同一网页/Feed完整内容，禁止为每个分析方法重复抓取。

### S04 比较交易研究方法的实际增量

> 以同一组固定行情与简报为依据，比较趋势、突破、回撤和震荡解释。使用现有八种知识方法分别指出有证据支持的局部结论、反证和不适用项，再用ABU基线核查信号、选股、波动、退出、仓位、交易特征、模型与成本表现。每个实际使用的方法说明新增了什么信息；数据不够就指出缺口，不拼凑一致投票。

验收：每个知识包的实际plugin_read调用、资源摘要、引用到本轮证据的判断和反证；18个ABU能力各自的输入/输出不可变ref、实际参数、数值或明确缺口；已知ATR初始化差异、预热缺失、available_at、单位和同源重复证据得到正确处理。

边界：不能只加载或复述方法简介；必须在实际资产/输入上运用才算knowledge applied；ABU需要的交易记录/标签/候选矩阵等由主Agent依据任务准备；缺少真实材料不得由QA脚本代造；参数搜索、模型训练与成本诊断仅为研究，不能宣称实盘收益。

效率：先划分证据类型，复用同一DataRef和可兼容计算；对输出很大的series保存引用而非反复复制进上下文。

### S05 把候选做成一次可复查的实验

> 从上面的候选选一个可检验假设，完成一轮小规模因子和策略实验，固定开发/验证范围、预算和标准。让现有流程安排实际角色并保存真实评估回执；表达成SVL并查看节点图，使用可用原生回测引擎验证。需要MQL5时生成QA专用工程、编译并做Tester；确认当前MT5原始trade_mode为DEMO后，可挂载再卸载本轮唯一测试标记的策略，只操作其产生的QA仓位。

验收：实际角色Run/阶段、候选及评价回执；prepare/candidate/select/finalize分支逐项归档；独立固定计划/选择/输入引用和全试验账本，失败及空选择保留；SVL源图一致、图布局可读；各原生引擎真实过程/版本/结果ref；翻译partial与conformance范围正确；原始DEMO证明、QA build/deployment ID、mount/stop回执及本轮仓位清理证据。

边界：最多一个研究方向和一轮最小实验起步；主Agent可按证据决定不合格/空选择；factor_evaluate必须由真实授权工作流嵌套调用，QA harness或主Agent直调不能替代流程证据；MT5先真实Tester与冻结build；通过DEMO gate后仅挂载/卸载本轮QA部署，既有EA/持仓不动；缺少某引擎时该引擎blocked_dependency，不拿另一引擎成功冒充；不维护旧接口兼容；模拟账户挂载可能要求translation.mode:live，这是原生运行目标，不代表许可真实资金账户。

效率：对同一结果只登记一次；复用已有DataRef和成功执行。主Agent空闲后由真实子任务完成事件继续工作，记录是否需人工催促。

### S06 研究综合、风险评审与模拟盘闭环

> 把固定研究交给多角色流程综合，针对关键缺口询问原研究员。先只读核对账户、持仓和已确认风险规则，跑一次execute:false评审。由你读取当前MT5原始trade_mode确认DEMO和账户一致后，用唯一QA标记和最小合法数量完成模拟下单、修改止损、挂单撤单和平仓，也验证本轮明确执行的决策流程。只动本次测试订单和仓位。记录一个今后可核验判断并复核已有判断，缺后来证据的保持待核验。

验收：真实多角色成员输出、QA问题/答案/新证据和synthesis结果ref，不能伪造团队通过；当前账户/原始DEMO证明/风险规则版本；execute:false无executor，DEMO执行分支有真实executor和原生回执且只动QA对象；判断事前时间/原始口径与真实后验来源匹配；候选准则不替代用户确认风险规则；逐动作记录order/deal/position ticket、retcode及真实状态；accepted不冒充成交，QA对象最终有清理或未决证据。

边界：先做只读与execute:false；DEMO gate成功后才创建本轮QA明确执行计划，不切模型/账户绕门槛；周期/事件仅在能证明只命中本轮QA DEMO计划时做一次有界触发并关闭；不触发既有计划，不留下后台运行；缺适用已确认风险规则或事实时保留阻断，不伪造confirmed规则跑通；单次模拟动作与workflow动作分别记录，全部由真实工作台Agent经正式能力执行，外部harness不代行；判断核验不倒填预测；缺后验样本未覆盖。memory只使用QA偏好/知识候选，不伪造账户风险红线。

效率：优先复用S02–S05证据；报告重排用仅报告入口；重做研究限明确阶段，不重跑全部成员。

### S07 交付可阅读、可导出的报告

> 把本轮研究整理成一份单文件中文研究报告，直接放在报告区，名称按研究主题。检查图表、折叠说明、引用和长表格，在深色与浅色主题、宽窄窗口都读一遍，再导出PDF和图片。需要改排版时只改报告，不重新进行研究。

验收：report_check针对精确修订的渲染回执与实际report_publish交付；报告区条目、打开路径和历史一致；HTML直接为单文件且无自动analysis包装目录；名称不使用手工交易日报；导出PDF/图片实际文件可打开且非空白，分页/中文/图表无裁切；宽窄主题截图。

边界：数据ArtifactRef和聊天正文不是报告文件；无发布回执不得判报告已交付；深色蓝紫、浅色蓝橙（Claude橙）；检查主题渐变，不修改K线颜色；details/summary实际折叠展开；代码围栏里的标签保持字面量；无危险HTML执行。

效率：复用冻结结果；只报告重排由单一综合者完成，不新开一轮取数/分析。

### S08 整理本轮资料并验证插件维护路径

> 把本轮QA产生的资料副本整理成清晰目录，验证搜索、导入、编辑、移动和读取。做一个只读的QA笔记查询插件，用最新脚手架安装验证、更新一次，再仅卸载这个临时插件。保留本轮正式报告、研究证据和全部原有插件及资料。

验收：所有写/移动/删除对象均位于本轮QA副本目录；摘要前后对应；外部原文件未改变；QA插件清单/能力/配置绑定符合最新约定；主Agent实际调用后有可核验查询结果；只对临时插件做生命周期；原有55插件版本/状态、历史和暂停任务保持。

边界：工作台Agent自行编写和使用QA插件；外部测试harness不替其检索研究材料或补业务结果；安装更新只用最新来源；没有最新发布版本时记录渠道差异，不回退旧接口；生命周期通过的是临时插件维护路径，不能据此把MT5/QMT等宿主hook一并标通过。

效率：在独立QA目录中进行一次完整可逆循环；不全机扫描、不重装所有依赖。

## 逐插件覆盖索引

每个capability的模式、前置条件、配置绑定、可验证输出及未覆盖分支详见plugin-matrix.json。下表是计划归属，不表示通过。

| 插件 | 场景 | Agent/宿主能力数 | 必须取得的业务证据 |
| --- | --- | ---: | --- |
| sesame/canvas-control | S02、S07 | 7/0 | 视图绑定精确SourceRef/InstrumentRef，chart_drawing read/put/remove只针对QA标注 |
| sesame/configuration | S01、S07 | 7/0 | 33项来源配置字段按能力条件映射可检查，敏感字段仅configured状态 |
| sesame/data-access | S02、S03、S05 | 8/0 | 所有分页真实数据和coverage；data_snapshot/research_register返回完整ref/evidence |
| sesame/memory | S06、S08 | 6/8 | 主Agent读取适用记忆与原文来源；QA候选只在明确范围创建/使用/归档 |
| sesame/orchestration | S01、S06 | 0/0 | 实际按用户目标选择功能并解释界面/流程；不猜工具，不将资料内容当权限。 |
| sesame/plugin-manager | S01、S03、S08 | 11/0 | 最新实际加载manifest/digest匹配；discoverable/enabled不是测试通过 |
| sesame/reports | S05、S07 | 6/0 | 精确修订渲染通过、发布回执、报告区文件可见且可打开 |
| sesame/strategy-authoring | S05、S07 | 8/2 | validate诊断、publish ref、graph与源匹配、replay真实轨迹、pipeline/workflow执行结果 |
| sesame/workspace | S02、S05、S08 | 13/0 | UTF-8/分页/摘要和路径正确；QA文件新增、编辑、导入、移动、删除可回查 |
| sesame/abu-backtest-lab | S04、S05 | 1/0 | 成本后回测诊断、实际成交假设与原生引擎区分 |
| sesame/abu-breakout | S04 | 1/0 | 突破观察、窗口/阈值与前序价格绑定 |
| sesame/abu-exit-rules | S04 | 1/0 | 假设入场后极值/first_exit；首根TR=high-low、N根ATR预热 |
| sesame/abu-indicators | S04 | 1/0 | 各指标latest/series与空预热；首TR=null、ATR需要N+1根 |
| sesame/abu-ml-features | S04 | 1/0 | 每个decision_time只使用已可见历史，max窗口+1不足会拒绝 |
| sesame/abu-model-lab | S04、S05 | 1/0 | 真实训练/评估切分、模型预测和指标；不拿训练拟合作未来收益 |
| sesame/abu-moving-average | S04 | 1/0 | 移动均线/交叉的实际时点与窗口；无未来数据 |
| sesame/abu-parameter-search | S04、S05 | 1/0 | 全部候选/参数与实测评价矩阵，不只保留最优试验 |
| sesame/abu-position-sizing | S04 | 1/0 | 固定权益/币种/点值假设、ATR/Kelly/rank；输出不冒充券商手数 |
| sesame/abu-price-structure | S04 | 1/0 | 局部结构/极值与实际bar、确认延迟对应 |
| sesame/abu-seasonality | S04 | 1/0 | 季节分组、有效样本和覆盖限制，稀疏样本不放大 |
| sesame/abu-similarity | S04 | 1/0 | 相似度输入/窗口与候选对照；近邻非独立盈利证明 |
| sesame/abu-stock-screening | S04 | 1/0 | 多品种筛选输入、缺失与选中/排除理由可复查 |
| sesame/abu-trade-judges | S04 | 1/0 | 真实特征、标签和训练边界；模型判断不变成执行授权 |
| sesame/abu-trade-metrics | S04 | 1/0 | 交易收益、成本和评价口径与原始交易记录对应 |
| sesame/abu-trend | S04 | 1/0 | 趋势数值、窗口和有效性；保留反例与局限 |
| sesame/abu-trend-pullback | S04 | 1/0 | 趋势过滤与回撤条件/确认时点，无未来看齐 |
| sesame/abu-volatility | S04 | 1/0 | 波动/ATR/gap/VWAP；与indicators同输入ATR一致，预热为null |
| sesame/akshare | S02 | 6/8 | 真实声明能力的输出、固定引用和错误语义与任务一致 |
| sesame/auto-factor-mining | S05 | 7/4 | 真实workflow Run、角色checkpoint、候选/选择/holdoutMode及测量回执 |
| sesame/backtrader | S05 | 3/1 | 环境版本证据、冻结输入/源码/成本、真实原生process receipt和结果ref |
| sesame/behavioral-finance | S04 | 0/0 | 将注意力、偏差或拥挤解释连接实际来源，给出可区分的替代机制。 |
| sesame/ccxt | S02 | 2/7 | 真实声明能力的输出、固定引用和错误语义与任务一致 |
| sesame/dow-theory | S04 | 0/0 | 说明主要/次级趋势及跨序列确认，缺少第二个有效序列时不伪造确认。 |
| sesame/elliott-wave | S04 | 0/0 | 给出可检验的浪形候选及替代计数、失效位置；证据不足时保留不确定。 |
| sesame/factor-evaluator | S05 | 1/0 | 真实嵌套prepare/candidate/select/finalize回执、sessionId与digest链 |
| sesame/factor-research | S04、S05 | 0/0 | 实际形成假设/候选/评价/固定选择/样本外安排；将流程与ICT等局部知识区分。 |
| sesame/financial-research | S03 | 4/2 | status与源凭据状态分离；query实际metadata/provenance、完整固定行和证据source/query |
| sesame/ict | S04 | 0/0 | 用本轮固定OHLC定位流动性、结构位移和FVG候选，注明时点与反证，不把形态直接当订单。 |
| sesame/institutional-analysis | S04 | 0/0 | 用制度、参与者、约束与激励解释实际材料；不从价格推造机构身份。 |
| sesame/investment-research | S06、S07 | 3/0 | 真实前序成员、QA及synthesis；output:none与report分支分别记账 |
| sesame/judgment-evolution | S06 | 13/3 | 到期/反思/coverage队列及原判断完整读取；真实后验证据才能resolve |
| sesame/market-data-parser | S03 | 2/0 | parse_fx_json与parse_fx_xml分别有输入来源和结构化汇率结果 |
| sesame/mt5 | S01、S02、S05、S06 | 31/31 | 本地bars与实时连接分别验证；Python版本/IPC和Terminal MCP分别验证 |
| sesame/narrative-analysis | S04 | 0/0 | 比较有来源与时间的叙事传播、证据和价格机制，不把流行程度当事实。 |
| sesame/portfolio-execution | S06 | 9/1 | 完整execution binding、账户/合约/报价observed_at及expiry证据 |
| sesame/price-action | S04 | 0/0 | 用同一行情解释摆动、区间/趋势与突破或失败；将图上标注关联真实bar及反例。 |
| sesame/qmt | S01、S02、S06 | 11/17 | 行情和STOCK账户依赖分别验证；覆盖、复权/单位与当前连接revision准确 |
| sesame/quantskills-catalog | S01、S03 | 5/0 | search/filter/categories/item/recommend各有实际结构化输出；版本与当前包一致 |
| sesame/rss-collect | S03 | 1/0 | 真实RSS/Atom→条目/来源/时间，缺字段保留而不推造 |
| sesame/strategy-research | S05 | 0/0 | 实际固定实验计划、时间切分、成本、引擎、预算和全试验账本；引用失败与局限。 |
| sesame/trading-decision | S06 | 12/4 | 固定research_refs、memory规则版本、实际review/manager输出与execute:false |
| sesame/vnpy | S05 | 3/1 | ready/configured分开；真实引擎daily/trades/orders及匹配固定输入ref |
| sesame/web-extract | S03 | 1/0 | 真实HTML→正文/标题/链接或可解释错误，大结果result_ref可完整读取 |
| sesame/web-sources | S03 | 1/1 | 来源状态/抓取时间/完整内容ref，分页或大内容后续读取可用 |
| sesame/wyckoff | S04 | 0/0 | 依据量价及阶段证据讨论积累/派发假设，区分可观察事实与机构意图推断。 |

## 模拟交易与未覆盖边界

真实Agent须核验原始trade_mode，login/server/revision贯穿观察和提交一致；只操作本轮QA订单ticket、持仓和部署ID，使用原生最小合法数量。策略先真实Tester与冻结build，再mount/check/stop；`translation.mode:live`表示原生运行模式，不等于授权真实资金账户。改止损、撤单和平仓后读取真实状态；unknown沿用原operation_id核对，不重复提交。结束时记录QA清理或未决状态，不处理已有业务。

真实资金、未证明DEMO及QMT交易仍未覆盖；外部harness不能代行任何交易。周期/事件仅允许能证明只命中本轮QA DEMO计划的单次有界测试并关闭，不能触发既有计划或留下后台运行。缺适用风险规则不能伪造规则跑通。`manual_trade_*`现属portfolio-execution，仍在矩阵；旧manual-trading包和Kurumi排除。

现有模型、账户、密钥和历史暂停任务保持。删除/移动/卸载只针对QA副本文件和临时QA插件；不能以临时插件生命周期通过代替其他包hook通过。缺凭据、环境、DEMO证明或后验样本分别blocked/not_run，不算通过。

## 记录与判定

逐调用保存实际版本/摘要、会话/Run/角色、模式、脱敏输入、固定ref/原生回执、错误、耗时及截图/导出路径。知识包需有实际读取与本轮应用/反证位置，loaded不算应用。记录模型轮次/token、重复取数/子任务、首帧与冷热缓存；无基线时报告测量值。

状态：not_run、pass、partial、fail、blocked_dependency、blocked_authority、blocked_demo_verification、user_operated_live_only、not_applicable。queued/accepted与模型口头完成不是pass；报告需精确修订渲染、发布回执和实际文件。矩阵所有能力/模式初始not_run，执行后按证据逐项更新。
