---
name: web-extract
description: "从已抓取的 HTML 中提取正文、标题、链接和元数据。配合 sources_fetch 使用：先抓取公开网页，再把文本传给 extract_webpage。"
---

此包为按需安装的标准 MCP，要求 Sesame >=0.2.0-0；不是默认包。服务器使用现有 Python 标准库，不在加载时下载依赖。先核对固定版本与实际工具测试，不能把解析器/参考目录当成行情账户或交易后端。

# web-extract

## 官方内置与来源

- **本插件是新写适配层（adapter），不是上游项目的现成 skill。**
- 由 Sesame 维护并随应用发布，默认按需加载，无单独密钥或到期时间。
- 参考候选：[trafilatura](https://github.com/adbar/trafilatura)（Apache-2.0）。本插件仅用 Python 标准库 `html.parser` 实现规则抽取，未集成该库或其 skill，也未核验它是否提供 SKILL.md。
- 来源、样本摘要和维护说明见 [PROVENANCE.md](PROVENANCE.md)。
- 本插件代码以 MIT 许可证发布（见 LICENSE）。使用网页提取结果时须遵守目标网站的条款。

## 工作流

当前工具负责解析文本；MCP 进程可访问公网与内网。获取网页内容可使用 sources_fetch。

stdio MCP 使用本机当前用户权限运行。本服务器的 file_path 参数单独限制为包内文件，不能用该参数读任意工作区路径；这不是 OS 隔离：

先用 `plugin_load` 加载 `sesame/web-sources` 和 `sesame/web-extract`。下文使用 MCP 原始工具名；实际调用使用当前工具列表中的完整 MCP 工具名。

1. 用 `sources_fetch` 抓取公开网页，得到 HTML 文本快照（dataset 自动保存）
2. 读取快照中的 `text` 字段（大文件用 bash 从 sources_fetch 或 data_read 返回的真实 path 提取）
3. 调用 `extract_webpage`，把 HTML 文本作为 `html_content` 传入。输入须适配当前模型上下文与工具参数上限；超限时明确说明限制，不把截断文本当作完整网页
4. `file_path` 参数仅用于插件包内捆绑的样本文件（如 sample.html），不用于宿主任意路径

## 工具

### extract_webpage

参数（二选一）：
- `html_content` — HTML 字符串
- `file_path` — 插件包内相对路径

输出：`title`、`text`（全文）、`text_preview`（前 300 字符）、`text_length`、`links`（去重后最多 50 条 http 链接）、`meta_description`、`word_count`、`link_count`

## 示例

```
# 抓取
sources_fetch({"url": "https://example.com/article"})

# 解析（把快照 text 传入）
extract_webpage({"html_content": "<html>...抓取到的HTML..."})
```

## 局限

- 基于规则的最小抽取器，对重度 JS 渲染页面效果差（需预渲染快照）
- 不处理分页、登录墙、Cookie 同意层
- 与 trafilatura 的准确率不可直接相比，未做基准评测


## 错误处理

- 未提供输入或读取失败时返回 `{ "error": "<原因>", "version": "..." }`，且 MCP 响应 `isError=true`。HTMLParser 容忍不完整标记，不是 HTML 合法性校验器。
- 调用方应检查 `isError` 或结果中是否存在 `error` 字段。
