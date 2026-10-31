# 搜索与来源

本类负责发现、取得和解析证据。研究方法由调用者选取，Report 负责呈现固定结果。用户指定的服务、来源范围及调整优先。

| 插件 | 输入 → 结果 | 边界 |
| --- | --- | --- |
| web-sources | sources_search 关键词 → 候选链接；sources_fetch URL → 完整原始字节与固定 ref | 搜索摘要不是原文；无自动订阅后台或全网历史库 |
| rss-collect | parse_feed({source_ref}) → 有限 RSS/Atom 条目 | 不联网，不获取每篇全文，不推断市场影响 |
| web-extract | extract_webpage({source_ref}) → 标题、正文与链接 | 不联网、不执行 JS；导航/横幅可能残留；不解析链接里的 PDF |
| financial-research | 具体 provider/kind → 固定金融、公告、宏观、持仓或讨论证据 | 配置只约束使用它的来源；不从数据缺失推导市场结论 |

## 按问题取证

已有合用固定 ref 时复用。已知可靠入口时直接抓取；未知网址或需要补充覆盖时才搜索。例如：

`sources_search({query:"FOMC statement",site:"federalreserve.gov",time_range:"month",limit:5})`

先检查 status。选中候选后 `sources_fetch({url:result.url})`，再将固定 ref 交给对应解析器。搜索页 ref 证明本次看到这些候选，原文 ref 才是所选文章证据。搜索排名不代表可靠性或影响大小；多个转载也不构成多个独立事实。

DuckDuckGo Lite 是公开非 JavaScript 网页入口，不是稳定的商业搜索 API。无需账号或 Key；请求遵循宿主网络设置，受 2 MiB、30 秒和重定向限制。只取首页。明确拒绝、验证码、限流或结构变化返回 unavailable；不反复尝试，不规避限制，也不自动切换到收费服务。时间窗口只是搜索条件，每条 published_at 保持 null，直到从原始来源取得明确日期。

## 首批官方入口

以下是按问题选择的候选入口，不是必须依次调用的清单。HTTP 成功只证明本次内容可取，feed 可能仅覆盖最近几条。

| 资料 | 获取方式 | 解释边界 |
| --- | --- | --- |
| Fed 货币政策公告 | sources_fetch: https://www.federalreserve.gov/feeds/press_monetary.xml → parse_feed | 条目保留原始发布时间；全文另取链接，PDF 需要相应解析能力 |
| Fed 演讲与证词 | sources_fetch: https://www.federalreserve.gov/feeds/speeches_and_testimony.xml → parse_feed | 发言文本与市场反应分别取证 |
| BLS 最新指标入口 | sources_fetch: https://www.bls.gov/feed/bls_latest.rss → parse_feed | 当前 feed 不是完整发布日历或历史事件库，不含市场预期 |
| Census 指标消息 | sources_fetch: https://www.census.gov/economic-indicators/indicator.xml → parse_feed | 明确观测期、公布时间与修订；不可把时期当发布时间 |
| CFTC 分类持仓 | financial_research_query({kind:"cot",market_code:"088691",limit:12}) | 无 Key；观测日不等于发布日；合约数不等于实时资金流 |
| SEC 公告/财报 | financial-research 的 SEC 分支 | 统一配置 sec_user_agent；版本可知性需按原来源判断 |
| FRED 宏观序列 | financial-research 的 macro 分支 | 统一配置 fred_api_key；宏观观测不是新闻原文或市场预期 |

无需配置的公开来源优先，其次免费但需要配置的来源。缺字段按具体来源能力说明，不把任意网页摘要填入结构化共识、期权链或历史可用时点。不同来源并不自动等价。

## 证据与历史结果交接

内部保留：原 URL、完整 ref、内容 hash、published_at、first_available_at（有依据才填）、retrieved_at、版本/修订信息和实际覆盖。三种时间不同，今天取得的旧文章不能证明今天的版本当时已知。

对历史情景，方法层先说明所选特征、匹配条件、同一品种近期的搜索范围及缺口；需要扩展其他品种时保留原因与可比性。行情结果使用固定市场数据、明确价格时间含义与结果窗口。重叠事件、重复报道和多窗口统计要保留依赖关系，不能当作独立样本累加。

历史结果对齐能力只提供实际价格变化与基准差异；特征定义、理论解释、匹配与概率校准继续由选定分析方法负责。样本不足、时间可知性不明或缺少独立检验时保留该限制，不生成主观置信度。

报告正文按需保留判断、帮助读图的注解、简短推理和历史参照。内部来源类型、插件路由和字段获得方式无需逐项展示；必要来源仍可追溯。
