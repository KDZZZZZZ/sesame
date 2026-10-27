# 信息获取插件审计与修复

日期：2026-10-18。检查对象是直接获取/解析信息的 9 个插件；方法、知识和研究工作流不重复充当信息源。本轮没有模型研究开销或实盘交易，使用真实来源的只读请求验证；源码改动与测试在本地完成，尚未发布或替换正在运行的安装版。

## 可用性结论

| 插件 | 当前能工作的部分与真实证据 | 尚存条件或限制 |
| --- | --- | --- |
| financial-research | FMP AAPL 日线、年度与季度三表、评级；FRED 当前和历史版本、序列元数据；新增 CFTC 黄金近 12 期分类仓位均真实返回 | FMP news/insiders 为套餐 402；部分标的权限不同。SEC 缺真实 User-Agent，Reddit 缺 OAuth/身份配置，未声称这些已联网验证 |
| web-sources | Apple、SEC、Fed、CFTC、汇率 JSON/XML 的真实获取；保存原始字节及来源引用 | 受单次 2 MiB、30 秒和来源访问条件约束；不是浏览器或办公文档解析器 |
| web-extract | 官方新闻及约 1.52 MB SEC 年报通过 source_ref 直接解析，完整正文可按引用读取 | HTML 文本与链接提取，不等于完成财报表格/XBRL 的金融语义解析 |
| rss-collect | 官方 Fed RSS 正常；支持 RSS 2.0 和 Atom，保留原文链接、日期与覆盖范围 | feed/摘要不是完整新闻正文，也不等于全面新闻覆盖 |
| market-data-parser | TCMB XML、ExchangeRate JSON 真实解析正常；支持直接读取已冻结来源 | 专用汇率结构，不能解析任意 JSON，更不能把下载的 XLSX 当已读工作簿 |
| AKShare | 腾讯、新浪各返回 7 根 A 股日线；Windows 中文报价错误修复后，腾讯报价正常 | 东方财富在当前网络仍连接失败。可以显式选择已声明的可用来源，保留不同来源身份 |
| CCXT | 修复环境检查后，Kraken/Coinbase/OKX 的正式注册行情操作各返回 17 根 BTC 日线 | 本机需要显式绑定已有代理；直连失败。无需交易所 API Key；仅公开现货行情 |
| MT5 | 已安装插件注册绑定→官方 MCP→既有终端，XAUUSD 报价及 20 根 D1 正常，与 SDK 独立读取一致 | 本次未覆盖完整宿主 registry/Run/UI；时间、CFD 和 tick volume 口径保留原限制 |
| QMT | 环境检查能力正常，能明确报告所需 SDK、端口和券商终端条件 | 本机未检测到 MiniQMT 运行环境，未验证真实行情连接；保留可选能力 |

**没有删除整个信息插件。** 已定位的代码缺陷可修；尚未通过的能力属于缺配置、套餐或当前网络条件，没有证据证明其功能应永久删除。三个解析插件原来只接收大段内联输入的 MCP 入口已改为复用同名原子能力和宿主资源引用，不新增重复抓取工具。

## 本轮实质改动

1. **季度财报**：FMP 公开注册 `period: annual|quarter`，快照按周期隔离，避免把可获取的季报误报为缺失；季度不冒充 TTM。
2. **来源状态**：记录最近真实调用的参数、时间、结果及错误；“已配置”不再被解释成所有端点或标的都可用。
3. **宏观口径**：FRED 返回官方标题、单位、频率、季调方式及更新时间；元数据读取失败保留观测值和缺口，避免猜单位。
4. **新增持仓信息**：现有 financial_research_query 增加 `kind: cot`，固定使用 CFTC Disaggregated Futures Only 数据集。Agent 传市场代码/日期/条数，不需自行拼 SoQL。观测日与可用时刻严格分开，不在获取层做多空判断。
5. **长文组合**：`sources_fetch → source_ref → 解析能力` 直接贯通；大输出冻结完整解析结果，仅返回有界预览、完整字数/条数、结果引用和精确文件入口。受控 2 MiB 纯正文完整保留，Agent 收到约 5.2 KB；真实 SEC 年报输出也未被宿主通用文本截断。
6. **本机运行缺陷**：CCXT 缺依赖改为正常探测结果，允许后续私有环境准备；AKShare 用 JSON Unicode 转义消除 Windows 管道中文编码错误。
7. **能力说明**：明确所有凭据/环境要求、FMP 套餐差异、CCXT 显式代理、原文/预览区别，以及官方来源的具体调用形状。
8. **Agent 实际读取**：普通 subagent 和工作流成员统一获得基础 `host.resources.read`，按精确引用读取已发布产物；仍复用资源归属检查。UTF-8 分页在完整字符处结束，并返回实际 `nextOffset`，避免中文/emoji 跨页时报错。没有新增文件写入、进程执行或业务工具授权。

## 按投资实践选择补充信息

来源选择有明确的实际使用依据，而不以网站热度排序：

- **公司披露及电话会**：NBIM 年报披露了其财报/电话会分析流程；AQR 的 Cliff Asness 访谈谈到公司文本与基本面动量；原论文研究显示电话会问答相对新闻稿有信息增量。适合核查业务机制、指引、盈利质量。优先 SEC/公司 IR，保留原文与版本，不把公司自述当第三方独立判断。
- **宏观数值与预期**：PIMCO 的通胀研究使用实际通胀、盈亏平衡通胀和费城联储 SPF；需要区分实际值、调查预期和市场风险补偿。FRED/ALFRED 已可用；SPF 官方工作簿无 Key 可下载，但当前插件尚未提供通用 XLSX 解析能力。
- **分类仓位**：AQR 向 CFTC 的公开意见函确实使用分解持仓研究风险转移。新增 CFTC 输入补充价格之外的持仓结构；周度总仓位不是当日订单流，更不直接给买卖信号。
- **政策和公司事件**：Fed 官方 RSS、Apple 官方 Atom 已有明确获取/解析例子。官方订阅能补事件原文，但公司新闻有选择性，不能替代广覆盖的独立新闻或个股一致预期。
- **黄金供需**：GLD/WGC 是实际研究会采用的资料，但单基金持仓不等于全球资金流，公开页面可读也不等于获得商业自动抓取授权。本轮未将它们设为无配置的默认依赖。
- **社区**：r/SecurityAnalysis 资源指南用于发现材料；没有把单篇讨论、赞数或局部意见称为整个投资行业的共识。

完整原始出处、论文、报告、访谈、官方接口及费用/配置条件见 [投资信源研究](./investment-source-research.md)。其中包括 [NBIM 2024 报告](https://www.nbim.no/en/news-and-insights/reports/2024/responsible-investment-2024/web-report-responsible-investment-2024/)、[PIMCO 通胀研究](https://www.pimco.com/us/en/insights/assessing-inflation-theories-policies-and-portfolios)、[AQR 致 CFTC 的公开函](https://comments2.cftc.gov/Handlers/PdfHandler.ashx?id=29273) 和 [CFTC 官方说明](https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm)。

## 验证记录

针对性回归合计 **142 项通过、1 项 opt-in 未启用而跳过**；跳过的 CCXT 路由检查之外，注册行情操作另做了真实网络验证。普通 subagent/工作流资源读取、中文分页及对应宿主回归 50/50 通过。46 个 optional 包的静态契约与独立组装通过。本轮只更新了 7 个修改包的开发锁条目，保留 Kurumi 既有未审查改动；未发布或更新已安装应用。详细范围与既有 lint 警告见 [验证清单](./verification.md)。

- [金融研究审计](./financial-audit.md)：按 provider/kind 列出真实 HTTP 结果、配置状态、回归及剩余限制。
- [行情审计](./market-audit.md)：真实注册能力调用、网络路由和依赖修复证据，并明确排除审计脚本自身的参数/consumer 错误。
- [MT5 插件审计](./mt5-plugin-audit.md)：只读已安装插件绑定验证范围，不冒充完整宿主 UI 测试。
- [获取与解析审计](./transport-audit.md)、[传输实测 JSON](./transport-audit.json)：原文大小、解析结果、来源引用和实际成功案例；历史 SEC 文件仅作传输测试，不当成最新投资信息。SEC 隐藏 XBRL 头已排除，冻结原文重解析得到 206,713 字符可见正文。

验证是有明确边界的样本，不是所有来源、所有参数和长期可用性的保证。缺来源配置、当前套餐限制以及未接入的工作簿解析都有明确标注，不用空数据或其他类别的信息掩盖。
