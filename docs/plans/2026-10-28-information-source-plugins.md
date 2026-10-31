# 独立信息来源插件设计

日期：2026-10-28。状态：**研究与可实现设计，未创建、安装或宣称新增 provider 已接通。** 本轮只修改渠道审查文档及本方案，读取公开官网并对四条公开 RSS 做匿名只读样例；没有读取凭据、保存配置、注册账号、收费订阅或外部消息发送。

用户约束决定选源顺序：免费且无需来源配置优先，其次免费但需配置；收费来源只保留在免费方案无法满足必要字段时的备选。消息获取插件像知识插件一样独立管理。reports 的技能只讲如何生成报告，不采集消息、不执行研究、不保存来源配置；报告渲染消费已完成的固定证据和方法结果。

本方案遵循仓库 [develop-plugins/SKILL.md](/Users/kaidongzhou/CodeBase/sesame/plugins/api-v1/packages/plugin-manager/skills/develop-plugins/SKILL.md)、[authoring.md](/Users/kaidongzhou/CodeBase/sesame/plugins/api-v1/packages/plugin-manager/skills/develop-plugins/references/authoring.md)、[host-api.md](/Users/kaidongzhou/CodeBase/sesame/plugins/api-v1/packages/plugin-manager/skills/develop-plugins/references/host-api.md) 和 [统一配置技能](/Users/kaidongzhou/CodeBase/sesame/plugins/api-v1/packages/configuration/skills/configure-application/SKILL.md)。本次扫描未找到适用 AGENTS.md。渠道事实和具体 URL/样例见[选项审查](/Users/kaidongzhou/CodeBase/sesame/output/report-visuals/source-options-audit.md)，19 个模块的真实源码覆盖见[能力审查](/Users/kaidongzhou/CodeBase/sesame/output/report-visuals/source-capability-audit.md)。

## 1. 首期选择及现有组件

**先补 Federal Reserve Board 货币政策、讲话/证词 RSS。** 官方公开 feed 不需要来源账号/key；本轮两条 feed 的匿名 GET 为 200、各 15 条。随后 BLS 和 Census 官方公告可沿用相同路径。可读范围局限于相应发布机构，不能宣称覆盖所有市场新闻。官方目录：[Fed](https://www.federalreserve.gov/feeds/feeds.htm)、[BLS](https://www.bls.gov/feed/)、[Census](https://www.census.gov/about/contact-us/feeds.html)。

| 既有独立插件 | 可直接复用的能力 | 必须保留的边界 |
|---|---|---|
| sesame/web-sources | sources_fetch 获取指定公开 URL，冻结完整字节；显式 http source 绑定 http_query。 | 20,000 字符 text 只是预览。2 MiB / 30 秒 / 3 次重定向；通用 UA，无自定义认证头、Cookie 或 key 字段。抓取失败不是空样本。 |
| sesame/rss-collect | parse_feed({source_ref,max_entries}) 解析完整固定 XML。 | 不联网，不获取全文，不做影响分析；1–100 条、无条目分页，entry_count/returned_entries 反映截断。Python 3 经既有 host.process.exec 运行，无额外账户或 pip 依赖。 |
| sesame/web-extract | extract_webpage({source_ref}) 提取已取得 HTML 的标题、正文、链接。 | 不联网、不执行 JS、不处理登录或网站分页；派生输出不是另一条独立来源；原 URL/ref/hash 贯穿。 |
| sesame/financial-research | 已有 CFTC cot 无配置分支；已有 SEC/FRED 需配置分支和固定 evidence source。 | 当前是独立于 reports 的聚合获取插件。本轮保留身份和固定成果，不改 runtime 或拆包。它没有因为 provider 多就成为研究结论执行器。 |

首期实际读取路径：研究侧选择官方 feed → web-sources 冻结 XML → rss-collect 解析 → 必要时 web-sources 取得文章、web-extract 解析 → 研究方法消费固定材料 → reports 根据已完成结果生成报告。报告打开、source 的固定结果 read、导出、图表交互均不能发起新的采集或研究。

“免配置”不代表没有运行依赖：插件需已安装/可加载、网络可达，解析器需已有 Python 3；这些复用宿主统一运行环境，不给每个 RSS 建配置文件。

## 2. 何时复用，何时成为独立 provider

仅取一个公开 URL 并解析时，直接组合现有独立插件就足够。新增 provider 必须提供真实来源语义，例如官方目录、查询约束、历史分页、实体身份、内容版本、来源限流和覆盖状态；不能只有一层转发或 NOT_IMPLEMENTED。

| 来源 | 建议归属 | 首期与后续范围 |
|---|---|---|
| Federal Reserve | 单次读取复用现有插件；首个正式 provider 候选为独立 Federal Reserve 包。 | 首发仅已核实货币政策及讲话/证词；正式实现目录、稳定消息 ID、版本与覆盖后才注册/发布，不能声称包括地区联储或全球新闻。 |
| BLS / Census | 简单 RSS 先复用；来源专属日历/数据协议成熟后各自独立 provider。 | 同机构可共享其消息与数据身份，endpoint 仍分别记录。日程、公布、数值和修订不可混成同一日期字段。 |
| SEC | 暂时复用 financial-research 现有实现；未来正式扩展按 SEC provider 独立交付。 | API 免 key/登录，但免费自动读取仍要求声明身份 UA；现有 sec_user_agent 是必要配置。完整正文/归档/修订需要真实实现，不能由通用 UA 绕过。 |
| FRED / ALFRED | 暂复用现有 fred 分支；完整新 provider 独立拥有字段/source/状态。 | 免费账号和用户自己的 key；日期级 vintage 与发布分钟不同。不能把历史观测日期当当时可知时间。 |
| CFTC | 复用已有无 key cot 分支；拆分或增加 TFF 等完整能力时单独 CFTC provider。 | 当前仅 Disaggregated Futures Only；不能以整个 CFTC 网站覆盖推断该实现覆盖。 |
| GDELT | 若接入则独立 GDELT provider。 | 公共 API/数据免费候选，需验证当前查询、限流和回溯窗口；查询语法/覆盖有专属规则，不能交给报告或 RSS 解析器承担。 |
| FMP / 付费候选 | 不进入默认首期；将来按供应商独立 provider。 | FMP 部分入口已存在，但目标 endpoint 免费权限待核；其他专用候选未接入。免费官方材料/前瞻快照不足时才考虑必要的历史共识、期权或专业新闻缺口。 |

SEC 的账户/身份区分有[官方依据](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)，免费访问与 User-Agent/限流见[访问规范](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)。FRED 的[免费账号](https://fred.stlouisfed.org/help/account/fred-account-features/register)和[独立 key 要求](https://fred.stlouisfed.org/docs/api/api_key.html)已核实。不能为免配置目标埋内置 key、借用开发者身份或替用户编造联系信息。

## 3. 插件身份、声明与状态

未来 provider 为 integration / adapter；纯来源使用指南才是 knowledge，解析仍为 analysis / function。一个 provider 不因此注册研究 workflow、报告 view、交易操作或后台调度。mounted / discoverable / disabled 状态由既有插件管理机制控制，默认可发现即可。

以未来 Federal Reserve provider 为例，以下是**拟议职责**，不是已存在的能力 ID：

| 入口职责 | 必要行为 |
|---|---|
| 来源目录 | 返回包内已经核验的 feed ID、URL、主题、地域、语言、核查日期及覆盖说明；目录读取不联网。 |
| 显式抓取 | 接受 feed ID、内容范围和有界条目数；调用已声明的抓取/解析能力，保存原引用和派生引用；给出逐 feed 结果与覆盖。 |
| 固定证据读取 | 仅按 dataset/ref 读取已保存版本，可分页；缺失返回明确 unavailable，不能偷偷改为抓取最新。 |
| 来源状态 | 返回指定 endpoint/查询的最后观察时间、成功/失败/限流/截断，区别未尝试、未配置、不可达、成功空结果；不把单 endpoint 观察泛化为整供应商健康。 |

capabilities.json 沿用 schemaVersion:1、apiVersion:"2"、configSchema 及显式 capabilities/sources/views/services/knowledge/hooks/stateCollections/artifactSchemas。source 使用已有 `sesame.rows/1` 契约，query 只绑定本包声明且 consumers 含 host 的固定证据读取能力；抓取属于另一项显式能力。输出/输入 schema 与工厂 `{name,execute}` 绑定一致，不隐式注册来源。

跨包复用经 host.capabilities.invoke，plugin.json 的 dependencies/permissions.calls 列真实依赖和最小调用。不能相对导入另一个插件实现。需要共享源代码时可沿用仓库已有边界 helper 的构建时同步方式，交付每包自包含；不能因此共享 provider namespace、配置字段所有权、网络状态或证据身份。

每个 provider 的游标、最后观察、版本索引和退避状态归其插件私有状态。使用宿主 state 端口时显式声明 stateCollections；沿用已有 storageRoot 私有存储时需有清晰 schema、生命周期清理和回读接口。共享的是固定原文 ref/公开算法，而非密钥或可变状态。禁用/升级一个 provider 不得更改另一个 provider 的配置或旧成果归属。

financial-research 现有 SEC/FRED/CFTC 不在本轮拆分。以后拆包必须保留旧 fixed ref 的 producer/revision 和读取能力，单独规划迁移，不默默重写为新 provider，不复制密钥到新存储。不能同时运行两套采集再将其计为两个独立证据源。

## 4. 统一配置：现有契约及实施验证

web-sources、rss-collect、web-extract 当前没有可管理来源字段；不要为“每包一致”造必填 key。首个纯官方 RSS provider 也无需 configuration 字段。可选 feed ID / 条目数是调用参数；只有真正需要持久保存的用户设置才声明统一字段。

现有 financial-research 的 `configuration.fields` 包括 fmp_api_key、fred_api_key、sec_user_agent、reddit_access_token、reddit_user_agent；都以 writeOnly 字符串 schema 声明，并通过 capability binding 指向本包的 financial_research_status / financial_research_configure。其私有记录仅保存变量名映射，值经 `host.configuration.update` 写宿主既有私有配置；本轮只读源码，未读状态或真实值。

现有 FRED 字段的关键绑定示意（省略展示文本，非新插件 manifest）：

```json
{
  "id": "fred_api_key",
  "schema": {
    "type": "string",
    "minLength": 1,
    "maxLength": 8192,
    "writeOnly": true
  },
  "binding": {
    "type": "capability",
    "read": "financial_research_status",
    "update": "financial_research_configure",
    "configuredPath": "/credentials/fred_api_key",
    "writePath": "/credentials/fred_api_key",
    "clearValue": null
  }
}
```

实际 manifest 另有拒绝换行/NUL 的 pattern。未来直接绑定宿主 environment 也只能用开发规范支持的 `binding:{type:"environment",name:...}`；这仍由宿主管理，不允许自行创建 .env、配置 JSON、第二套 secrets 文件或在 README 让用户手改文件。具有既有本地配置契约的 provider 则用 capability binding 保留原 read/update/version，不复制保存。

统一读写的精确顺序和形状：

1. `sesame/configuration#configuration_integration_catalog({plugin_id})` 读真实字段、configured/writable/authority/clearable、条件消费者及可能存在的 expected_version；catalog 不接收 fields。
2. 主会话获得必要且已授权的配置值后，`configuration_integration_apply({plugin_id,command_id,values,expected_version?})` 只提交修改字段。同次重试保持 command_id 和输入不变；字段按 authority 分组；仅目录提供版本时传该组版本。省略字段保留，null 仅清 clearable 字段。
3. `configuration_integration_check({plugin_id,fields:[真实字段ID]})` 必须有非空 fields，仅证明存在。真实网络调用再验证认证/套餐/覆盖；不把 configured=true 写成 online=true。

底层 `host.configuration.catalog/check/apply` 是能力 ID，应通过 host.capabilities.invoke 调用，不是第九个 host.configuration 端口。秘密写入是即时操作，不能进入可持久 Run、工作流结果、报告、固定原始响应、URL、日志或错误文本。

configurationRequirements 只绑定真实使用字段的能力及分支。当前 SEC 需要身份头，FRED 需要 key；CFTC、状态读取、固定数据读取不需要这些 key。FMP/Reddit 历史读取可先复用当时已存快照，不应因今天缺 key 而阻塞。未来 BLS v2 key 只约束 v2 分支，RSS/v1 不受影响；非必须可选参数以 optional:true 表达。状态读取不能依赖正在检查的密钥。

**具体 schema / secret mask 验证点（后续实现验收，不宣称本轮已跑）：**

| 检查 | 预期证据 |
|---|---|
| manifest / binding | 字段 ID 唯一；read/update 是本包实际即时 JSON function，host 可调用；configuredPath/writePath/versionPath 指向真实结构；不写虚构版本。未声明字段被拒绝。 |
| 输入 schema | key/身份字段拒绝空串、超长、换行/NUL；更新嵌套字段也有 writeOnly。枚举/default/examples 不嵌实际秘密；无配置 RSS 不凭空多必填项。 |
| 按分支就绪 | 显式 provider 和省略 provider 的默认路由均测试；无关来源 key 缺失不阻塞当前请求；status/read/解析可正常使用；可选配置缺失不阻塞。 |
| 写入语义 | 同一 command_id 相同输入幂等；不同输入不得误复用回执；部分字段不清其他字段；null 遵守 clearable；authority 不同分组不得部分写入；CAS 冲突重读。 |
| secret mask | 使用测试哨兵，不使用用户密钥。catalog/check/apply/status、错误、操作记录、Run、日志、source URL、原始/派生成果、report 输入均不出现哨兵值；只呈现配置状态。包含联系邮箱的 SEC UA 也按当前 writeOnly 规则保护。 |
| 远端结果 | 保存成功后，401/403、429、网络失败、schema 变化均与“缺配置”区分；不可达不伪装成无新闻。失效/限流只影响自身 provider。 |
| 状态独立 | A provider 保存/清除/禁用/升级不更改 B 的配置、游标、回执和旧证据；共用原文 ref 不改变原 producer/revision。 |

可复用既有回归位置：[配置插件测试](/Users/kaidongzhou/CodeBase/sesame/plugins/api-v1/tests/configuration-integrations.test.js)、[宿主配置集成](/Users/kaidongzhou/CodeBase/mt5agent/tests/configuration-integrations.test.js)、[secret redaction](/Users/kaidongzhou/CodeBase/mt5agent/tests/configuration-redaction.test.js)、[financial source contracts](/Users/kaidongzhou/CodeBase/sesame/plugins/optional-api-v1/tests/financial-research-source-contracts.test.mjs)。新增 provider 应增加本来源真实业务测试；不是在本轮文档研究里创建测试或占位实现。

## 5. 固定证据输出约定

下表是未来消息获取结果的建议契约；不把它加成 reports 强制输入，也不假定上游全都返回。每个字段注明源值、标准化或派生；缺值保留 null 与原因。

| 组 | 建议字段 / 语义 |
|---|---|
| 来源身份 | provider_id、producer_plugin_id/revision、feed_id、source_url/final_url、source_field_path、native_item_id、entity_ids、market/region/language。映射实体保留依据/规则版本；不能从标题猜确定证券代码。 |
| 内容范围 | title、summary、content_scope（headline/summary/fulltext）、article_url、content_hash；RSS snippet 明示摘要。原文权限和抓取失败单列。 |
| 时间 | published_at_raw、published_at、source_timezone、reference_period、event_time、first_seen_at、retrieved_at、source_updated_at；规范化只在源时区有依据时做。 |
| 当时可知性 | content_available_at、availability_basis、as_of_requested；公开日期描述文章/事件，不证明当前修订正文当时存在。未知则 null；first_seen_at 只能证明我们从此时见过。 |
| 固定版本 | 原始 source_ref 与 hash、派生 result_ref、parser/plugin revision、revision_of。固定 ref 保留完整 id/revision/digest/kind/schemaVersion；版本变化追加，不覆盖旧引用。 |
| 查询覆盖 | requested_scope/window、returned_window、feed_entry_count、returned_entries、max_entries、pagination_exhausted、truncated、coverage_status/reasons、network/parser status。HTTP 成功、解析完 feed 与“历史查询完整”分开。 |
| 去重 | 原生 GUID/URL/内容 hash、duplicate_of/cluster_id、去重规则版本；转载群不算多个独立事实来源。变更正文不能因 GUID 相同而被静默丢弃。 |

固定 raw ref 是复核原字节的入口；解析结果保留同源关系。日期只有日级就保留日级精度，不能填假分钟。RSS 只返回当前滚动窗口时，历史 coverage 为 partial/unknown；条目上限截断时返回已见条数和明确限制，不能声称全窗口零匹配。整页下载成功也不是全供应商历史完整。

单项情绪、主题、市场影响、surprise、概率和历史匹配归选定方法/研究工作流。provider 只提供事实及其覆盖，不产生投资结论；reports 只教如何组织展示并消费既有方法结果。

## 6. 后续实施和完成判据

1. 首个真实实现只做 Fed 已核实两条 feed 的目录、显式采集、固定读取、修订/覆盖；复用现有获取/解析能力。先证明有这些业务能力，才建立/发布 provider，不同时创建一排空壳。
2. 用真实宿主验证安装、发现/加载/禁用、最小 calls、固定 ref 交接；校验超过条目上限、日期缺失、正文修订、坏 XML、网络错误/限流及取消。共享原文只有一个独立来源身份。
3. 使用保存的证据跑方法和报告，断开网络后固定读取/报告仍可重现；打开报告不产生任何获取/研究调用。缺关键字段时如实缺省，不能使用示例数据冒充真来源。
4. 扩 BLS/Census 官方发布和需要的日历；按任务市场范围逐源增加。再通过统一配置启用必要 SEC 身份头、FRED key；BLS v2 等免费配置只有真正需要时补。
5. 免费来源无法补的历史共识、期权历史或专业档案保留为明确缺口；收费候选不是默认后续任务。本轮不购买、不接入，是否采用由实际任务和后续授权决定。

本轮完成证据是三份审查/设计文档、源码声明复核、官网依据和四条公开 RSS 的匿名端点样例；不是新增 source/tool 清单、宿主安装回执、真实账号连通性或研究结果。
