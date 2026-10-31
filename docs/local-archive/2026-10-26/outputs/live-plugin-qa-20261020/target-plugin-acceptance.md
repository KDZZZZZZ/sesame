# 目标插件设计效果验收表

本轮目标为 **26 个可执行插件、271 个声明能力（181 Agent / 90 host-only）**。按真实设计效果判断，调用完成和插件ready不自动计通过。本表整理已有证据和剩余验收，不发送模型或业务请求。

当前正式身份取14:20:30Z维护verified：55 ready，四包新版本已载入；实际UI/业务效果仍按各自新证据判定。11:57仅保留为先前基线。

55 ready排除11个零capability纯知识包、18个ABU。Kurumi不在ready集合；QuantSkills的5个工具保留。旧disabled manual-trading的现行manual_trade_*职责由portfolio-execution承担，已纳入。

调用候选截至2026-10-20T13:18:47.163Z：45 Agent observed、14 Agent blocked、25 host-only observed、10 host-only blocked，177个无候选。这不是通过率。完整能力/证据ID和当前安装digest见[target-plugin-acceptance.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/target-plugin-acceptance.json>)。

## 执行边界

每目标一次综合场景，复用输入与报告；明确根因或依赖改变后至多一轮定点复测，仍不稳定停止。E按既有两份prompt分两段、两个临时插件分责，各执行一次，不混成一包。

模拟交易已有用户授权。MT5/portfolio因环境和终端许可反复受阻停止追加尝试，不再切账户、修改开关或挂EA。缺依赖/真值如实保留blocked/pending，不用其他插件替代通过。清理保留9暂停含6历史、报告、固定成果、配置与输入。

## 五个综合场景

| 场景 | 目标 | 实际产物 |
| --- | --- | --- |
| A 来源 → 解析/目录 → 固定证据 → 可见报告 | data-access、reports、financial-research、market-data-parser、quantskills-catalog、rss-collect、web-extract、web-sources | 原始与规范化引用、条数/必要尾段；实际文件、发布版本与同版本渲染；实际 PDF/PNG 和附件读回 |
| B 行情来源 → 图表/缓存/绘图 | canvas-control、akshare、ccxt、mt5、qmt | 来源/时间权威/范围与引用；同版本 bar_count/feed_status/错误；宽视窗、resize、最新按钮和指标/绘图 UI |
| C 有界因子实验 → SVL → 就绪原生引擎 | strategy-authoring、auto-factor-mining、backtrader、factor-evaluator、vnpy | evaluator 四阶段 session/digest/实测值；同版本 SVL 源码/图/回放；每个引擎的输入/成本/版本/实际结果 |
| D 团队研究 → 只评审决策 → 判断与记忆 | memory、investment-research、judgment-evolution、portfolio-execution、trading-decision | 实际成员终态、来源和综合结果；只评审完成且执行器未调用；QA 记忆接受/读回/实际使用与判断来源 |
| E 工作区/笔记插件 → 配置依赖；独立通讯插件 → 回环 → 清理 | configuration、plugin-manager、workspace | 新旧 digest 与更新后实际查询；缺项→消费配置→清空阻断；两提交、一用户消息、来源和唯一 ACK；QA 清理及既有数据保留 |

现有prompt使用前去掉纯skill、ABU、重复记忆与已停止交易/部署分支；准备脚本不等于执行证据。A组已有成果审计见[source-effect-audit.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/source-effect-audit.md>)，只建议补web-extract完整输出留证，不重新取数。

## 剩余场景不能自动补齐的效果

- **akshare、qmt**：B场景只在实际既有环境可用时能覆盖正向行情；否则停止并保留依赖阻断。
- **backtrader、vnpy**：C需要各自真实原生环境；一个引擎不能替另一引擎验收。
- **financial-research**：A只覆盖现有已授权provider/kind；缺凭据/权限的分支仍未验证。
- **judgment-evolution**：D可验证事前记录，但没有成熟真实后验就不能覆盖resolve/reflect完整效果。
- **memory**：D可验记忆生命周期；真实整理依赖自然触发，没有触发就保留缺口。
- **mt5、portfolio-execution、trading-decision、qmt**：交易正向执行、真实成交/平仓和自动计划不在剩余自动测试中；MT5反复失败分支零重试。MT5原生项目族亦未充分覆盖。
- **plugin-manager**：E本地临时插件不覆盖远端catalog发布/安装；不为补计数发布外部内容。
- **canvas-control、reports、ccxt**：产品源码回归不代替维护后正式桌面效果；LWC联合图表错误单列未决。

## 逐插件验收

### A 来源 → 解析/目录 → 固定证据 → 可见报告

复用已有固定成果，补最小来源/格式缺口，让一份报告的来源、正文、导出和附件真正闭环。

**sesame/data-access · 14:20已装 3.0.1 · 部分效果有证据**

用明确来源读取、冻结并验证数据与研究成果，保留时间、精度和覆盖范围。

- 验收：目录 SourceRef 与实际请求、InstrumentRef 一致，价格精度、volume 和时间 authority 不被猜测转换。
- 验收：query/read 读全所需页，snapshot 产生固定 DataRef 和可核对条数/摘要；partial 与覆盖缺口保留。
- 验收：插件 dataset 使用原 source + input.datasetId，裸 host dataset 不跨来源猜测。
- 验收：research_register 核对真实成功执行与输入/输出摘要；报告使用固定成果而非聊天 JSON 预览。
- 已有：BTC 120 根、黄金 114 根冻结与后续明确区间 115 根可追溯；范围不同不构成不一致。MT5 三个数据集改用明确 SourceRef 后冻结成功，原裸 ID 被正常拒绝。
- 下一步：复用完整固定数据，只补 A 确有缺口的来源/分页链并核对最终成果，不重复冻结已完成输入。
- 依赖：可用 provider；真实执行记录用于 research_register。
- 缺口：各种 source operation 与分页模式；host-only 路径与 Agent 工具分开计量。
- 证据：[market-health-audit.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/market-health-audit.json>)、[report-data-namespace-audit.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/report-data-namespace-audit.md>)、[market-report-ui-expanded.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/market-report-ui-expanded.json>)。

**sesame/reports · 14:20已装 3.0.4 · 部分效果已见；新修复待正式复验**

把研究成果写到指定路径并发布成用户可见、可导出、可追溯的报告。

- 验收：指定报告路径就实际生成并发布，报告区可见；单文件不无故套目录，内部数据 artifact 不冒充报告。
- 验收：来源可追溯，插件 dataset 显式 SourceRef/input.datasetId/title；check 失败修复原报告，未发布不称交付。
- 验收：中文强调、折叠区、表尾和附件实际可读；固定版本引用可辨认并打开对应版本。
- 验收：实际下载 PDF/PNG 全页/分片可读且尾行齐全，无截字或空尾页；注册附件链接可打开。
- 已有：跨市场 v3 PDF 9 页/114 行、证据 v3 PDF 11 页和 PNG ZIP/66 个尾单元格、量化 v1 PDF/PNG 已有下载证据。截字、附件 404 和多版本 chip 新修复及3.0.4已于14:20载入，正式UI复验另核。
- 下一步：复用一份既有报告核对来源；维护后以同一固定版本联合验 PDF/PNG、附件和版本引用，不重做研究。
- 依赖：新导出/附件/引用修复实际载入；固定报告与注册附件；桌面打印/下载环境。
- 缺口：各种模板和复杂页面；源码测试不能代替桌面实际导出。
- 证据：[evidence-export-v3-verification.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/evidence-export-v3-verification.json>)、[methods-export-quant.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/methods-export-quant.json>)、[report-attachment-links-before.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/report-attachment-links-before.json>)、[report-reference-before.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/report-reference-before.json>)、[report-data-namespace-audit.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/report-data-namespace-audit.md>)、[reports-3.0.4-prepared.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/reports-3.0.4-prepared.json>)。

**sesame/financial-research · 14:20已装 2.1.0 · 已有范围内设计效果有交叉证据**

获取并冻结金融证据，保留来源、单位、频率、修订和访问限制。

- 验收：实际 provider/kind 输出原始与规范化引用；FRED vintage/单位、CFTC 周期、SEC 生效时点按来源保留。
- 验收：read 读同一已保存数据的完整所需页，不再次联网或拿预览当完整结果。
- 验收：缺访问/窗口不支持返回 unavailable/partial，不把缺数据解释成没事件或 configured 当授权成功。
- 已有：2.1.0在本轮真实生成CFTC黄金6行、FRED DFII10和DTWEXBGS各3行的规范/原始artifact。每行规范data与对应raw逐字段相同。 7个固定数据集共40规范行及40原始行均可读；其中4个是本轮read复用的旧快照，不能冒充本轮重新取数或新版查询覆盖。 FRED Percent / Index Jan 2006=100、Daily、季调、vintage和last_updated均保留；观测止于2026-10-16。available_at为null仍为unknown，没有伪装点时已知。 CFTC仅6期Disaggregated Futures Only，持仓观察日与发布时间分开，保留partial与有限样本。
- 下一步：现有FRED/CFTC有限范围效果足够，不重复查询；其他提供方仅在后续真实任务适用且已有权限时补。
- 依赖：FMP/FRED/SEC/Reddit 各自凭据或 user-agent/权限；CFTC 网络与实际报告窗口。
- 缺口：FMP已配置但对象不匹配没有发query；SEC/Reddit在该时点缺配置且未请求。不能说这些来源无事件或已验收。；8次financial_research_read有调用记录；原入参/inline结果不全存，当前确认的是被引用数据可读及规范一致，不逐次宣称8个read内容完全还原。；其他provider/kind、历史发布时间与所有分页模式未覆盖。。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)、[methods-report-visual.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/methods-report-visual.json>)、[qa-next-coverage.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-next-coverage.md>)、[source-effect-audit.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/source-effect-audit.json>)。

**sesame/market-data-parser · 14:20已装 3.0.1 · 已有范围内设计效果有交叉证据**

将完整外汇 JSON/XML 原文解析成可追溯规范数据。

- 验收：输入完整冻结原文，base/rates/date/单位对照来源，不伪称实时行情。
- 验收：两种格式实际字段/条数可核验，错误格式明确失败而非空成功。
- 验收：规范结果保留原始来源/摘要，报告使用完整结果不靠预览。
- 已有：JSON原文166个货币，账本选3项的值全部相同；base USD和原日期保留。 XML原文22个货币，选3项的CurrencyName、Unit、ForexBuying/Selling逐项相同；JPY单位100，base=null未补造USD，公告日期匹配。 真实parse_fx_json/parse_fx_xml调用各一次，冻结parse_results和报告可使用的原文DataRef关联一致。
- 下一步：现有样本字段效果已有足够交叉证据，不为补计数重复解析。
- 依赖：符合支持格式的完整原始来源。
- 缺口：原始inline工具返回/入参随子JSONL清理，当前是调用时间线+冻结结果+原文交叉核对，不是完整中间回执逐字认证。；非法输入、全部输出/大结果等模式未覆盖。。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)、[methods-report-visual.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/methods-report-visual.json>)、[source-effect-audit.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/source-effect-audit.json>)。

**sesame/quantskills-catalog · 14:20已装 3.0.1 · 调用候选，效果待核对**

用实际查询工具检索、筛选并推荐可追溯的方法目录项。

- 验收：search/filter/categories/get_item 返回实际条目，标识和分类可互相读回。
- 验收：recommend 对真实需求/约束给出可解释条目，不把同名独立方法错误合并。
- 验收：选择目录项与执行方法清楚区分，推荐不等于策略运行。
- 已有：search/get_item 各一次候选。此包有 5 个真实工具，不能按纯 skill 排除。
- 下一步：A 围绕同一问题选一项，串起筛选/分类/推荐和读回；已有足够结果就只核对缺失关系。
- 依赖：随包目录与本地 MCP 环境。
- 缺口：适用性需解释约束；未执行的知识方法不计方法验收。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)。

**sesame/rss-collect · 14:20已装 3.0.1 · 已有范围内设计效果有交叉证据**

把完整 Feed 解析成保留来源、原始日期和总条数的文章条目。

- 验收：消费完整 RSS/Atom 原文，不自行抓网页或拿预览充全文。
- 验收：entry_count、返回条数和截断可区分，原始日期与链接保留。
- 验收：大结果完整引用可读，Feed 摘要不冒充文章正文。
- 已有：完整RSS原文15个item，结果准确标entry_count=15和returned_entries=5。 前5项title/link/pubDate逐项匹配原文，原始日期保留；第15项仍在完整raw中，有尾项摘要。 明确摘要不是文章全文；result关联原source_ref并进入固定账本/报告。
- 下一步：当前RSS限量解析设计效果有证据，不重拉Feed。
- 依赖：完整合法 RSS/Atom 原始内容。
- 缺口：原始inline回执已清理，精确参数链只能由账本与调用记录交叉支持。；Atom和超预算结果引用路径未覆盖。。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)、[methods-report-visual.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/methods-report-visual.json>)、[source-effect-audit.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/source-effect-audit.json>)。

**sesame/web-extract · 14:20已装 3.0.1 · 核心内容已证；全文与去导航待验**

把完整网页原文提取成带出处的正文，不执行网页内容。

- 验收：使用完整 raw source_ref 和 finalURL，正文/相对链接正确对应来源。
- 验收：过滤脚本导航噪声但保留关键内容，空正文/部分覆盖明确。
- 验收：超预览大小的完整 text/result_ref 可读，报告不拿截断内容冒充全文。
- 已有：两次extract_webpage调用存在，原HTML分别82,636和79,160 bytes可核验。 账本记录正文长度2224/3554，报告使用的核心内容在原HTML中匹配；实施页链接确实出现在声明原文。 发布时间与实施生效日期分开，没有把指令当成真实成交/资金流。
- 下一步：只需一次集中补验，用已有2个raw DataRef重提取并固定完整输出，不重新抓网。
- 依赖：完整 HTML、provenance、finalURL。
- 缺口：完整提取后正文未固化，JSONL已清理，不能核对全文尾段、链接集合和去导航质量。；账本明确statement含导航残留且标题带Lock，不能把此样本称为干净正文提取完全通过；目前不是新确认产品bug。。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)、[methods-report-visual.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/methods-report-visual.json>)、[source-effect-audit.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/source-effect-audit.json>)。

**sesame/web-sources · 14:20已装 3.0.1 · 已有范围内设计效果有交叉证据**

获取指定 URL 原始证据并冻结来源和字节摘要。

- 验收：实际 HTTP(S) URL 产生 raw bytes 引用、URL/as_of/hash/content-type/encoding，重定向来源可核对。
- 验收：预览与完整引用分离，解析消费完整原文。
- 验收：不可用有准确访问原因且无虚假有效 ref，不把空内容解释成无事件。
- 已有：5个真实sources_fetch与同一新子任务的web-sources 3.0.1 artifact来源一致；5份完整source.txt均存在且字节长度、blob摘要、provenance.data_hash、账本raw_bytes_hash一致。 包括RSS/XML、汇率JSON、TCMB XML及2篇HTML，编码/mediaType/as_of/来源URL保留。最大的两页完整原文82,636/79,160 bytes，非20k预览。 完整DataRef当前可读且已被冻结证据账本/报告下游引用。
- 下一步：复用，不再抓取相同5个URL。
- 依赖：明确 URL 和当前网络权限；不提供浏览器登录/JS 渲染保证。
- 缺口：失败/重定向/非UTF8/受限页面与host-only http_query未覆盖。；这里只证明实际保存与读取，不声称网页内容真实或持续可用。。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)、[methods-report-visual.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/methods-report-visual.json>)、[source-effect-audit.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/source-effect-audit.json>)。

### B 行情来源 → 图表/缓存/绘图

复用原 QA 图表验证可视范围、缓存、身份与实时状态；各提供方独立给出效果或依赖结论。

**sesame/canvas-control · 14:20已装 3.0.2 · 部分效果已见；新修复待正式复验**

把精确来源、图表、指标和绘图持久化为用户与 Agent 共同可见的工作台。

- 验收：绑定保持 provider、connection/configuration、instrument/spec 和时间权威；失效 revision 只经显式核验后 CAS 重连，不迁移冻结 DataRef 或旧绘图。
- 验收：apply 后同版本目标图实际有合理 bar_count；history、partial、feed_status 和错误各自真实，accepted/reported 不等于已显示。
- 验收：扩大可视范围或 resize 后缓存历史加入当前窗口且视角不跳；历史指标覆盖新加载区间，回到最新后继续缩放仍有效。
- 验收：同一 QA 绘图几何、代码与 artifact 可被 Agent 读回，刷新仍在；指标发布后有真实线条，编辑/删除只作用 QA 实例。
- 已有：黄金/BTC 显示、隐藏 75 秒缓存复用和定点 US100 恢复已有实证。500 根宽视窗左侧空白已复现，修复已于14:20载入，正式UI复验另核。历史指标 Worker 与联合图表分别记账，LWC Value is null 未决。
- 下一步：维护后复用原 QA 图做一次宽视窗、resize、最新按钮、历史指标与绘图读写的联合验收，不重做行情研究。
- 依赖：已核验来源与时间权威；新前端和相关插件补丁实际载入。
- 缺口：周期/来源切换与订阅释放；恢复按钮正式桌面路径；完整历史指标渲染；未发生的绘图/脚本模式不由一次 put 覆盖。
- 证据：[chart-cold-history-ui.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/chart-cold-history-ui.json>)、[chart-cache-grace-ui.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/chart-cache-grace-ui.json>)、[us100-binding-repair-verified.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/us100-binding-repair-verified.json>)、[chart-viewport-before.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/chart-viewport-before.json>)、[chart-viewport-fix.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/chart-viewport-fix.md>)。

**sesame/akshare · 14:20已装 2.0.1 · 调用候选，效果待核对**

把真实 AKShare 数据接入标准 A 股行情与数据查询契约。

- 验收：status/prepare 区分库导入和来源可用，实际失败有准确原因。
- 验收：真实标的可发现/describe，原始交易日、时间和价格/成交量单位正确。
- 验收：同来源历史/报价实际非空并显示；延迟、盘后和不支持订阅如实标注。
- 已有：只有 status/prepare 候选，包装器完成不能证明就绪；没有真实 A 股查询/显示证据。
- 下一步：B 一次核实既有环境；就绪才读一个标的，依赖缺失或来源失败则记录并停止。
- 依赖：可用 AKShare Python；来源网络和交易日覆盖。
- 缺口：其他 endpoint/实时模式；不重复盲装，不用别的源代替。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)、[qa-next-coverage.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-next-coverage.md>)。

**sesame/ccxt · 14:20已装 2.0.3 · 部分效果已见；新修复待正式复验**

按交易所与品种精确身份提供公开加密行情，正确处理缓存和限流。

- 验收：真实交易所/市场目录、价格基准和 UTC 时间精度一致。
- 验收：历史有真实行数，缓存仍保留覆盖/新鲜度；environment 成功不代替数据可用。
- 验收：live 有实际订阅更新；RATE_LIMITED 准确降级并有界退避，不高频重试或把缓存叫实时。
- 已有：Kraken BTC 固定样本、500 根图和缓存复用已见；真实 RATE_LIMITED 保留。2.0.2 分类修复已装，后续退避修复2.0.3已于14:20载入，实际订阅效果另核。
- 下一步：B 复用 BTC 缓存，维护后观察一个有界订阅/重挂周期，核对限流节奏，不额外刷交易所。
- 依赖：公开 API/网络额度；退避修复载入。
- 缺口：其他交易所/市场；外部限流不是产品 bug，只对不当本地重试归因。
- 证据：[chart-cache-grace-ui.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/chart-cache-grace-ui.json>)、[market-health-audit.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/market-health-audit.json>)、[qa-ledger.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-ledger.md>)。

**sesame/mt5 · 14:20已装 2.1.4 · 行情等部分已见；交易停止未通过**

把授权终端行情、研究执行、账户及原生工具暴露为身份和时间可核验的能力。

- 验收：行情通道与 Python IPC 各自报告真实状态；历史只用同 server/symbol 真实缓存锚点，保留 observedAt/stale/partial。
- 验收：精确绑定、冻结数据、显示和订阅分别有证据；真实订阅恢复才叫 live。
- 验收：交易按 DEMO 与实际许可检查；安全拒绝证明防护，不证明下单/成交/平仓效果。
- 验收：原生项目族将来有合法场景时保留真实环境和结果；当前不为覆盖挂 EA、改开关或再尝试交易。
- 已有：缓存/冻结黄金、在线图、Python IPC 恢复与 DEMO 识别已有证据。13:15 权限专项结束无订单且 terminal trade_allowed=false；交易闭环未过，停止重试。2.1.4说明包已于14:20载入。 用户已明确授权模拟交易；停止原因是反复环境/终端许可受阻，不是缺少用户授权。
- 下一步：B 只复用授权行情验证缓存/时间/显示；不重试交易。原生项目族保留未验证，不借通用命令绕过。
- 依赖：原终端/原账户权限；来源时间权威；离线专项需真实状态，不主动断开业务。
- 缺口：交易/成交/平仓/部署未过；真正离线冷启动首屏实际桌面证据；project/compile/test/translation/conformance 分支。
- 证据：[market-health-audit.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/market-health-audit.json>)、[chart-cold-history-ui.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/chart-cold-history-ui.json>)、[qa-1255-check.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-1255-check.json>)、[demo-permission-efficiency.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/demo-permission-efficiency.json>)、[mt5-2.1.4-prepared.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/mt5-2.1.4-prepared.json>)。

**sesame/qmt · 14:20已装 2.0.2 · 尚无功能证据**

把授权 MiniQMT/xtquant 行情和股票账户接入标准契约。

- 验收：environment 以实际系统/库/进程/授权报告缺项，不由 ready 推断可用。
- 验收：既有环境就绪才发现/describe/读取一个标的，时间、单位、来源可核对并显示。
- 验收：行情与账户/下单权限独立，未授权交易保持未验证，不借 command 绕过。
- 已有：无环境或行情调用候选，不能称离线或称本机账户已可用。
- 下一步：B 一次只读环境核实，条件具备才做一个行情样本，否则记录依赖停止。
- 依赖：Windows MiniQMT/兼容 xtquant/券商授权；既有行情环境。
- 缺口：账户/订单/撤单/positions_close 未授权测试；不配置新账户、不盲装或切终端。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)、[qa-next-coverage.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-next-coverage.md>)。

### C 有界因子实验 → SVL → 就绪原生引擎

一个真实假设与固定输入贯穿数值计算、策略结构和独立原生回测，允许空选择。

**sesame/strategy-authoring · 14:20已装 3.0.0 · 仅生命周期记录**

把同一策略源码变成可验证的 SVL 结构、图、执行和回放证据。

- 验收：真实源码通过语法/语义验证并产生固定 artifact/digest；非法输入有具体定位。
- 验收：图节点/边/参数对应同版本源码且可读；图可见不等于执行过策略。
- 验收：固定事件回放产生实际状态/意图和诊断，输入与结果版本一致。
- 验收：原生等价必须有独立适配和同输入比较；普通 Python 回测或静态图不能代替。
- 已有：只有 strategy_activate 候选，没有 validate/publish/graph/replay 的真实功能证据。
- 下一步：C 用一条清楚规则和固定输入完成一次验证/图/回放，按真实支持选择适配分支，不扩展优化。
- 依赖：合法固定输入；实际支持的 SVL 节点；原生适配另需就绪引擎。
- 缺口：pipeline/workflow/decision/functions 未选模式；各 native backend 独立语义一致性。
- 证据：[coverage-host-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-host-observed.json>)。

**sesame/auto-factor-mining · 14:20已装 1.1.1 · 仅生命周期记录**

以明确 evaluator 和角色分工推进真实因子研究，保存候选、测量、选择和结论。

- 验收：精确配置当前模型与显式 evaluator，固定开发合同；start 后跟到原 workflow Run 终态。
- 验收：角色真实提交，候选评分来自 evaluator 实测回执而非 Agent 手填，评审沿同一 session/trial。
- 验收：选择/finalize 可追溯；仅开发证据就明确 development-only，空选择也是有效结论。
- 验收：runs/activity/report 读同一成果，不另开挖掘补调用。
- 已有：只有 activate 候选，没有真实四阶段研究结果。
- 下一步：C 仅一个假设、一个有限候选集和一次 finalize；不为好分数循环调参。
- 依赖：当前模型/角色权限；合法面板和 evaluator；符合开发合同的 AST。
- 缺口：无隔离证据不宣称 sealed holdout；只在新 QA Run 自然需要时观察暂停/恢复。
- 证据：[coverage-host-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-host-observed.json>)。

**sesame/backtrader · 14:20已装 2.0.1 · 尚无功能证据**

运行真正 Backtrader 原生策略并保存可重读回测成果。

- 验收：确认真实 Python/Cerebro 与版本，导入成功不等于回测。
- 验收：固定 DataRef、Strategy 源码和成本执行一个真实引擎 Run。
- 验收：数据/成交/指标与输入范围及成本可核对，result 读同一固定结果不重跑。
- 已有：没有环境、回测或结果调用候选。
- 下一步：C 既有环境就绪才跑一个小型原生回测，缺依赖停止，不用别的引擎替代。
- 依赖：兼容 Python/backtrader；固定 UTC 数据、源码和成本假设。
- 缺口：SVL 原生等价另需适配证据；不可恢复 native 中断不自动重放。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)。

**sesame/factor-evaluator · 14:20已装 1.0.1 · 尚无功能证据**

为可信研究工作流提供确定的数值评估和冻结选择回执。

- 验收：仅由授权工作流嵌套调用；prepare 固定 session/inputDigest/开发合同，主 Agent 直调拒绝符合职责。
- 验收：candidate 的 metrics/eligible/gate/redundancy 来自计算，关联 AST 摘要和 trialId。
- 验收：select/finalize 沿同一 session 和精确 trialIds，回执/选择摘要完整，空选择或不足明确。
- 已有：没有 factor_evaluate 候选；自动因子插件激活不覆盖本评估器。
- 下一步：只嵌入 C 的唯一 auto-factor 工作流验四阶段，不另开主 Agent 直调。
- 依赖：合法固定面板/AST/可信上下文；开发/验证边界。
- 缺口：同数据集指标不是独立确认；无 holdout 证据不宣称封存验证。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)。

**sesame/vnpy · 14:20已装 2.0.3 · 仅生命周期记录**

用真实 vn.py CTA 引擎执行策略并保存原生回测成果。

- 验收：核实真实兼容 Python/vn.py/CTA 版本，元数据不等于执行。
- 验收：固定 DataRef、源码、合约和成本产生真实引擎 Run，失败保留原因。
- 验收：result 读同一固定每日/订单/成交和指标，取消不冒充成功或自动重放。
- 已有：只有 dispose 候选。取消异常已有独立回归，没有原生回测效果证据。
- 下一步：C 就绪才独立跑一个小型 CTA 回测，不可用停止，不以 Backtrader 代替。
- 依赖：兼容 64 位 Python/vn.py/CTA；固定数据、策略类和成本参数。
- 缺口：平台/版本覆盖；SVL 适配一致性需独立证据。
- 证据：[coverage-host-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-host-observed.json>)、[qa-ledger.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-ledger.md>)。

### D 团队研究 → 只评审决策 → 判断与记忆

有限成员链使用同一固定结果，产生真实评审与一条可追溯记忆；后验判断遵守真实时间。

**sesame/memory · 14:20已装 3.1.1 · 候选及旧失败；修后效果待验**

让可追溯候选记忆经过生命周期成为可检索、可使用和可整理的长期知识。

- 验收：本轮真实来源生成非风控 QA 候选；候选/正式记忆/版本 ID 分离，接受后在正确作用域可读。
- 验收：搜索/读取不自动记为使用；实际报告使用后才 mark_used，同一用例重复保持幂等。
- 验收：同一 QA 记忆的必要归档/恢复可追溯，不修改真实风险规则。
- 验收：若自然压缩/释放触发，真实整理生成合法 global/project/strategy 作用域并保存；无触发保留未验证。
- 已有：search/trading_context 和生命周期有候选。旧整理三次 scope.kind=main 被拒绝的提示缺陷已修且 3.1.1 已装，修后真实整理仍待验。
- 下一步：D 共用一个真实来源完成一条 QA 记忆生命周期，不重复创建或为计数强行压缩。
- 依赖：真实来源与实际使用处；自然整理触发；本轮不修改风控记忆。
- 缺口：真实整理修复复验；各作用域和未发生的管理模式。
- 证据：[compaction-audit.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/compaction-audit.md>)、[memory-3.1.1-update.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/memory-3.1.1-update.json>)。

**sesame/investment-research · 14:20已装 3.1.5 · 尚无功能证据**

围绕真实投资问题组织可追溯成员研究、反证、必要追问和综合结论。

- 验收：成员实际完成原 Run，固定 result_ref 含成员、来源、RunRef、QA 与 synthesis；accepted 不算团队完成。
- 验收：只向授权已完成前序成员问真实缺口，答案进入固定结果；不为计数虚构追问。
- 验收：指定报告必须实际文件/发布/渲染，output:none 数据结果不冒充报告。
- 验收：report 重排只启动 synthesis 并保持原 result_ref，不重新拉数据或跑分析员。
- 已有：三个能力均无调用候选。宿主两次子任务唤醒已验，但不替代本工作流。
- 下一步：D 用已有固定证据做一个范围明确的问题和有限成员链，结果复用于只评审决策与记忆。
- 依赖：当前可用模型/角色权限；固定证据；真正需要的前序信息。
- 缺口：start_from 后缀重跑未发生则未验；模型拒绝是阻断，不用模板假装团队复核。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)、[passive-wake-audit.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/passive-wake-audit.json>)。

**sesame/judgment-evolution · 14:20已装 3.0.2 · 仅生命周期记录**

把事前判断、后验事实与经验规则形成可审计改进链。

- 验收：事前记录真实来源、时点、期限和可判条件，不把已知结果回填成预测。
- 验收：有成熟真值才 resolve/reflect，保留证据与未知状态；无后验就 pending/defer。
- 验收：规则可追溯至判断与依据；after_turn 记录不冒充判断效果。
- 已有：只有 activate/after_turn 候选，没有 record/resolve/reflect/rule 功能结果。
- 下一步：D 记录一个合适真实判断；有成熟结果才继续，否则只验记录/查询/到期管理。
- 依赖：真实来源与合理前瞻期限；成熟独立后验事实。
- 缺口：不缩短期限或造真值强行通过；其他规则管理模式。
- 证据：[coverage-host-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-host-observed.json>)。

**sesame/portfolio-execution · 14:20已装 2.0.1 · 只读/拒绝路径；交易停止未通过**

把明确授权的组合或人工目标转成有状态、可核验的执行过程。

- 验收：context/status/inspect 反映真实约束与目标，只读不产生订单。
- 验收：只评审不调用执行器；关闭许可时阻断并保留原因。
- 验收：正向执行需对账目标和真实成交/仓位，accepted 或 completed 不代替 targetReached；本轮该分支停止。
- 已有：status/inspect 有候选，交易专项无订单且许可关闭；实际目标仓位闭环未通过。manual_trade_* 当前属此包。 模拟交易已有用户授权，停止缘于实际环境/许可阻挡。
- 下一步：D 只读状态与 execute:false 评审，不重试受阻交易、不为验收改风控。
- 依赖：既有账户只读权限；用户已授权模拟交易，但终端许可关闭且专项反复受阻，因此按用户停止规则不再追加。。
- 缺口：observe/execute/cancel 与实际成交闭环；不为计数 configure/apply 真实策略。
- 证据：[coverage-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-observed.json>)、[demo-permission-efficiency.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/demo-permission-efficiency.json>)、[qa-1255-check.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-1255-check.json>)。

**sesame/trading-decision · 14:20已装 3.3.1 · 仅生命周期记录**

用固定研究证据、账户约束和角色评审形成可追溯决策及执行边界。

- 验收：精确当前模型与固定 result_ref，原 workflow 真实结束才读最终报告。
- 验收：execute:false 只评审，实际工具无执行器/订单副作用，评审依据与意见可追溯。
- 验收：不交易是合法结论但不验证执行；review 用真实后验/注册证据，行情不等于成交。
- 验收：不为覆盖启用 event/定时计划；读完成结果不启动新业务。
- 已有：仅 activate 候选；别的交易许可专项不替代本包只评审工作流。
- 下一步：D 消费同一投资研究固定结果，完成一次 execute:false 评审；不尝试正向交易。
- 依赖：当前模型与角色配置；固定研究结果及只读账户/风控信息。
- 缺口：执行器/计划事件/真实成交 review；不启用自动交易或修改约束。
- 证据：[coverage-host-observed.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-host-observed.json>)、[qa-next-coverage.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-next-coverage.md>)。

### E 工作区/笔记插件 → 配置依赖；独立通讯插件 → 回环 → 清理

两个职责独立的 QA 临时插件：笔记查询包验证脚手架、更新后真实查询和配置能力绑定；integration 包只验证消息入站与幂等。

**sesame/configuration · 14:20已装 3.1.2 · 部分效果有证据**

集中管理配置和秘密字段，并把缺项、可用性与依赖能力绑定。

- 验收：目录把必填字段关联到具体 capability；未声明配置不误报成缺密钥。
- 验收：QA 临时插件缺字段时被阻止，配置非秘密测试值后真实能力消费该值，清空后再次被阻止。
- 验收：入口定位同一字段，writeOnly 值不在读取/UI/日志回显；configured 不冒充远端鉴权成功。
- 验收：更新临时包后依赖关系仍正确，现有模型/auth 和真实配置保持。
- 已有：统一配置 UI 的 10 个密码字段遮罩和能力关联已有检查；catalog/check/open 有候选，尚无 apply→真实消费→清空证据。
- 下一步：仅在 E 的笔记查询临时插件验 required + writeOnly 生命周期，通讯临时插件保持独立职责；结束只清理 QA 值。
- 依赖：临时插件配置声明；不使用真实凭据、不切模型。
- 缺口：真实外部鉴权不能由 QA 假字段代替；模型更新延迟生效分支本轮不修改。
- 证据：[configuration-ui.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/configuration-ui.json>)、[configuration-3.1.2-update.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/configuration-3.1.2-update.json>)。

**sesame/plugin-manager · 14:20已装 3.0.3 · 部分效果有证据**

通过正式入口发现、加载、创建和更新插件，保证版本、依赖锁及既有数据可追溯。

- 验收：发现与实际指南/工具一致，真实 Agent 加载后可调用临时插件。
- 验收：API 2 QA 脚手架可校验安装并返回真实功能数据；mounted/manifest 可读不足。
- 验收：临时包更新后版本/digest 改变，loadout 和 QA 状态保持，再次真实查询证明新逻辑载入。
- 验收：只清理本轮两个临时包，按各自阶段结束；既有插件、9 暂停含 6 历史、报告/配置和固定成果保持。
- 已有：正式维护已验证更新、依赖锁与 9 暂停保留，Agent discover/read/inspect 有候选；尚未验证 Agent 自建临时包的完整生命周期。
- 下一步：按 E 两份 prompt 分别制作笔记查询包与独立 integration 包。笔记包更新一次后真实查询并清理；通讯包仅回环、保留到真实 ACK 核验后清理。
- 依赖：当前宿主 API 2；本地 QA staging；不修改/卸载业务插件。
- 缺口：远端 install_catalog 需真实已发布 QA 条目，本地 install 不替代；不为计数重跑现有依赖冲突与回滚专项。
- 证据：[verified.json](<E:/brief2great/sesame/outputs/live-plugin-qa-history-fix-20261020/verified.json>)、[plugin-manager-3.0.3-update.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/plugin-manager-3.0.3-update.json>)。

**sesame/workspace · 14:20已装 3.0.1 · 部分效果有证据**

让 Agent 在可追溯工作区完成真实文件读写编辑和进程执行。

- 验收：只在 QA 目录完成必要读写编辑/搜索/导入/移动/删除，UTF-8 内容和完整字节摘要可核对。
- 验收：实际进程有工作目录、退出码、stdout/stderr 和 Run；wrapper completed 不能掩盖子进程失败。
- 验收：更新/重启保留文件、9 暂停及输入，私有子任务边界不绕过。
- 验收：清理只删除本轮临时文件，报告、审计证据、配置和历史任务不动。
- 已有：报告实际写入/编辑/发布及进程已有证据；Get-FileHash 不可用是命令失败。取消崩溃和暂停保护已有回归/维护验证，文件各模式仍有缺口。
- 下一步：E 制作临时插件复用同一 QA 目录，完成必要文件模式和一次明确成功进程，结束有限清理。
- 依赖：真实 OS 权限与进程环境；仅 QA 目录，不提权。
- 缺口：未发生的中断和跨目录权限模式不通过破坏业务补覆盖。
- 证据：[demo-permission-efficiency.json](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/demo-permission-efficiency.json>)、[qa-ledger.md](<E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-ledger.md>)。

## 跨插件效果与收尾

两次被动唤醒已确认父idle、子Run终态、通知和自动主回复，期间无人工prompt；不用重做。它不替代investment-research的实际工作流效果，也不使纯知识orchestration重新纳入。

独立通讯插件仍须同ID/相同文本两提交、一可见用户输入、来源可辨识、实际delivered与唯一ACK，且无业务副作用；ACK核验后再清理。笔记查询插件按自身场景结束清理。

每个已执行分支记录达到设计效果、产品缺陷、外部/输入阻断或未验证，并关联真实版本、引用和输出；未发生模式继续列缺口，不把单一路径当全能力通过。

## 排除清单

纯知识：orchestration、behavioral-finance、dow-theory、elliott-wave、factor-research、ict、institutional-analysis、narrative-analysis、price-action、strategy-research、wyckoff。

ABU：abu-backtest-lab、abu-breakout、abu-exit-rules、abu-indicators、abu-ml-features、abu-model-lab、abu-moving-average、abu-parameter-search、abu-position-sizing、abu-price-structure、abu-seasonality、abu-similarity、abu-stock-screening、abu-trade-judges、abu-trade-metrics、abu-trend、abu-trend-pullback、abu-volatility。

Kurumi按用户要求不测；旧disabled manual-trading不在55ready，其现行职责已在portfolio-execution列出。
