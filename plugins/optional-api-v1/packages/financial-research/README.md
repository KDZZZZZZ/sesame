# 金融研究工具

`sesame/financial-research` 是 Sesame 0.2.2+ 的独立可选插件。主会话和子 Agent 共用查询、证据保存及读取接口；只有修改数据源配置需要主会话。插件只读取研究数据，交易执行由 `manual-trading` 及账户后端负责。

| kind | 默认来源 | 内容 |
| --- | --- | --- |
| prices | FMP | 未复权日线 OHLC、成交量；可供报告绘图，不能用作可执行报价 |
| fundamentals | SEC | 带申报日期及 accession 的 company facts；指定 `statement: income/balance/cashflow` 时使用 FMP 财报 |
| news | FMP | 指定股票新闻标题、摘要及原文链接 |
| filings | SEC | 最新及有界历史申报元数据、原始文件链接 |
| analyst | FMP | 分析师评级变化样本 |
| insiders | FMP | 内部人交易申报样本 |
| macro | FRED | 指定 series_id 的宏观观测；支持 vintage |
| sentiment | Reddit OAuth API | stocks / investing / wallstreetbets 的指定股票讨论样本，保留样本局限，不生成伪情绪分数 |

工具为 `financial_research_status`、`financial_research_configure`、`financial_research_query`、`financial_research_read`。查询需要 `kind`，股票查询还需要 `symbol`，SEC 也可使用 `cik`，宏观查询需要 `series_id`；可选日期 `start` / `end`、知识时点 `as_of`、`limit`（1–100）。`metric` 可指定 SEC 概念，例如 `us-gaap:Assets`。默认 SEC 基本面为一组常用概念，可逐概念补查。

在运行 Sesame 的进程环境中提供以下变量。配置工具只保存变量名引用；可用 `fmp_key_env` 等参数改成已有环境变量的名称，绝不要在工具参数里传密钥值。

| 默认环境变量 | 用途 |
| --- | --- |
| FMP_API_KEY | FMP key；数据访问取决于其套餐与端点权限 |
| FRED_API_KEY | FRED key |
| SEC_USER_AGENT | SEC 要求的真实应用及联系信息，例如 `YourApp contact@example.com` |
| REDDIT_ACCESS_TOKEN | 已获授权的 Reddit OAuth access token；插件不自行申请或刷新 token |
| REDDIT_USER_AGENT | Reddit 要求的应用身份 user-agent |

配置、查询结果及错误不返回密钥值。只向固定官方域名发起 GET 请求，不跟随重定向；单请求 15 秒超时，普通响应 2 MiB、SEC 响应 16 MiB 上限，SEC 请求间隔至少 210 ms。429、过期 token、缺少配置或套餐权限明确返回 `source_unavailable`，不会以空结果代替成功。证据源文本不能改变 Agent 指令。

每次成功查询保存两个公开可读的数据集：规范化 `dataset_id` 与对应原始记录 `raw_dataset_id`。原始记录指查询选中且通过时点筛选的源记录，保留数字及原始字符串，剔除密钥；它不是完整响应归档。来源元数据另保留完整响应字节的 SHA-256、获取时间及去掉密钥的请求 URL。查询和读取最多展示有界页面，使用 `next_offset` 继续读取，完整记录仍保存在数据集中。超长文字的展示缩短会显式标注。用户和 Agent 看到同一份证据。

当前研究省略 `as_of`。`observed_at` 是记录对应的观测日期，`available_at` 是可确认的源发布时间或保守日期上界，`content_available_at` 是本版本可用性的上界，`retrieved_at` 是本机实际获取时间。这些时间不能互换。

- FMP / Reddit 会更新文章、财报、历史价格及讨论热度。历史 `as_of` 只读取在该时点前已保存的最新匹配快照；没有快照即返回 `HISTORICAL_SNAPSHOT_UNAVAILABLE`，不把今天抓到的旧新闻、重述财报或现有投票数当成过去已知的版本。
- SEC 历史查询要求 CIK，避免用今天的 ticker 映射证明过去公司身份。申报元数据以 acceptance timestamp 为准；只有日期时使用保守的日末上界。company facts 按独立 accession / filed 保留原始与修订申报并筛掉晚于 cutoff 的申报；它仍是今天的 SEC 提取结果，不能冒称历史 API 原始快照。历史元数据最多追加三个匹配申报文件，范围不完整会注明。
- FRED 历史查询显式设置 `realtime_start` / `realtime_end` 为已完整结束的 vintage 日期。使用跨时区的保守日末边界，不声称知道同一天某分钟的数据。缺失值 `.` 保持为缺失值。

这个版本覆盖上述来源的有界研究输入，没有自动下载公告全文、通用网页浏览、实时盘口、全球市场完整覆盖或商业数据访问权。研究 Agent 可以基于已保存价格数据使用现有报告图表能力。Rallies 的工具类别是设计参考，不表示其私有工具、模型行为或历史收益已被复现。引用与来源说明见 [PROVENANCE.md](PROVENANCE.md)。
