# 会话显示：Codex / Claude Code 一手参考

检索日期：2026-10-24。范围是实现参考与官方配置文档；未改产品、未发模型请求。已检查已知本地工作区和父目录，未发现可复用的 Codex 源码 checkout，随后从官方 GitHub 读取固定版本。Codex 最新 main 在检索时为 `970111f6cb62cc02fe36a82ea7d71b37a2889c97`，提交时间 2026-10-23 18:50:54 UTC；下列链接均固定该 SHA，不把 CLI 行为推称为桌面 App 行为。

## 可直接采用的两条规则

1. **只保留一条实时活动状态。** 没有公开摘要时显示普通工作状态；有可用摘要后，用摘要的有效短句更新同一个状态位置。不要再将“正在请求模型 / 模型正在思考”复制成一块可以展开但没有内容的思考记录。等待命令、审查等具体状态优先；相同状态不重复更新。Codex 当前实现会在空摘要时返回，恢复时退回 Working，并跳过重复标题。[状态与空摘要处理](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/tui/src/chatwidget/streaming.rs#L47-L65)、[摘要增量与去重](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/tui/src/chatwidget/streaming.rs#L333-L375)。其中“不复制到另一块”是将其单状态设计适配到 Sesame 的建议。

2. **正文、真实摘要、工具细节分层；过程默认紧凑。** 正文始终独立可读；真实摘要和工具详情可展开，完成后收起，不让已完成过程挤占回答。Codex 把完成摘要放入 transcript-only cell，普通显示返回空，详情可展开；活动组件只渲染所选紧凑或展开版本，避免附属渲染重复。同样，Claude Code 官方文档说明 thinking 默认折叠，Ctrl+O 查看；MCP 调用默认聚合，详细调用和执行记录在 transcript viewer。[Codex 完成摘要](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/tui/src/chatwidget/streaming.rs#L378-L408)、[transcript-only 呈现](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/tui/src/history_cell/messages.rs#L395-L421)、[工具活动呈现](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/tui/src/chatwidget/activity_presentation.rs#L15-L54)、[Claude thinking](https://code.claude.com/docs/en/model-config#extended-thinking)、[Claude transcript](https://code.claude.com/docs/en/interactive-mode#general-controls)。

## 请求配置与“没有内容”的边界

- OpenAI Responses 的推理强度和公开摘要是独立配置。要请求摘要，显式发送 `reasoning: { effort: <现有强度>, summary: "auto" }`；官方解释 auto 选择该模型可用的最详细摘要。摘要位于 reasoning output item 的 summary 数组，原始推理 token 不公开。升高 effort 不能代替请求 summary。[OpenAI Reasoning summaries](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries)
- Codex 的 `model_reasoning_summary` 支持 auto / concise / detailed / none；`model_supports_reasoning_summaries` 控制是否发送推理元数据。2026-09 的官方改动把新建 embedded TUI 会话默认改为 detailed，同时保留显式配置。这是客户端配置行为，不能据此承诺每个响应都一定返回摘要。[官方配置](https://learn.chatgpt.com/docs/config-file/config-reference)、[固定改动提交 9ec33e1](https://github.com/openai/codex/commit/9ec33e19260907aad207185a624bd8b936d5afa8)
- Claude Code 当前官方文档明确：Anthropic API 的交互会话默认收到 redacted thinking；要在展开时取得完整摘要，需要 `showThinkingSummaries: true`。因此“有思考 token”和“有可展示摘要”不能混为一谈。此项仅说明 Claude Code 自身规则，并非 Sesame / OpenAI 的配置键。[官方说明](https://code.claude.com/docs/en/model-config#extended-thinking)
- 没有可用公开内容时，不创建空折叠面板、不伪造正文、不用 generic SDK thinking 或 encrypted/signature 补位。UI 可以保留真实运行状态。当前 Sesame 单次 reasoning=0 的根因不在本调研中判定，需要另看安全事件元数据。

## 固定源码引用索引

- `openai/codex@970111f6cb62cc02fe36a82ea7d71b37a2889c97:codex-rs/tui/src/chatwidget/streaming.rs:L47-L65,L333-L408`：状态回退、摘要可用性、去重、完成后记录。
- `openai/codex@970111f6cb62cc02fe36a82ea7d71b37a2889c97:codex-rs/tui/src/history_cell/messages.rs:L395-L421,L748-L757`：完成摘要的 transcript-only 显示。
- `openai/codex@970111f6cb62cc02fe36a82ea7d71b37a2889c97:codex-rs/tui/src/chatwidget/activity_presentation.rs:L15-L54`：活动紧凑/展开选择及避免重复渲染。

资料已足够决定上述两条显示规则。Claude Code 部分仅引用官方文档，没有访问或声称其完整产品 UI 源码公开。页面会随版本更新，本记录保存了检索日期；Codex 源码引用已固定版本。
