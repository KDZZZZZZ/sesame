# 信息获取与解析串联审计

2026-10-18，传输与解析 lane。七个真实公开来源调用成功；另用正式插件安装的隔离 Runtime 验证了 2 MiB 受控纯正文与真实 SEC 长文。未运行模型、复制凭据、修改用户配置或发布版本。

## 修复结果

保持原能力 ID：`sources_fetch`、`extract_webpage`、`parse_feed`、`parse_fx_json`、`parse_fx_xml`。三个解析包改为 native 适配器，仍运行自带的 Python 标准库解析算法。通过已有 `host.resources.read` 读取精确原文引用，使用已有 `host.process.exec` 调用解析器，不扩大 MCP 1 MiB 限额、不新增同类抓取工具。

原先 `sources_fetch` 可抓取 2 MiB，但 Agent 只能看到 20000 字符预览；将整篇文本传给 MCP 又可能超过 1 MiB。现在 source artifact 同时保留原始字节 `source.txt` 和标准行数据 `rows.json`；解析能力接受 `source_ref`、原 inline 文本、包内 `file_path` 三选一。原文按 256 KiB 字节分页读取，合并后才按来源编码解码。最终 URL、取证时间、原始字节 hash 与来源引用随结果保留。

还修复了公开 JSON 对象被误拒绝为“非对象数组”、当前 ExchangeRate Open Access 的 `base_code` / `time_last_update_utc` 字段、相对 HTML 链接、导航链接污染及部分缺失属性处理。原有六个小样本的数值/提取输出保持一致。

长结果超过 24 KiB 时，返回 `output_truncated:true`、`result_ref`、`result_entries` 和完整字符/条数；完整结构保存在 data 产物的 `rows.json`，HTML 正文单独保存在 `text.txt`。正文预览不能冒充全文，长结果不返回 `text`。原来源追踪完整保存在产物内。小结果保持原字段。已有 source_ref 的结果标记为 derived 并固定原输入依赖；inline 输入标记 user_input、包内固定样本标记 demo，不捏造外部来源或绕过宿主派生依赖校验。

宿主 native Schema 校验原本就使用单独的 64 MiB 预算；本轮实测没有把输出问题误报为 MCP 1 MiB 限额。问题是大结果触发宿主通用工具截断，退回难读的工作区 JSON。新的结果引用避免这一回退。新增的发布声明只使用现有 resources 端口和 data artifactSchema，不向 Agent 增加进程/文件操作工具。

## 明确调用形状

```javascript
const fetched = await invoke("sesame/web-sources#sources_fetch", { url });
// sources_fetch 是 run，先通过宿主 runs 等待完成并取得其输出。
const parsed = await invoke("sesame/web-extract#extract_webpage", {
  source_ref: fetched.ref
});
// RSS/Atom 用 parse_feed；ExchangeRate JSON/TCMB XML 用对应专用汇率解析能力。
// 普通 CFTC JSON 已是结构化数据，不送入汇率解析器。

// 长结果按需读 HTML 正文；结构化完整结果使用 result_entries.structured。
host_resources_read({
  ref: parsed.result_ref,
  part: "content",
  entry: parsed.result_entries.text,
  offset: 0,
  length: 8192,
  encoding: "utf8"
});
// 后续字节区间使用响应 nextOffset；不要把预览当整篇材料。
```

插件内接口形状为 `host.resources.read(ref, options)`，Agent 接口为 `host_resources_read({ref,...options})`。所有引用来自实际返回值，不猜测 ID、路径、revision 或 digest。

## 七个真实来源结果

真实网络读取时间为 2026-10-18 10:06–10:12 UTC；逐次时间、URL、hash 与结果文件见 [transport-audit.json](E:/brief2great/sesame/outputs/information-sources-20261018/transport-audit.json)。这是当次可用证据，不是服务持续可用承诺。

| 来源 | 原文大小 | 实际验证 | 状态/边界 |
|---|---:|---|---|
| Apple 官方 2026 年第三季度业绩页 | 147,105 B | HTML → 2,265 字符 | 通过；公司原文，不证明投资者情绪 |
| Fed `press_all.xml` | 14,813 B | RSS 20 条，按参数返回 5 条 | 通过；feed 摘要不是全文 |
| TCMB `today.xml` | 9,097 B | USD/EUR 2 个币种 | 通过；数据日 2026-10-16，不冒充实时价格 |
| ExchangeRate Open Access USD JSON | 2,972 B | EUR/JPY/GBP 3 个币种 | 通过；源时间 2026-10-18 00:02:31 UTC |
| SEC Apple 2023-12-30 季报 | 732,644 B | HTML → 65,259 字符 | 通过；历史传输样本 |
| SEC Apple 2025-09-27 年报 | 1,520,679 B | HTML → 220,552 字符 | 通过；真实大于 1 MiB；历史传输样本 |
| CFTC 黄金近期 12 期 JSON | 81,661 B | 固定 72hh-3qpy 数据集，12 行 | 通过；报告日是持仓观测日，可用时间未核实 |

Fed 货币政策 RSS、Apple Atom 的精确使用例已依据另一 research lane 的实际检查写入声明/文档；不计入本 lane 上表七个网络样本。需要结构化 COT 语义时应使用 `financial_research_query({kind:"cot",market_code:"088691",limit:12})`；通用 URL 例只说明传输边界。

CFTC 使用 GET、固定 `User-Agent: Sesame-Research/0.1`、`Accept: text/*,application/json,application/xml`、`Accept-Encoding: identity`，遵循原有代理环境，没有换身份、Cookie、Key 或绕过拒绝。调用细节已交给 financial lane 对比其 403。

## 正式安装和边界回归

在独立工作区以 `Runtime.init()` 启动无凭据、无模型运行时，再通过正式 `host.plugins.install()` 安装四个包；全部为 ready。调用真实 Schema 校验、manifest、进程执行、发布与权限端口；最后通过 Agent 注册的 `host.resources.read` 读取派生资源。

| 用例 | 输入字节 | 完整提取字符 | 返回 Agent 的字节 | 结果 |
|---|---:|---:|---:|---|
| 受控本机 HTTP，恰好 2 MiB 纯正文 | 2,097,152 | 2,097,119 | 5,217 | 通过；末尾标记和全文逐字相等 |
| 真实 SEC 年报复测 | 1,520,679 | 220,552 | 5,325 | 通过；完整正文与结构资源一致，来源引用不变 |

两例均未触发宿主 `_tool_output_truncated` 或工作区 JSON 回退。证据：[正式 Runtime 结果](E:/brief2great/sesame/outputs/information-sources-20261018/installed-transport-2/evidence.json)，[SEC 完整提取文本](E:/brief2great/sesame/outputs/information-sources-20261018/installed-transport-2/official-sec-annual-text.txt)。正式测试工作区仍保留原文和派生资源；早期七案例使用真实宿主端口 fixture，临时工作区已清理，JSON 中旧引用作为测试收据，解析结果文件和来源 hash/时间保留。

正式长文验证后发现开头预览包含隐藏 XBRL 头，已增加局部修复：排除 `ix:hidden`、`hidden` 属性及行内 `display:none` / `visibility:hidden`，保留后续可见正文和链接。直接复用上述冻结原文（hash 不变、未重新联网）重解析，正文由 220,552 字符变为 **206,713 字符**，预览从内部 XBRL 字段变为“UNITED STATES SECURITIES AND EXCHANGE COMMISSION … FORM 10-K”。[重解析证据](E:/brief2great/sesame/outputs/information-sources-20261018/sec-visible-reparse.json)与[修正后的正文](E:/brief2great/sesame/outputs/information-sources-20261018/sec-visible-text.txt)保留。此改动不计算外部 CSS，不宣称通用正文识别或财务语义解析。

## 配置和覆盖边界

| 能力/条件 | 配置或现状 |
|---|---|
| 公开 HTTP/HTTPS 获取 | 本次来源无需 API Key；沿用宿主 HTTP(S)_PROXY / NO_PROXY |
| 解析执行 | 已有 Python 3，优先宿主 pythonPath；Windows 回退 python，其余平台 python3；标准库，无 pip 安装 |
| 认证网站 | 不支持任意 Cookie、Bearer 或认证头；401/403/套餐/登录限制不能由解析器解决 |
| 来源上限 | 原始字节 2 MiB；解码后 UTF-8 8 MiB；inline UTF-8 2 MiB；30 秒、3 次重定向 |
| 编码验证 | UTF-8 跨页、emoji/中文、ISO-8859-1 已测；未测试全部 BOM/字符编码组合 |
| HTML | 静态规则解析；排除明确隐藏标签/属性/行内样式，但不计算外部 CSS，不执行 JS、不跨页、不处理登录、不核实市场事实 |
| RSS/Atom | 最多返回 100 条；来源条目计数与返回条数区分；没有来源分页 |
| 行情解析 | 只支持声明的 ExchangeRate JSON 与 TCMB XML；不是通用 OHLCV 解析器 |
| XLSX | SPF/GLD 工作簿不支持；未将下载/解码等同于工作簿解析 |
| CFTC 时间 | 观测日、获取时间、公开可用时间分别处理；本 lane 未验证发布时间 |
| 未执行 | 完整多成员模型研究、全仓库测试、用户安装、发布/推送；没有改锁文件或版本号 |

## 回归与命令

针对性 Node 测试 **7/7 通过、0 跳过**，21.47 秒。覆盖原文分页/编码/hash、>1 MiB 来源引用、互斥输入、旧快照、包内路径限制、畸形 XML、2 MiB 纯正文/完整产物回读、明确隐藏内容和可见正文保留、RSS/汇率长结果真实 entry 与文档一致，以及六个旧样本。四包声明通过真实安装；scoped Oxlint 无警告/错误；三个 Python 文件 AST 检查通过；scoped `git diff --check` 通过。

文档契约回归实际生成了 RSS 和汇率长结果，确认二者只返回 `result_entries.structured="rows.json"`；Agent 示例统一使用这一返回入口，只有 HTML 正文使用 `result_entries.text`。读取按返回的 `nextOffset` 续读，不手工累加固定长度。

```powershell
$env:SESAME_HOST_ROOT='E:/brief2great/sesame/mt5agent'
# 工作目录 E:/brief2great/sesame/sesame
node --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js --test plugins/optional-api-v1/tests/source-parser-transport.test.mjs

# 复测必须选择新的独立输出目录；不会复用用户工作区。
$env:SESAME_TRANSPORT_OUTPUT='E:/brief2great/sesame/outputs/information-sources-20261018/installed-transport-next'
node --use-env-proxy --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js E:/brief2great/sesame/outputs/information-sources-20261018/installed-transport.mjs
```

初次安装测试脚本因 SDK 仅导出 ESM、不能使用 CJS resolve 而启动失败；修正测试脚本使用包的 import 导出后才执行上述成功的正式运行。没有把失败的初始化记为插件通过。

主要文件位于四个插件包内；新测试为 [source-parser-transport.test.mjs](E:/brief2great/sesame/sesame/plugins/optional-api-v1/tests/source-parser-transport.test.mjs)。实际实现采用各解析包自带适配器，保持独立安装，不引入跨包相对依赖。

依据：[ExchangeRate 官方接口](https://www.exchangerate-api.com/docs/free)、[Python HTMLParser](https://docs.python.org/3/library/html.parser.html)、[Fed 官方 feeds](https://www.federalreserve.gov/feeds/feeds.htm)、[TCMB 官方 XML](https://www.tcmb.gov.tr/kurlar/today.xml)。
