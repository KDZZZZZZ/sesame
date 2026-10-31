# AAPL 真实数据测试预检（2026-10-18）

本轮只读检查源码和现有配置，做了低成本官方 HTTP 连通性与解析检查；未调用模型、交易接口或修改真实用户配置。FMP 共 8 次只读请求（原先5项 + quote/ratios/DCF），FRED 1 次；新闻被套餐拒绝后未重试。所有日志仅保存脱敏状态、字段名、日期和公开 URL，无凭据值。之前的临时凭据清理未触碰。

## 可直接开展的测试

选 AAPL 合适：同一标的已有可用日线、三张财务报表；Apple 官方发布与 SEC 10-Q 可完整读取，FRED 宏观可用。新闻切换仍按主线程与用户的来源授权处理。建议研究问题为：AAPL 未来 2–6 周的上涨假设，能否获得盈利质量、产品催化与宏观环境的互补支持，哪些证据会推翻假设；各角色独立选择与自身问题对应的方法，不用所有角色重复市场指标。测试不创建订单。

## 现有配置与隔离注入

| 位置 / 键 | 状态 | 含义 |
| --- | --- | --- |
| `%APPDATA%/Sesame/workspace/app.sqlite`，`entities(kind='secret',id='application-environment').body.entries.FMP_API_KEY` | 有值 | FMP 查询使用 |
| 同记录 `FRED_API_KEY` | 有值 | FRED 查询使用 |
| 同记录 `SEC_USER_AGENT` | 无值 | financial-research 的 SEC provider 当前缺此依赖 |
| `TAVILY_API_KEY` | 宿主记录、当前测试进程均无值 | 当前公用源码及已安装插件无 Tavily 注册能力 |
| `REDDIT_ACCESS_TOKEN` / `REDDIT_USER_AGENT` | 无值 | Reddit provider 当前不可用 |
| `%APPDATA%/Sesame/workspace/plugins/data/sesame/financial-research/execution.sqlite`，`records(collection='research_config',id='default').value.values` | 存在，五项名称映射均为默认 | 只保存环境变量名，不保存密钥值 |
| `%APPDATA%/Sesame/workspace/app.sqlite`，`settings/model` | `openai / gpt-6.1-sol` | 只核对选择，未发模型请求 |

宿主 `modules/agent/configuration-service.js:24–33` 读取私有 secret 记录；`Runtime.init()` 在启动插件前恢复到 `process.env`。financial-research `createService(..., {env=process.env})` 每次从映射名称读值。

给隔离 Runtime 注入的最小方式：在可信测试启动器中使用只读 SQLite 连接，内存读取上述两项；仅将 `FMP_API_KEY`、`FRED_API_KEY` 放入独立子进程 `env`。测试 Runtime 使用全新的 dataDir/piDir/插件存储；不要对原数据库构造可写 Store，不需要复制原数据库或调用 configure。名称映射当前为默认，无需迁移插件数据库。不得把 env、请求 URL（含 apikey）或原始错误对象写入日志。这里的私有存储依靠宿主访问边界与文件 ACL，并非源码显示的加密数据库。

## 实际注册入口

普通 Agent 工具可直接使用下表名称；统一入口形状为：

```js
host_capabilities_invoke({
  id: 'sesame/financial-research#financial_research_query',
  input: { kind: 'fundamentals', provider: 'fmp', symbol: 'AAPL', statement: 'income', limit: 3 }
})
```

| 能力 | 可执行输入示例 | 实际边界 |
| --- | --- | --- |
| `financial_research_status` | `{}` | 只说明配置存在，不证明网络 / 套餐 |
| `financial_research_query` 日线 | `{kind:'prices',provider:'fmp',symbol:'AAPL',start:'2026-06-01',end:'2026-10-16',limit:100}` | 日线研究数据，最多保存100行；不是可交易报价 |
| 同能力三表 | `{kind:'fundamentals',provider:'fmp',symbol:'AAPL',statement:'income',limit:3}`，statement可选 `balance/cashflow` | 当前接口不支持 period，供应商默认年度；不能当成最新季报或 TTM |
| 同能力新闻 | `{kind:'news',provider:'fmp',symbol:'AAPL',limit:3}` | 真实返回 HTTP402；插件会返回 `source_unavailable/SOURCE_HTTP_402`，不是“零新闻” |
| 同能力宏观 | `{kind:'macro',provider:'fred',series_id:'DGS10',limit:60}` | FRED observations；不是未来事件日历，不附具体发布时间和单位元数据 |
| 同能力 SEC | `{kind:'filings',provider:'sec',cik:'320193',limit:10}` 或 `kind:'fundamentals',statement:'companyfacts'` | 需 SEC_USER_AGENT；无 symbol->cik 必需查表，显式 CIK 可减少请求 |
| `financial_research_read` | `{dataset_id:<真实返回ID>,offset:0,limit:100}` | 复用已保存数据，不联网；不能读取 query 未保存的第101行 |
| `data_query` | `{source:result.evidence.source,input:result.evidence.query}` | 取得对应快照完整未截断行及血缘，不重抓 |
| `data_read` | `{ref:result.ref}` | 宿主将完整固定数据写入所返回的工作区路径 |
| `sources_fetch` | `{url:'https://www.apple.com/newsroom/rss-feed.rss'}` | 没有 API Key 或自定义鉴权参数；2MiB/30s/3次重定向；text最多20000字符，其余在ref |
| `parse_feed` | `{xml_content:<完整RSS文本>,max_entries:20}` | rss-collect，解析源文本；返回条目、日期和链接，摘要不等于文章全文 |
| `extract_webpage` | `{html_content:<完整HTML>}` | web-extract，不执行 JS；返回 title/text/links；source仍为inline，应保留调用者原 URL/ref |

查询和读取允许 agent/host；`financial_research_configure` 仅主会话，可传 `credentials:{fmp_api_key?,fred_api_key?,sec_user_agent?,reddit_access_token?,reddit_user_agent?}`，调用宿主 configuration.update 私有持久化。本次隔离测试已有内存注入，无需配置写操作。源查询副作用仅网络、发布证据、插件私有状态；没有交易能力。

当前 `kind` 仅 prices/fundamentals/news/filings/analyst/insiders/macro/sentiment。quote、ratios、DCF 尚未注册，虽然供应商接口可访问，Agent 不应虚构这些 kind，也不应把含密钥 URL 传给 sources_fetch。

## 真实连通性

| 请求 | 结果 | 有效覆盖 |
| --- | --- | --- |
| AAPL non-split-adjusted 日线，10月1–16日 | 200，12行 | 最新2026-10-16；字段 adjOpen/adjHigh/adjLow/adjClose/volume |
| AAPL income / balance / cashflow | 均200，各3行 | FY2025/FY2024/FY2023；最新报告期2025-09-27、披露2025-10-31 |
| AAPL stock-news | 402，套餐限制 | 不重试，不解释为无新闻 |
| FRED DGS10 | 200，5行 | 最新观测日2026-10-15；观测日期不等于发布日期 |
| AAPL quote | 200，1行 | API可用，但插件当前未注册 |
| AAPL ratios | 200，1行 | FY2025财务比率；不是最新TTM；插件未注册 |
| AAPL discounted-cash-flow | 200，1行 | 上游供应商模型输出，不能当作事实或本地估值方法的结果；插件未注册 |
| Apple Newsroom Atom feed | 200，20条，18746字符 | rss-collect实际解析成功 |
| 最新 Apple 条目正文 | 200，235593字符 | web-extract实际得到35044字符正文 |
| SEC submissions CIK0000320193 | 200，163690字符 | 最新10-Q：2026-07-31公布，报告期2026-06-27 |
| 对应10-Q HTML | 200，1018681字符 | web-extract实际得到94945字符正文，未超2MiB |

官方 URL：

- https://www.apple.com/newsroom/rss-feed.rss
- https://data.sec.gov/submissions/CIK0000320193.json
- https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm

当前 FMP key 的套餐名称没有被 API 返回；只能确认上述具体端点的真实准入。官方公开 Free 方案列250请求/日、500MB/滚动30天，并有端点、标的、历史范围限制；不可把key存在理解成全部能力可用。参见 [FMP价格页](https://site.financialmodelingprep.com/pricing-plans) 与 [官方FAQ](https://site.financialmodelingprep.com/faqs?code=platform)。FRED需各用户自己的key，参见[官方API Key说明](https://fred.stlouisfed.org/docs/api/api_key.html)；本轮成功，未探测限流阈值。

## 行情交给方法的真实形状与缺口

financial-research没有扁平化字段；标准化行实际是：

```js
{
  data: {symbol:'AAPL',date:'2026-10-16',adjOpen:/*number*/,adjHigh:/*number*/,adjLow:/*number*/,adjClose:/*number*/,volume:/*number*/},
  source_url: /*不含apikey的URL*/,
  observed_at: '2026-10-16',
  available_at: null,
  availability: 'unknown',
  content_available_at: /*本次抓取时间*/,
  retrieved_at: /*本次抓取时间*/
}
```

顶层返回 `{status,provider,kind,dataset_id,raw_dataset_id,evidence,raw_evidence,ref,raw_ref,rows,total,offset,next_offset,presentation_truncated,retrieved_at,sources,coverage,warnings}`。FMP单页覆盖固有limited，成功有数据仍可能status=partial。财报同样在data下；acceptedDate缺时区时available_at为null，保留原字段而不臆造时间。

- 当前研究省略 as_of；FMP历史as_of只复用此前保存快照。全新隔离库带as_of会直接得到HISTORICAL_SNAPSHOT_UNAVAILABLE。start/end才是观测日期窗口。
- 方法转换应取 rows[].data，按 date 升序，映射 adjOpen/adjHigh/adjLow/adjClose 为 OHLC，保留原字段、原引用、日期粒度与抓取可见性。FMP官方确认该端点是不做拆股调整；不能因为adj前缀而称复权，参见[官方非拆股调整日线说明](https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-non-split-adjusted)。
- ABU方法需要数值OHLCV、严格递增规范UTC时间、available_at≤as_of。FMP仅提供日期，不能宣称有交易所精确时间。若转换使用明确披露的日期边界，须把所用时间解释与限制写进source；当前可见性最多证明本次取得内容，不证明当时已知。
- price-action等市场Bar方法还要求 SourceTime、id/revision、is_closed/closure、量单位等真实市场字段。FMP不是已注册 sesame.market/1 provider，不能凭空伪造这些字段以通过校验。接口层如需自动桥接应单独实现真实转换，当前没有直接DataRef->Bar适配能力。
- 单次最多100行是保存范围，不只是预览。只有方法确实需要更长历史时才用不重叠日期区间取证；否则使用已有样本并说明指标窗口。
- 估值目前可由已注册财报与日线进行有日期标记的计算；年度EPS/FCF不应被写成TTM。需要最新季报时，读取已获来源授权的SEC原文。

## AKShare / CCXT 边界

AKShare不是“AKShare上游所有API”：当前白名单仅7项A股代码/快照/日线接口，无法查美股AAPL。无需API Key，需本机Python和固定AKShare1.19.1；discover/status会保存插件私有环境选择，本轮未调用。CCXT仅Kraken/Coinbase/OKX公开加密现货，无API Key/下单；也无法提供AAPL。两者不能承担本次缺失的美股新闻/基本面/行情。

## 脱敏证据文件

- real-data-preflight-20261018.json
- fmp-quote-valuation-preflight.json
- official-news-source-preflight.json
- official-news-parser-preflight.json
