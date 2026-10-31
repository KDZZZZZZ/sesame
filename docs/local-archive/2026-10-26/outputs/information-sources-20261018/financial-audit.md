# financial-research 信息来源审计与修复

审计日期：2026-10-18。范围仅 `sesame/financial-research`，没有修改用户配置、发模型请求、交易、购买套餐或删除已有数据/插件；未改锁文件。

## 结果

**插件保留，已修复年报/季报选择缺失。** 旧接口不能传官方 `period`，导致真实研究只能取得年度三表，把本来可读的 FY2026 季度现金信息留成缺口。当前 key 的季度端点实际可访问，现已注册 `period:"annual"|"quarter"` 并完整传递到 FMP。三张季报通过公开注册能力真实返回 HTTP200，各得到 FY2026 Q3/Q2/Q1；年报路径仍可用。

第二项修复是状态诊断：`financial_research_status.sources[].last_checks` 记录各端点/报表周期最近一次准确 query、checked_at、status、reason、row_count。成功只证明该对象/参数在当时可用，不再让 Agent 仅凭 configured 推断整个供应商所有能力正常。历史复用不会刷新检查时间，状态查询也不发网络请求。

四份结构化预检共记录 **18 次只读 HTTP：17 次200、1次insiders402**，其中新增 FRED 元数据复测4次、CFTC注册能力1次。另有3次CFTC网络路径诊断单列如下，不混入该计数。已知 news/XLK/QQQ 的同日402没有重复请求。原17项回归通过；新增11项（FMP/状态4项、FRED3项、CFTC4项）先失败后修复通过，合计 **28/28通过、0跳过**；语法检查及本包 `git diff --check` 通过。

## 全部注册能力

| 能力 | 当前实现与实测 | 结论 |
|---|---|---|
| financial_research_status | 检查现有配置名称/有值状态；实际查询后返回带范围与时间的last_checks；不返回凭据 | 保留并改进 |
| financial_research_configure | 主会话调用宿主私有配置，保存名称映射；17项既有原生宿主回归覆盖保存、立即应用、权限和失败恢复。本轮没有改真实配置 | 保留；真实写配置未执行 |
| financial_research_query | 五provider、九kind；修复前服务实现实际取证，修复后7次查询走公开注册能力及宿主Run | 保留并补period、FRED元数据、CFTC |
| financial_research_read | 14份成功真实快照分别读取标准化/raw，共28次，均返回saved_evidence；公开入口另由回归验证 | 保留 |
| research_evidence_query | 对上述14份真实快照读取完整行，首行与read一致；不重复联网 | 保留 |
| research_dispose | 关闭隔离测试宿主自有数据库/资源，未删除用户资料 | 保留 |

## kind、端点与真实准入

| provider / kind | 官方固定端点 | 真实结果与覆盖 | 处置 |
|---|---|---|---|
| FMP / prices | `/stable/historical-price-eod/non-split-adjusted` | AAPL 10月1–16日：200、12行；研究日线，非可执行报价 | 保留 |
| FMP / fundamentals annual | `income-statement`、`balance-sheet-statement`、`cash-flow-statement` | 三表各200、3行FY2025/FY2024/FY2023；显式annual也200 | 保留 |
| FMP / fundamentals quarter | 同上，加 `period=quarter` | 三表经公开能力各200、3行：2026-06-27/Q3、2026-03-28/Q2、2025-12-27/Q1，均FY2026 | 已修复 |
| FMP / analyst | `/stable/grades` | 200，9月1日至10月18日选出15行；单一聚合来源标签，不是预测修订 | 保留 |
| FMP / insiders | `/stable/insider-trading/search` | 本轮首次测得402，实际访问/套餐限制，不重试 | 保留为受限来源；不是插件故障 |
| FMP / news | `/stable/news/stock` | 同日08:35 AAPL查询402，有冻结证据；本轮不重试 | 保留为受限来源；不宣称无新闻 |
| FRED / macro | `/fred/series/observations` + `/fred/series` | 新公开能力复测各200+200，当前11行、vintage10行；元数据确认Percent/Daily/Not Seasonally Adjusted；`.`缺失不转零 | 已增强并真实验证 |
| CFTC / cot | `/resource/72hh-3qpy.json` | 黄金088691，7月1日至10月16日，公开能力200；12期、每期194字段，最新报告日10月13日；partial为有界样本 | 已新增并真实验证 |
| SEC / filings | `/submissions/CIK{cik}.json` | 缺SEC_USER_AGENT；返回SOURCE_CREDENTIAL_MISSING，0次HTTP | 保留，配置真实身份后实网复测 |
| SEC / fundamentals companyfacts | `/api/xbrl/companyfacts/CIK{cik}.json` | 同上，缺配置；并非已验证不可用 | 保留 |
| Reddit / sentiment | `/r/{subreddit}/search` | 缺OAuth token及User-Agent；返回SOURCE_CREDENTIAL_MISSING，0次HTTP | 保留待真实授权验证 |

SEC/Reddit 的解析、历史边界和缺配置路径由离线回归覆盖，但不能称本轮实网通过。没有任何证据支持删除整个financial-research或上述未配置来源。

默认路由为：cot→CFTC、macro→FRED、sentiment→Reddit、filings→SEC；fundamentals未指定三表时→SEC，指定income/balance/cashflow时→FMP；其他支持项→FMP。FMP季度查询显式指定provider/statement最清楚：

```js
financial_research_query({
  kind: 'fundamentals', provider: 'fmp', symbol: 'AAPL',
  statement: 'cashflow', period: 'quarter', limit: 4
})
```

输出保留源fiscalYear、period和date；quarter不是TTM。原始披露时区/可用时刻未知仍为available_at:null；本次抓取时刻不能倒推历史已知。历史快照按年报/季报分别匹配，回归已验证不会相互替代。

## 配置与凭据处理

| 配置键 | 当前名称 | 是否有值 |
|---|---|---|
| fmp_key_env | FMP_API_KEY | 是 |
| fred_key_env | FRED_API_KEY | 是 |
| sec_user_agent_env | SEC_USER_AGENT | 否 |
| reddit_token_env | REDDIT_ACCESS_TOKEN | 否 |
| reddit_user_agent_env | REDDIT_USER_AGENT | 否 |

来源为 `%APPDATA%/Sesame/workspace/app.sqlite` 的 `entities(kind=secret,id=application-environment).body.entries`；映射来自 financial-research 私有 `execution.sqlite` 的 `research_config/default`。以只读SQLite读取，值只存在本次进程内并仅用于对应官方服务鉴权。未写到脚本、命令文本、报告或普通日志；输出序列化前检查不包含任何已加载凭据值。SEC需要真实应用及联系身份，不需API key；未为测试虚构联系信息。

## 修复与验证细节

改动文件：包内service.js、sources.js、schema.js、capabilities.json、plugin.json、README.md、INTERFACES.md、prompt.md、PROVENANCE.md；新增回归位于plugins/optional-api-v1/tests/financial-research-source-contracts.test.mjs。保留已有capabilities/prompt/plugin.json等他人改动，plugin.json只补CFTC来源描述。

新增回归覆盖（11项）：

1. 注册Schema及三表请求明确支持annual/quarter，缺省annual。
2. 两种报表周期的历史快照互不替代。
3. 无效周期或非FMP三表使用period在网络前给明确错误。
4. status能同时保留AAPL行情成功和insiders402，携带准确参数/时间；configured不变成全来源健康结论；历史快照不冒充新检查。
5. FRED元数据单独来源/获取时间、同vintage请求、last_updated不替换观测available_at；元数据失败保留观测且不伪造单位/泄露错误正文，共3项。
6. CFTC固定匿名端点、字段与日期保留、无效参数和查询注入、历史快照不跨市场、403及畸形响应不生成证据，共4项。

验证命令：

```powershell
$env:SESAME_HOST_ROOT='E:/brief2great/sesame/mt5agent'
node --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js --test plugins/optional-api-v1/tests/financial-research-source-contracts.test.mjs plugins/optional-api-v1/tests/financial-research.test.mjs
```

日志与机器可读证据：

- financial-baseline-tests.log：17项原回归通过。
- financial-regression-red.log：新增4项先失败，确认覆盖真实缺口。
- financial-regression-tests.log：28项全通过。
- financial-fred-red.log / financial-cftc-red.log：新增3项/4项在实现前失败。
- financial-static-checks.json：当前语法、JSON、LF和diff检查通过。
- financial-live-before.json：修复前各来源真实回执与季度访问预检，脱敏。
- financial-live-after.json：修复后4次公开能力实测及完整行复用检查，脱敏。
- financial-live-fred.json：两次公开宏观查询，每次观测与元数据各一次HTTP200，完整保存与复用。
- financial-live-cftc.json：公开COT能力HTTP200、12期/194字段，raw与标准化首行完全一致。
- financial-audit.json：能力/端点矩阵、配置有值状态、验证和剩余限制。
- ../plugin-composition-20261018/real-data-preflight-20261018.json：同日news402证据。

## 后续信源建议，尚未实施

先补现有SEC真实身份配置，再验证申报与companyfacts，不能因未配置就删除。公司IR/RSS原文应复用web-sources→rss-collect/web-extract组合，避免金融插件重复造抓网页能力。FRED元数据与CFTC补充已获准并完成。FMP quote/ratios/DCF另行决定是否注册，其中DCF属于供应商模型输出，不应混为原始事实。

官方依据：[FMP Income Statement参数说明](https://site.financialmodelingprep.com/how-to/fundamentals-at-your-fingertips-fmp-income-statement-api-essentials)、[稳定版三表文档](https://site.financialmodelingprep.com/developer/docs)、[Insider搜索端点](https://site.financialmodelingprep.com/developer/docs/stable/search-insider-trades)、[FRED历史实时期间](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html)。本次没有将某个key的200/402结果推广为所有用户套餐的能力。

## FRED 与 CFTC 的实际边界

FRED 的 `series` 随查询、read、provenance与status.last_checks返回，保留标题、单位、频率、季调、官方last_updated和独立查询URL/获取时间。本次当前DGS10的last_updated为2026-10-16 15:16:36-05，元数据抓取为10月18日10:20:23Z；当前观测available_at仍为null。历史查询对series和observations使用相同vintage=2026-10-15，保守知识上界仍由vintage产生，不从last_updated推导。元数据获取失败时已取得的观测继续保存，状态partial，series.reason明确说明原因。

CFTC没有新增重复工具，仍通过financial_research_query({kind:"cot",market_code:"088691",start:"2026-07-01",end:"2026-10-16",limit:12})使用。固定Disaggregated Futures Only数据集72hh-3qpy，六位合约市场码、有效日期和1–100条，不接受SoQL或任意URL。原数据中的合约数、百分比、交易者数、contract_units等全部保留，不做多空判断。报告日2026-10-13对应持仓观测日，午夜字符串不当作发布时刻；available_at未知。历史as_of只复用截止前已保存的同市场快照。

CFTC不需要新增配置。首次独立metadata请求取得HTML但未保留HTTP状态；随后裸Node fetch对resource返回403（118字节HTML），均未采用本体启用环境代理的启动方式。与并行transport证据对照后，按本体已有--use-env-proxy/桌面NODE_USE_ENV_PROXY=1及官方简单market过滤请求一次成功（200、1行）；最终注册能力的有界日期查询也成功（200、12行）。未改代理、身份、Cookie或凭据，没有绕过访问限制。首次与成功请求的market过滤写法也不同，因此不把这组比较宣称为严格单变量实验；它证明应用标准路径实际可用。

网络回归命令（工作目录E:/brief2great/sesame；只读已有配置）：

```powershell
$env:SESAME_HOST_ROOT='E:/brief2great/sesame/mt5agent'
node --use-env-proxy --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js outputs/information-sources-20261018/financial-live-audit.mjs after
node --use-env-proxy --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js outputs/information-sources-20261018/financial-live-audit.mjs fred
node --use-env-proxy --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js outputs/information-sources-20261018/financial-live-audit.mjs cftc
```

完整回归文件为plugins/optional-api-v1/tests/financial-research-source-contracts.test.mjs（新增11项）与plugins/optional-api-v1/tests/financial-research.test.mjs（原17项）。新增测试通过精确文件补丁移出插件包，避免独立安装包跨目录导入fixture；包内自己创建的空tests目录保留，不进入packageFiles/lock。静态验证包括node --check检查service.js、sources.js、schema.js、新测试文件，以及git diff --check；没有新增依赖。

新增官方依据：[FRED series字段与实时期间参数](https://fred.stlouisfed.org/docs/api/fred/series.html)、[CFTC报告/匿名API说明](https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm)、[CFTC数据集元数据](https://publicreporting.cftc.gov/api/views/72hh-3qpy.json)。有限COT样本不证明交易有效或全市场覆盖。
