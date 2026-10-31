# 回复思考摘要与过程显示修复

## 已确认的根因

- 当前运行实例的公开消息只投影 text / status / tool；原 UI 的“查看过程”默认折叠，所以工具过程实际存在，但并不是思考摘要。
- SDK 会把公开 summary 和其他 thinking 数据统一映射成 thinking_delta，旧宿主只将它变为 stage，没有保存公开 summary 内容。真实主会话 journal 的只读元数据检查中，391 个 thinking 记录有 34 个包含提供方公开 summary；最近 gpt-6.1-sol 的 summary_text 分别有 461、468、443 字符。未记录摘要原文、signature 或加密内容。
- 空 streaming 回复未进入 ReplySegments，且活动 stage 只传到页底 TaskProgress，造成正文区域无状态反馈。

## 前端修改

- 消费宿主筛选后的 reasoning segment；有内容且 streaming 时自动展开，completed / interrupted 时自动收起，点击可回看。空摘要不生成内容块。
- 摘要与正文、工具记录独立；复制回答仍只复制正文。
- 工具完成默认归入折叠过程；运行、失败、中断保留可见。用户展开后可检查完整过程。
- 对活动回复传入公开 stage，空 streaming 回复也显示实际连接/执行状态；出现摘要或运行工具时不重复显示阶段行。
- 使用无框、紧凑的过程样式，沿用现有主题、字体与 BeautifulUI 参考动效；支持减少动画与键盘操作。

## 修改范围

- modules/frontend/src/features/conversation/reply-segments.tsx
- modules/frontend/src/features/conversation/reply-segments.css
- modules/frontend/src/features/conversation/message-item.tsx
- modules/frontend/src/features/conversation/conversation.tsx（仅 props glue）
- tests/reply-motion-ui/fixture.tsx
- tests/reply-motion-ui/run.mjs

修改前快照位于 before/。宿主事件筛选、持久化与 types 契约由 root 负责，本分支未修改这些文件。

## 验证

- 前端 tsc --noEmit：通过。
- 目标文件 oxlint：通过。
- git diff --check：通过，仅现有 LF/CRLF 提示。
- 真实 React/CSS 隔离浏览器回归：8 组通过，无浏览器错误与异常请求，详见 ui/reply-ui-results.json 和 reply-ui.log。
- 覆盖摘要 delta 原位更新、完成自动收起、手动展开、新阶段重新展开、中断保留内容、空摘要、复制隔离；工具运行/完成/失败/手动展开；插入消息、响应式、双主题、减少动画。
- 已用当前运行 Sesame 的公开 API 回复 payload 回放修改后的真实组件，并目检浅色/深色截图。截图见 ui/reply-public-summary-streaming-light.png、ui/reply-public-summary-streaming-dark.png、ui/reply-public-summary-completed-collapsed.png、ui/reply-public-summary-completed-expanded.png、ui/reply-live-api-replay-collapsed.png。

## 集成选择器与剩余边界

- 摘要容器：.reply-reasoning[data-status][data-open]
- 摘要按钮：.reply-reasoning-trigger[aria-expanded][aria-controls]
- 摘要面板：.reply-reasoning-panel
- 摘要正文：.reply-reasoning-text[data-reasoning-segment]
- 工具过程按钮：.reply-process > .reply-process-trigger
- 保持可见的运行/异常工具：.reply-attention

当前运行实例未重启、未发送研究或交易请求、未回填旧历史。统一构建后的新宿主 + 新前端 + 真实模型流式验收由 root 进行；本记录不将隔离回放等同于已上线验证。
