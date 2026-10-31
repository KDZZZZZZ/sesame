# 聊天 GUI 的思考与工具展示参考

核对日期：2026-10-25。只查两个真实图形界面项目；未访问 Sesame、未发送模型请求、未修改产品。只保存少量相关组件源码到本目录 `source/`，未克隆仓库。

推荐以 **LibreChat 的 GUI** 为主参考。它针对当前问题给出了比 CLI 更直接的方案：真实思考内容的短预览、工具与思考的统一活动组、已经完成的工作折叠、用户手动展开优先、流式指示只保留一个。Open WebUI 可作更简洁的对照。

## 直接看界面

- [LibreChat 官方仓库已合并的 GUI 改版 PR #14546](https://github.com/LibreChat-AI/LibreChat/pull/14546)：有相同数据的 before/after 界面对照，覆盖思考流、已完成思考、工具组、MCP、搜索、subagent。GitHub API 确认于 2026-09-06 合并。
- [流式思考截图](https://raw.githubusercontent.com/berry-13/LibreChat/assets-tool-ui-showcase/montage-v2/after/streaming-thinking.png)
- [已完成活动组截图](https://raw.githubusercontent.com/berry-13/LibreChat/assets-tool-ui-showcase/montage-v2/after/group-summary.png)
- [整体效果截图](https://raw.githubusercontent.com/berry-13/LibreChat/assets-tool-ui-showcase/montage-v2/after/overview.png)
- [Open WebUI 官方仓库界面截图](https://github.com/open-webui/open-webui/blob/91ea4e3421d1d8069f13d4a463fcb5986d94ea60/demo.png)

LibreChat 图片托管在 PR 作者的分支，由上述官方已合并 PR 引用，前三个图片链接 HTTP HEAD 均成功。它们用于观看 PR 的视觉效果，不能代替当前组件行为的源码核对。本轮没有在本地运行这两个 GUI；Open WebUI 的 demo 只是整体界面，不能单凭它证明思考展开规则。

## LibreChat：当前源码证明的规则

固定版本：`a378657583567310c841d652b0f6b00c83e2bd6b`，官方仓库 `LibreChat-AI/LibreChat`。

| 场景 | 实际规则 | 源码 |
| --- | --- | --- |
| 思考初始状态 | `showThinking` 默认 false；每段思考的用户覆盖值优先于默认值。不是流式开始就自动展开全部正文。 | [默认偏好](https://github.com/LibreChat-AI/LibreChat/blob/a378657583567310c841d652b0f6b00c83e2bd6b/client/src/store/showThinking.ts#L3-L8)，[Reasoning.tsx:169–199](https://github.com/LibreChat-AI/LibreChat/blob/a378657583567310c841d652b0f6b00c83e2bd6b/client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx#L169-L199) |
| 流式且折叠 | 显示真实思考末尾几句的固定高度预览；尾部随新内容移动，上下淡出。全文保持折叠，避免长文本撑开界面。 | [Reasoning.tsx:37–115](https://github.com/LibreChat-AI/LibreChat/blob/a378657583567310c841d652b0f6b00c83e2bd6b/client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx#L37-L115) |
| 完成思考 | 流式短预览消失，标题停止流式动效。**组件不会强制收起用户已展开的正文**；展开值不由完成状态直接控制。 | [Reasoning.tsx:224–291](https://github.com/LibreChat-AI/LibreChat/blob/a378657583567310c841d652b0f6b00c83e2bd6b/client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx#L224-L291) |
| 无思考文本 | 普通 Reasoning 组件直接不渲染，不用请求状态填充。独立的 marker 场景另有不可交互标识，不应混为真实内容。 | [Reasoning.tsx:150–165](https://github.com/LibreChat-AI/LibreChat/blob/a378657583567310c841d652b0f6b00c83e2bd6b/client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx#L150-L165)，[234–236](https://github.com/LibreChat-AI/LibreChat/blob/a378657583567310c841d652b0f6b00c83e2bd6b/client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx#L234-L236) |
| 工具全部完成 | 在用户未覆盖展开状态、未开启默认展开等条件下，工具活动组自动折叠；用户手动操作后设置 override，后续自动收起不能覆盖它。 | [ToolCallGroup.tsx:322–395](https://github.com/LibreChat-AI/LibreChat/blob/a378657583567310c841d652b0f6b00c83e2bd6b/client/src/components/Chat/Messages/Content/ToolCallGroup.tsx#L322-L395) |
| 防止重复活跃提示 | 显式计算谁持有流式光标；已有卡片持有时不渲染第二个空占位光标。活跃标题已有 shimmer 时，不再在下面加一行相同用途的光标。 | [ContentParts.tsx:945–959](https://github.com/LibreChat-AI/LibreChat/blob/a378657583567310c841d652b0f6b00c83e2bd6b/client/src/components/Chat/Messages/Content/ContentParts.tsx#L945-L959)，[1073–1086](https://github.com/LibreChat-AI/LibreChat/blob/a378657583567310c841d652b0f6b00c83e2bd6b/client/src/components/Chat/Messages/Content/ContentParts.tsx#L1073-L1086)，[1262–1269](https://github.com/LibreChat-AI/LibreChat/blob/a378657583567310c841d652b0f6b00c83e2bd6b/client/src/components/Chat/Messages/Content/ContentParts.tsx#L1262-L1269) |

官方文档还明确：完成的多个活动可进入一个阶段卡；当前仍流式产生的思考/工具留在外面；正式回答和文件保持可见。后到的阶段标题原位替换，不关闭用户已展开的卡。[Agent Activity Groups](https://www.librechat.ai/docs/features/agents#activity-groups)

注意：该项目接受不同模型的 THINK 内容。这里借鉴其 GUI，不建议照搬它所有供应商的原始思考解析，更不建议凭状态文字制造思考正文。Sesame 的公开摘要边界可保持不变。

## Open WebUI：简洁对照

固定版本：`91ea4e3421d1d8069f13d4a463fcb5986d94ea60`，官方仓库 `open-webui/open-webui`。

- `Collapsible.svelte` 默认关闭；点击切换并回调。流式时标题显示活动动效，结束后改为 Thought/耗时。没有“开始必展开、结束必收起”的状态 effect。[组件 22–50、64–118](https://github.com/open-webui/open-webui/blob/91ea4e3421d1d8069f13d4a463fcb5986d94ea60/src/lib/components/common/Collapsible.svelte#L22-L118)
- `StructuredOutputRenderer.svelte` 由 `expandDetails` 偏好传入展开值；只给有正文的思考详情创建折叠项。[渲染器 102–143](https://github.com/open-webui/open-webui/blob/91ea4e3421d1d8069f13d4a463fcb5986d94ea60/src/lib/components/chat/Messages/StructuredOutputRenderer.svelte#L102-L143)
- 连续思考、工具和代码分析会归入 `ConsecutiveDetailsGroup.svelte`；折叠态概括工具名称/次数，组头根据实际活动、失败、拒绝状态改变。用户可以点击或键盘切换。[组组件](https://github.com/open-webui/open-webui/blob/91ea4e3421d1d8069f13d4a463fcb5986d94ea60/src/lib/components/chat/Messages/Markdown/ConsecutiveDetailsGroup.svelte#L97-L200)
- 以上能证明折叠组件和分组内部规则，**不能据此断言全应用任何区域都没有重复状态**；本轮没有跑其完整 UI。

## 对 Sesame 的具体建议（设计判断，不伪称上游现成规则）

以 LibreChat 的“真实内容短预览 + 一套活动组 + 单一流式指示持有者”为参考：无内容时只显示一个简短状态；有公开摘要时直接给出几行内容；完成后回到紧凑行；点击能完整展开。用户主动展开后保留阅读状态。若仍要求“完成后无条件收起”，应明确这是 Sesame 自身约定，不是这两个 GUI 的普遍规则。

不需要另开模型为每次状态生成标题，也不需要扩大本次为整套会话架构迁移。可先复制其交互规则到现有 ReplySegments，配合已有主题和字体。
