---
name: rss-collect
description: "解析 RSS 2.0 / Atom 订阅源为结构化条目。配合 sources_fetch 使用：先抓取 feed URL，再把 XML 文本传给 parse_feed。"
---

# rss-collect

## 官方内置与来源

- **本插件是新写适配层（adapter），不是上游项目的现成 skill。**
- 由 Sesame 维护并随应用发布，默认按需加载，无单独密钥或到期时间。
- 参考候选：[feedparser](https://github.com/kurtmckee/feedparser)（BSD-2-Clause）。本插件仅用 Python 标准库 `xml.etree.ElementTree` 实现 RSS 2.0 与 Atom 核心字段解析，未集成该库或其 skill，也未核验它是否提供 SKILL.md。
- 来源、样本摘要和维护说明见 [PROVENANCE.md](PROVENANCE.md)。
- 本插件代码以 MIT 许可证发布（见 LICENSE）。feed 内容的使用须遵守来源网站的条款。

## 工作流

当前工具负责解析文本；MCP 进程可访问公网与内网。获取订阅内容可使用 sources_fetch。

stdio MCP 与对话 bash 工作区隔离，MCP 不能凭 file_path 访问 /work/inputs：

先用 `plugin_load` 加载 `sesame/web-sources` 和 `sesame/rss-collect`。下文使用 MCP 原始工具名；实际调用使用当前工具列表中的完整 MCP 工具名。

1. 用 `sources_fetch` 抓取 feed URL（RSS/Atom），得到 XML 文本快照
2. 读取快照 `text` 字段。输入须适配当前模型上下文与工具参数上限；不可截断 XML 后声称已完整解析。大 feed 可在研究工作区处理，本工具不能直接读取该工作区文件
3. 调用 `parse_feed`，把 XML 作为 `xml_content` 传入
4. `file_path` 参数仅用于插件包内捆绑样本（如 sample.atom）

## 工具

### parse_feed

参数：
- `xml_content` — RSS/Atom XML 字符串（推荐）
- `file_path` — 插件包内相对路径
- `max_entries` — 返回条目数上限（默认 10，最大 100；`entry_count` 始终为总条目数）

输出：`format`（atom/rss）、`feed_title`、`feed_updated`、`entry_count`、`entries[]`（title、link、published、id、content_snippet 前 300 字符）

## 示例

```
# 抓取 feed
sources_fetch({"url": "https://github.com/adbar/trafilatura/releases.atom"})

# 解析
parse_feed({"xml_content": "<?xml ...", "max_entries": 5})
```

## 局限

- 只覆盖 RSS 2.0 与 Atom 核心字段；不支持 RDF/RSS 1.0 全部扩展、itunes/media 命名空间的深层字段
- 日期不做时区归一化，按源文本原样返回
- 与 feedparser 的健壮性（损坏 feed 容忍、编码探测）不可直接相比


## 错误处理

- 未提供输入或解析失败时返回 `{ "error": "<原因>", "version": "..." }`，且 MCP 响应 `isError=true`（畸形 JSON/XML 不会被声称为成功解析）。
- 调用方应检查 `isError` 或结果中是否存在 `error` 字段。
