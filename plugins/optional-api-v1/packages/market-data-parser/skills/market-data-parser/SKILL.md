---
name: market-data-parser
description: "解析结构化公开金融数据（exchangerate-api 风格 JSON、TCMB 风格 XML 汇率），支持货币代码过滤。配合 sources_fetch 使用。"
---

此包为按需安装的标准 MCP，要求 Sesame >=0.2.0-0；不是默认包。服务器使用现有 Python 标准库，不在加载时下载依赖。先核对固定版本与实际工具测试，不能把解析器/参考目录当成行情账户或交易后端。

# market-data-parser

## 官方内置与来源

- **本插件是新写适配层（adapter），不是上游项目的现成 skill。**
- 由 Sesame 维护并随应用发布，默认按需加载，无单独密钥或到期时间。
- 原候选：[yfinance](https://github.com/ranaroussi/yfinance)（Apache-2.0）；未集成其库、Yahoo 数据能力或 skill。本插件实现 exchangerate-api 风格 JSON 与 TCMB XML 格式解析。
- 来源、样本摘要和维护说明见 [PROVENANCE.md](PROVENANCE.md)。
- 本插件 server.py 仅用 Python 标准库 `json` / `xml.etree.ElementTree` 实现，代码以 MIT 许可证发布（见 LICENSE）。数据使用须遵守各来源网站的条款。

## 工作流

当前工具负责解析文本；MCP 进程可访问公网与内网。获取 API 响应可使用 sources_fetch。

先用 `plugin_load` 加载 `sesame/web-sources` 和 `sesame/market-data-parser`。下文使用 MCP 原始工具名；实际调用使用当前工具列表中的完整 MCP 工具名。

1. 用 `sources_fetch` 抓取公开金融数据端点，例如：
   - `https://api.exchangerate-api.com/v4/latest/USD`（JSON）
   - `https://www.tcmb.gov.tr/kurlar/today.xml`（XML）
2. 读取快照 `text` 字段
3. 调用 `parse_fx_json` / `parse_fx_xml`，把文本作为 `*_content` 传入
4. `file_path` 参数仅用于插件包内捆绑样本（sample_fx.json / sample_fx.xml）

## 工具

### parse_fx_json
- 输入：`json_content` 或 `file_path`，可选 `codes` 过滤
- 输出：`provider`、`base`、`date`、`total_currencies`、`rates`（过滤后）

### parse_fx_xml
- 输入：`xml_content` 或 `file_path`，可选 `codes` 过滤
- 输出：`date`、`bulletin_no`、`total_currencies`、`currencies[]`（code、name、unit、forex_buying、forex_selling）

## 局限

- 仅适配上述两种已验证的公开格式；其他金融 JSON/XML 结构需扩展
- 不提供行情历史、K线、股票报价（yfinance 能力未集成）
- 数据日期、可用性和请求限制由来源决定；样本是固定历史快照，不能用作当前报价


## 错误处理

- 未提供输入或解析失败时返回 `{ "error": "<原因>", "version": "..." }`，且 MCP 响应 `isError=true`（畸形 JSON/XML 不会被声称为成功解析）。
- 调用方应检查 `isError` 或结果中是否存在 `error` 字段。
