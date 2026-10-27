# 投资分析信源：实际使用证据、接入方式与组合边界

调研日期：2026-10-18。匿名接口抽样检查时间：2026-10-18 10:03–10:04 UTC。范围：股票基本面、宏观利率、黄金及商品研究。仅做公开资料研究与少量匿名读取，没有调用真实交易、使用用户 API Key、注册新服务或获取付费正文。

优先补齐的不是更多同类新闻网站，而是当前研究容易缺失的几类不同信息：**公司原始披露及电话会问答、带修订版本的宏观数值、专业预测的分布、期货分类仓位、基金实物持有量、可追溯的事件原文**。这些信息回答的问题不同，不能拿更多价格指标代替。

本文的“强证据”是能直接证明某位从业者或研究者使用了相应信息，不代表该信息必然带来超额收益，也不代表所有投资机构都遵循同一流程。“默认集成”与“公开网页能打开”分别判断。

## 1. 为什么选择这些信息：直接证据

| 证据与时间 | 谁在实际使用 | 使用了什么、解决什么问题 | 对 Sesame 的含义与证据强度 |
| --- | --- | --- | --- |
| [NBIM《Responsible investment 2024》投资流程部分](https://www.nbim.no/en/news-and-insights/reports/2024/responsible-investment-2024/web-report-responsible-investment-2024/)；报告年度 2024 | 挪威主权基金投资及风险团队 | 系统分析财报、财报电话会以识别风险信号，接入投资工具；用模型从电话会文字识别公司谈论气候问题的变化。 | **强：机构公开报告中的实际流程。** 需要完整披露文本、发言人和跨期内容，只有收入/EPS 数字不够。该案例属于治理和可持续性研究，不能扩大成所有交易都要做 ESG。 |
| [Cliff Asness 接受 FT Unhedged 访谈，AQR 官网公开转载](https://www.aqr.com/about-us/news/2024/~/media/AQR/Documents/News/2024/FT%20Unhedged%20Friday%20Interview%20Cliff%20Asness%20AQR)；2024-03-08 | AQR 管理人 Cliff Asness | 说明公司声明文本可以形成基本面动量，与价格动量互补；自然语言的上下文比正负词表更重要，也会研究影响资产价格的经济数据趋势。 | **强：有明确问答的从业访谈。** 支持“文本和基本面是不同于价格的信息”，不支持把采访中的做法硬编码成每个 Agent 的必经步骤；访谈本身不提供可复制的交易绩效验证。 |
| [Matsumoto、Pronk、Roelofsen，2011，What Makes Conference Calls Useful?](https://repub.eur.nl/pub/25721/)，[DOI](https://doi.org/10.2308/accr-10034)；2011-07 | 会计学研究者；《The Accounting Review》原论文的作者机构库 | 使用超过一万份电话会记录，研究准备发言和分析师问答相对财报新闻稿的信息增量；问答部分相对更有信息。 | **强：原论文机构记录与摘要；本次未获取收费全文。** 电话会获取能力应区分准备发言与 Q&A，不能把新闻稿当作完整电话会。论文结论不等于文本预测一定盈利。 |
| [Damodaran，NYU 估值数据与工具](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datatools.html)；持续维护页面，示例含 2012 年 | 估值研究者及教师 Aswath Damodaran | 用公司财务披露、宏观数据、行业数据估值；展示用 10-K 加 10-Q 建立滚动十二个月报表，而非一直沿用旧年度数据。 | **强：公开的具体计算材料；教学证据。** 支持获取季度/YTD/年度口径及期间信息。旧案例用来说明方法，不用来证明旧链接或旧价格今天仍有效。 |
| [PIMCO，Assessing Inflation: Theories, Policies and Portfolios](https://www.pimco.com/us/en/insights/assessing-inflation-theories-policies-and-portfolios)，[报告 PDF](https://www.pimco.com/us/en/documents/5cd414c28e2c9c1a660945635333b8b783aae8f7c8b143189e42d415bd5f85dc166d05b79da2db6b4a6cbd00f9099c51?app=dot)；2021-07-29 | Jamil Baz、Josh Davis、Peder Beck-Friis、Jerry Tsai | 通胀研究中使用实际通胀、盈亏平衡通胀及费城联储 SPF 预期；考虑市场盈亏平衡通胀中含风险溢价的问题。 | **强：投资机构研究报告明确说明数据选择。** 预期、实际、风险补偿需要分开；“前值”不能冒充“预期”。PDF 的跨区直链有读取失败，本次搜索索引能核对 SPF 使用段落，HTML 可读；未声称完整复现其回归。 |
| [纽约联储 Survey of Market Expectations](https://www.newyorkfed.org/markets/market-intelligence/survey-of-market-expectations)；2025 年合并两套旧调查，2026 年持续更新 | 纽约联储公开市场交易台及联储工作人员 | 调查一级交易商与活跃投资决策者的政策利率、资产负债表及宏观预期，并结合市场价格评估预期。 | **强：实际使用者与调查目的直接披露。** 是有明确样本与问题定义的“预期”来源；结果约在会议后三周公布，不能当成当天实时共识。 |
| [AQR 向 CFTC 的公开意见函](https://comments2.cftc.gov/Handlers/PdfHandler.ashx?id=29273)；2020-05-15，正文第 2–3 页 | AQR 商品期货从业者 | 直接用 2006–2019 年 CFTC 分解持仓，比较生产商/商户与 Managed Money 的净仓位及未平仓量占比，讨论风险转移。 | **强：实际公开分析，有明确原始数据来源。** COT 可回答谁承担哪种风险、仓位是否拥挤；该函有政策立场，不能当成“跟随管理资金必赚钱”的证据。 |
| [PIMCO，Charting Commodity Markets With Greg Sharenow](https://www.pimco.com/gbl/en/insights/charting-commodity-markets-with-greg-sharenow)；2025-07-08，图表数据截至 2025-06-27 | 商品组合经理 Greg Sharenow | 将油价与 EIA/IEA 的备用产能等行业供给数据结合，判断地缘冲击可能持续多久。 | **强：明确的研究使用。** 行业供需可形成与价格不同的解释；旧观点仅证明信息如何使用，不是当前市场判断。 |
| [WGC 黄金 ETF 研究与数据](https://www.gold.org/goldhub/data/global-gold-backed-etf-holdings-and-flows)；所见报告 2026-10-07 | 世界黄金协会研究团队 | 同时使用基金披露、ETF 持有量及资金流、交易数据、CFTC 仓位解释黄金投资需求。 | **强：报告明确列出数据源；存在行业立场。** 黄金实物持有量、资金流与期货仓位应分别读取；WGC 的聚合与评论并非新的独立一手证据。下载和自动化还有授权限制，见下表。 |
| [Bybee、Kelly、Manela、Xiu，Business News and Business Cycles](https://www.aqr.com/insights/research/journal-article/business-news-and-business-cycles)；AQR 原作者研究页 2024-08-31 | 学术研究者，其中包括 AQR 研究负责人 | 使用 1984–2017 年约八十万篇 WSJ 全文研究经济主题及新闻关注度的信息增量。 | **强：原作者公开论文说明。** 新闻研究需要正文、时间与主题，标题正负打分不足；该研究的数据许可不授予我们抓取 WSJ 正文的权利。 |
| [CFA Equity Research Report Essentials](https://www.cfainstitute.org/sites/default/files/-/media/documents/support/research-challenge/challenge/rc-equity-research-report-essentials.pdf)；2020-09 文档 | CFA Research Challenge 研究规范 | 要求关注财报附注、盈利质量、行业特定指标、预测假设与敏感性。 | **中强：专业研究指导，非实际机构全行业调查。** 支持附注/行业 KPI/反证需求，不宜把整份报告模板强加到每次局部分析。 |
| [r/SecurityAnalysis 资源指南](https://www.reddit.com/r/SecurityAnalysis/wiki/index/)、[政府资源页](https://www.reddit.com/r/SecurityAnalysis/wiki/government/)；页面未给清晰最近修订日期 | 社区维护者 | 明文组织财务、行业、估值、政府数据资源；政府页列出 BEA、联储、财政部等。 | **辅助证据。** 证明这些是该社区的推荐资源，不能证明投资者总体共识或盈利性；没有用赞数作权重。链接和内容仍需逐项核对。 |

## 2. 候选信源及其接入条件

以下“免费”只说明公开访问或服务收费，不自动等于允许任何商业再分发。对未核实的限额和报价不填猜测数字。

| 信源 / 信息类型 | 适合回答的问题 | 入口及接口形态 | 费用、注册、配置 | 自动化及解释边界 | 建议 |
| --- | --- | --- | --- | --- | --- |
| **SEC EDGAR 原始披露与 XBRL** | 盈利质量、季度现金流、分部收入、资本开支、会计口径、风险因素，原始公告核验 | [官方 API 文档](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)：`data.sec.gov/submissions/CIK##########.json`；`/api/xbrl/companyfacts/CIK##########.json`；原申报正文和附件。 | 免费、读取 API 不需 Key。需配置真实应用身份及联系人 User-Agent；这是请求标识，不是付费密钥。 | [Fair access](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)：当前上限 10 请求/秒、按需下载。标准 XBRL 聚合不能替代分部附注和自定义标签；保留 accession、申报/接受时间、报告起止日、单位与重报版本。 | **先补齐现有能力。** 季度/YTD 和可分页正文读取优先于另加一套财务聚合商。文档已核实，本 lane 未用虚构联系邮箱测试 API。 |
| **公司 IR / 财报电话会原文** | 管理层指引、业务机制、分析师质疑、前后说法变化、GAAP 与调整后差别 | 公司原站 HTML/PDF/音频。可读实例：[Microsoft FY26 Q4 完整电话会页](https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q4)；[Apple IR](https://investor.apple.com/) 为公司入口。 | 多数公司公开材料可免费阅读；不需要统一第三方 Key；各公司覆盖和留存期限不同。 | 没有覆盖所有公司的统一免费电话会 API；有些只有音频。区分公司自述与已核验财务事实，保留 speaker、准备稿/Q&A、事件日和原文段落；不能自动把转载纪要标成官方逐字稿。 | **优先原站材料。** 在现有抓取/解析能力中加入实体到官方入口的配置及文档类型说明。 |
| **FRED / ALFRED 与原发布机构** | 实际/名义利率、通胀、就业、信用与增长；当时到底已知什么 | [FRED API](https://fred.stlouisfed.org/docs/api/fred/)、[vintage dates](https://fred.stlouisfed.org/docs/api/fred/series_vintagedates.html)，观测值接口加 real-time/vintage 参数。元数据保留原来源。 | [免费 API](https://fred.stlouisfed.org/legal/)；[需账户/API Key](https://fred.stlouisfed.org/docs/api/api_key.html)，官方说明每个应用/使用者对应自身 Key。本 lane 不调用已有用户 Key。 | [条款](https://fred.stlouisfed.org/docs/api/terms_of_use.html)要求注明非联储背书，并遵守第三方系列权利。原始观测日不等于发布日期；最新修订值不等于历史可得值。不存在一条对所有系列都可靠的“默认当天 00:00 可用”。 | **增强现有 FRED。** 补原始发布链接、修订版本与单位，避免重复新建宏观插件。 |
| **BLS 原始发布、时间序列及日历** | CPI/就业内部结构、统计口径、发布时点、官方事件日程 | [官方日历](https://www.bls.gov/schedule/news_release/)、[API FAQ](https://www.bls.gov/developers/api_faqs.htm)、[v2 参数](https://www.bls.gov/developers/api_signature_v2.htm)。 | 公开数据免费；v1 无注册，v2 需免费注册且每年续期。官方当前每日查询上限分别 25 / 500。 | 日历是网页发布，不是 FMP/FRED Key 解锁的服务。API 时间序列、发布正文、日历分别有不同职责；403/网络错误不能解释成“没有事件”。 | **作为原发布核验入口。** 已有 FRED 系列不应再次算一份独立经济证据。 |
| **费城联储 SPF** | 专业预测者对增长/通胀/利率的预期水平、分歧、概率与历史预测误差 | [SPF 总页](https://www.philadelphiafed.org/surveys-and-data/real-time-data-research/survey-of-professional-forecasters)、[变量目录](https://www.philadelphiafed.org/surveys-and-data/data-files)、[CPI 下载页](https://www.philadelphiafed.org/surveys-and-data/cpi-spf)：Excel，含均值/中位数/个体匿名回答/离散程度。 | 免费公开下载，无 Key、无账户；CPI 中位数 Excel 已匿名实测。 | 季度调查，不能代替本周 CPI 一致预期或实时交易定价。必须保留调查批次、目标期间、季调及年化口径；不能把预测当作观测。官方会发布勘误。 | **优先新增数据能力。** 给观点/预期分析提供独立于价格的输入。 |
| **纽约联储 Survey of Market Expectations** | 交易商与活跃机构对政策路径、缩表和经济指标的分布预期 | [官方页](https://www.newyorkfed.org/markets/market-intelligence/survey-of-market-expectations)：问卷、结果 PDF、数据下载；2025 年起旧 PD/MP 调查合并。 | 公开材料免费；无统一 Key 要求；本次核实网页与发布说明，未逐份读取工作簿。 | 问卷约会前两周发布，结果通常在会议后三周发布；不能把尚未发布结果“推算成共识”，也不能把不同样本调查直接拼接而不标变化。 | **第二批补充。** 与 SPF 的样本、频率和问题互补。 |
| **CFTC COT 分解期货持仓** | 黄金/商品投机与商业仓位结构、拥挤程度、仓位变化，而非“机构知道什么” | [COT 文档与 FAQ](https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm)、[PRE](https://publicreporting.cftc.gov/stories/s/r4w3-av2u)、[官方数据集元数据](https://publicreporting.cftc.gov/api/views/72hh-3qpy.json)。`72hh-3qpy` 为 Disaggregated Futures Only，Socrata JSON/CSV。 | 公开免费。CFTC FAQ 明确目前不发 API token，适度使用可无 token；本次匿名 JSON 成功。 | 周频、通常周五公布周二仓位，假日另看日程；保留 as-of 与公开时间。期货-only 与期货+期权不可相加；分类不等于单一动机或胜率。 | **优先新增原子获取能力。** 可为 institutional-analysis 提供真正仓位证据，避免用 K 线猜机构行为。 |
| **SPDR GLD 发行人历史数据** | 单只实物黄金 ETF 持有量/份额/NAV 的变化 | [GLD 官方数据页](https://www.spdrgoldshares.com/usa/gld/)，页面公开链接至[历史 Excel 下载](https://api.spdrgoldshares.com/api/v1/historical-archive?exchange=NYSE&lang=en&product=gld)。 | 匿名下载实测 HTTP 200，无 Key；文件约 542 KB。 | [条款](https://www.spdrgoldshares.com/terms-and-conditions/)限个人非商业使用，商业处理/再分发需适用授权。仅一只基金不代表全球 ETF；持有量变化不直接等于投资者资金流，AUM 还受金价影响。 | **有价值但有条件。** 个人研究下载/用户提供材料可用；默认商业集成先落实授权，不能只因下载成功就标可商用。 |
| **WGC Goldhub / Gold Demand Trends** | 全球黄金 ETF、央行、珠宝和实物需求，以及各区域投资需求 | [ETF 数据与研究](https://www.gold.org/goldhub/data/global-gold-backed-etf-holdings-and-flows)，HTML/PDF/Excel。 | 页面称免费注册后可阅读评论并下载文件。本次页面可读，方法 PDF 直接请求返回 403。 | [条款](https://www.gold.org/terms-and-conditions)明确限制 scraping、商业使用和部分第三方数据再分发；未找到可据以直接开放的公共 API 合同。评论与其引用的 CFTC/基金披露不能重复计为独立证据。 | **授权/用户文件补充。** 不列为当前无配置默认依赖；不能因为某次可抓就承诺稳定自动化。 |
| **EIA 行业原始数据** | 能源供需、库存、产能、炼厂利用率；成本冲击和行业机制的核验 | [Open Data](https://www.eia.gov/opendata/)：API v2、公开报表、批量文件、RSS；有原始值，也有 STEO/AEO 预测。 | 官方说明免费；API 注册 Key，批量文件公开。未注册、未用用户 Key 测其 API。 | 数据/预测必须标明类型与 vintage；[API 条款与版权入口](https://www.eia.gov/opendata/)可在页面找到；来源含第三方时按相应条件。能源行业资料不能直接充当苹果产品需求证据。 | **按行业启用。** 比再加通用新闻情绪源更有解释增量。 |
| **官方事件原文与 RSS：Fed、公司、监管机关** | 谁在何时宣布什么，事件对某业务/利率渠道有何影响 | [Fed RSS 目录](https://www.federalreserve.gov/feeds/feeds.htm)、[货币政策 RSS](https://www.federalreserve.gov/feeds/press_monetary.xml)、[Apple Newsroom RSS/Atom](https://www.apple.com/newsroom/rss-feed.rss)。 | 这两个 feed 已匿名实测，无 Key；公开读取。RSS 链接不自动授予站内所有媒体内容的再分发权。 | RSS 可能只给标题/摘要，应继续获取原文并保留全文覆盖状况；公司自发新闻有选择性，不能证明不存在负面事件；事件发生日、发布时间、抓取时间要区别。 | **立即可复用现有 RSS + 网页解析层。** 原文读不完整应报告缺口，不能凭摘要补造全文。 |
| **专业新闻、公司一致预期：商业服务候选** | 外部调查/突发新闻、分析师盈利预期与修正，补发行人材料的偏向 | [LSEG News](https://www.lseg.com/en/data-catalogue/news)、[公司数据与 I/B/E/S、Transcripts 目录](https://www.lseg.com/en/data-catalogue/company-data)；官方支持平台/API 等渠道。 | 商业授权、按合同/数据范围询价；本次未询价、未订阅、未调用。不能用供应商广告当从业效果证据。 | 正文、历史库、非展示分析、模型处理及再分发可能是不同权利；必须核对订阅实际覆盖。此类一致预期无法用公司指引、SPF 或 Reddit 发帖替代。 | **可选增强，不做免费工作流的默认硬依赖。** 先让现有已付费来源证明覆盖；402 是套餐缺口，不是“市场没有新闻”。 |
| **CME 交易所行情/持仓/合约资料** | 指定期货合约的结算、成交、OI、期限结构与交割规则 | [数据接入入口](https://www.cmegroup.com/market-data/connect-data.html)、[API 入门](https://www.cmegroup.com/tools-information/webhelp/data-services-portal/Content/GettingStarted.html)。 | 行情 API、历史数据及分发按产品/合同付费或授权；无账户实测。公开合约资料与商业行情 feed 应分开。 | [政策中心](https://www.cmegroup.com/market-data/license-data/market-data-policy-education-center.html)区分非展示计算、历史分发、AI 使用；延时行情不等于免授权。CFTC 的跨期限周度总仓位不能代替当日期货盘口/OI。 | **有明确研究需求和订阅才接。** 不靠抓网页隐藏接口充当正式 API。 |

## 3. 本次真正验证过的访问情况

这些结果是单次有限样本，不是可用性 SLA，也不代表所有标的或历史区间都能读取。以下测试未保存外部全文副本。

| 入口 | 检查方式及结果 | 可以据此确认 / 不能确认 |
| --- | --- | --- |
| CFTC `api/views/72hh-3qpy.json` | 匿名 GET 200，约 330 KB；数据集名确认为 `Disaggregated - Futures Only`，字段包括报告日、合约市场码、总 OI、Managed Money 多空仓位。 | 确认官方数据集和字段。不是仅从第三方博客抄一个 ID。 |
| CFTC `resource/72hh-3qpy.json` | 匿名查询 `cftc_contract_market_code='088691'`，按报告日倒序、只取一条，200，261 bytes；返回 `GOLD - COMMODITY EXCHANGE INC.`，报告日 2026-10-13。 | 确认可获取 COMEX 黄金真实分类仓位。`00:00` 格式是报告日期表示，不是已确认的发布时刻。 |
| Fed `feeds/press_monetary.xml` | 匿名 GET 200，9,687 bytes，XML 解析得到 15 条 item；所见最新 pubDate 为 2026-10-13 18:00 UTC。 | 确认官方 feed 能被程序读取。未据此声称所有事件正文都解析成功。 |
| SPF CPI `Median_CPI_Level.xlsx` | 从官方 CPI 页面提取真实下载链接；匿名 GET 200，16,807 bytes，验证 XLSX ZIP 与工作表 `Median_Level`。 | 确认工作簿可获取、格式有效；未声称完成全部变量的数值口径校验。 |
| GLD `historical-archive?exchange=NYSE&lang=en&product=gld` | 来自官方页面 Download；匿名 GET 200，541,817 bytes，正确 XLSX 类型/ZIP 头。 | 确认下载可达，未逐行核算持有量或推导资金流，也未取得商业授权。 |
| Apple `newsroom/rss-feed.rss` | 匿名 GET 200，18,817 bytes；虽扩展名 RSS，内容为 Atom feed。 | 确认解析层应兼容 Atom，不能只接受 RSS 2.0；未证明新闻覆盖完整。 |
| WGC ETF 方法 PDF | 官方页面链接 `download/file/16223/ETF-Flows-Data-Methodology.pdf` 的 web 读取返回 403。 | 明确记录访问受限，不通过换域名/伪造登录绕过；不声称已读完整方法文档。 |
| SEC / FRED / BLS / EIA | 核对官方接口和配置文档；本 lane 未使用真实联系人/现有用户 Key 发数据调用。 | 这些行是文档核查，不算本次 API 冒烟通过。BLS 日历网页本次可读，不推断任何环境永不 403。 |

SPF 抽样下载的[完整原始链接](https://www.philadelphiafed.org/-/media/FRBP/Assets/Surveys-And-Data/survey-of-professional-forecasters/data-files/files/Median_CPI_Level.xlsx?sc_lang=en&hash=33EB44A05F94755784AAA8D7E71AD1DB)。应从其变量页刷新下载链接，避免把今天的站点 hash 当永久版本标识。

### 可直接写入现有获取能力说明的用法

| 来源 | 既有获取能力可使用的输入 | 需要明确写出的条件 |
| --- | --- | --- |
| Fed 货币政策公告 | URL：[press_monetary.xml](https://www.federalreserve.gov/feeds/press_monetary.xml)，解析 RSS 条目的标题、链接、pubDate；正文另按链接读取。 | [官方目录](https://www.federalreserve.gov/feeds/feeds.htm)主动提供订阅；不需要 Key。[网站政策](https://www.federalreserve.gov/website-linking-policies.htm)禁止破坏服务和绕过防护，外链内容权利归原站。本次未找到数值速率/SLA承诺。 |
| CFTC 黄金分解持仓 | URL 模板：`https://publicreporting.cftc.gov/resource/72hh-3qpy.json`；query：`$where=cftc_contract_market_code='088691'`、`$order=report_date_as_yyyy_mm_dd DESC`、`$limit=1`，可用 `$select` 限定所需字段。 | [COT FAQ](https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm)明确允许适度 tokenless API；[Web Policy](https://www.cftc.gov/WebPolicy/index.htm)说明政府信息是 public domain，可复制分发并请注明来源，第三方材料另论。保留合约码、报告类别、单位与报告日。 |
| SPF 通胀预期 | 获取 [CPI 变量页](https://www.philadelphiafed.org/surveys-and-data/cpi-spf) 中 Median / Mean / Dispersion 等明确的 XLSX 链接，交文件解析层读取。 | 官方主动提供数据文件，无 Key；这是可下载文件，不应谎称有稳定公共查询 API。调查日期、预测期限和年化口径随结果一起交付；未查到数值速率/SLA承诺。 |
| Apple 官方事件 feed | URL：[rss-feed.rss](https://www.apple.com/newsroom/rss-feed.rss)，按 Atom 而非强制 RSS 2.0 解析。 | [Apple 官方 RSS 页](https://www.apple.com/au/rss/)明确提供订阅；[站点条款](https://www.apple.com/legal/internet-services/terms/site.html)限制未主动提供途径的自动抓取及商业转载。公开 feed 的用法不扩大为整站商业全文抓取许可。 |
| SEC 披露 | CIK 左补零至 10 位；使用已注册获取能力的 SEC 请求身份配置访问 submissions/companyfacts；由 submissions 中的真实 accession/文件名读取正文。 | [官方 API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)无需 Key；[官方请求要求](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)为声明应用与联系人 User-Agent、当前最高 10 req/s。不要让 Agent 随机编邮箱或反复换 UA。 |
| Microsoft 电话会原文 | [FY26 Q4 官方页面](https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q4)是实际可读的来源实例，保留发言人和 Q&A。 | [Microsoft Documents 条款](https://www.microsoft.com/en-us/legal/terms-of-use)对文档使用设个人/非商业等条件。本次未核实商业全文采集授权，不标成默认商业电话会数据库。 |

## 4. 对当前插件的最小补充建议

这是现有能力的用法与数据覆盖补充建议，没有在本 lane 修改或注册任何能力。优先把来源入口、参数、配置、解析方式和交接信息写入已有获取能力说明，不为这些例子另建重复抓取工具。

| 优先级 | 补什么 | 自身责任 | 交给分析方法/工作流的部分 |
| --- | --- | --- | --- |
| P0 | 补齐已有 SEC/财报获取 | 明确 symbol/CIK、表单和报告期间；读取 filings、附件和 XBRL；给完整性、版本、单位与引用。配置联系标识与能力绑定。 | 盈利质量、TTM、分部分析和估值；不替研究员决定“买/卖”，不另建最终报告。 |
| P0 | 在现有获取能力中补 CFTC 用法 | 按报告类型、市场码、日期返回同口径分类仓位、OI、日期；写清单位和更新时间。 | 拥挤程度、与价格/ETF 的因果解释和反证；不内置“净多越大越利好”。 |
| P0 | 在现有获取/文件解析能力中补 SPF 用法 | 返回调查批次、变量、目标期、统计方式及原工作簿引用；既有解析层可读中位数和分歧。 | 比较预期变化、识别预期与实际偏差；不把所有研究都强制纳入 SPF。 |
| P0 | 配置官方事件源，并补稳定全文解析 | 复用 RSS/网页/文件解析层；输出官方链接、标题、发布日期、正文或明确缺失范围；支持 Atom、表格、长文分页。 | 事件关联、叙事变化、估值渠道；不把取回十篇文章当成十份独立证据。 |
| P0 | 增强现有 FRED 的元数据/vintage | 保留原发布机构、版本与观测单位；明确精确可得时间已知还是未知。 | 宏观情景和历史检验；不能为了让方法校验通过而伪造 UTC 可得时刻。 |
| P1 | EIA、NY Fed SME、授权 ETF 数据 | 按研究标的和实际授权选择性启用；不因其他插件存在就全部强制加载。 | 行业机制、政策预期与资金行为的综合。 |
| 按需 | 付费新闻/个股一致预期/交易所数据 | 通过实际套餐和 API 样本证明可用；能力列出支持市场、历史范围、费用依赖和失败原因。 | 工作流只有确需此信息才要求依赖；已有证据能回答的问题继续处理，缺失不能编造。 |

依靠现有通用获取/解析插件承载这些来源即可；不建议每个网站都再做一个“完整投资研究 Agent”。CFTC 的查询参数、SPF 的下载入口与口径要在说明中明确；公司 IR、公告与研究 PDF 优先完善通用解析和来源配置。只有已有接口确实无法表达必要功能，才单独评估新的专用能力。

## 5. 组合时最容易出错的边界

- **公司披露、第三方评论、调查预期、市场价格、持仓是不同类别。** 发行人指引是管理层预期；SPF 是专业预测者调查；市场盈亏平衡通胀含风险/流动性因素；三者不可混标为一个“市场共识”。
- **同源材料要复用。** SEC 附件、公司新闻稿、FMP 转述与新闻转载可能来自同一次披露；WGC 引用 CFTC 后也不生成第二份独立仓位证据。
- **时间和版本属于信息本身。** 报告期、发布时间、首次可得时间、抓取时间、修订版本分别记录；未知就保持未知。描述性研究可以使用口径有限的数据并说明限制，历史回测或事件归因则需要对应的时点证据。
- **社区只负责发现问题和材料。** 发帖活跃度既不是投资人资金权重，也不是整个市场的预期分布。社区指南中的老链接要复核，单篇帖子不升级为规则。
- **预测提供可检验的参照，不提供保证。** [纽约联储 Staff Report 1025](https://www.newyorkfed.org/research/staff_reports/sr1025)（2022-07，2024-08 修订）用 SPF 密度预测研究不确定性与准确性，发现两者关系随预测期限变化。这支持保存期限与误差历史，不支持把专家预测当事实。
- **缺的是信息就补信息，缺的是处理能力就补处理能力。** 本轮真实研究曾出现已抓到正文但 Agent 只能读截断预览、财报接口只有年度口径的问题；再添加价格指标或模型角色不会填补这些缺口。

第一批最有把握的新增免费输入是 **CFTC 分类仓位 + SPF 预期**；已有能力优先补 **SEC 季度/附注、FRED vintage、官方 RSS 到完整正文的读取**。GLD/WGC 能补黄金需求，但授权和单基金覆盖边界需要写进能力说明。个股一致预期与完整专业新闻仍是独立缺口，本次没有找到可以证明同时免费、稳定、覆盖广且允许产品自动化使用的统一替代品。
