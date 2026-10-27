# 思考首句摘要与流式展示

已按最终要求落地：取实际可展示思考内容的首段第一句作为随后操作的摘要，不额外优先识别标题，也不调用模型生成摘要。

- 中文与英文句号使用平台分句规则，小数不会被拆断；无结束标点时保留首段。摘要保留原语言，长句显示两行，悬停可以查看全文。
- 摘要只关联同一来源回复中随后发生的操作。正文、用户插入消息、真实上下文压缩及来源回复边界会重置关联。没有可用思考时保留工具名或操作数量。
- 普通模式临时显示正在返回的真实思考正文，随增量更新；结束后隐藏正文，保留操作摘要。思考/详细模式的历史展示和独立展开选择保留。
- 实时思考区域高度最多 220px，处于底部时跟随内容，用户向上滚动后保持阅读位置。不会重复显示底部活动状态。

## 实现范围

新增 `transcript-intent.mjs` 处理首句、来源关联与当前思考识别。`reply-segments.tsx` / CSS 展示摘要和流式正文；`transcript-grouping.mjs`、`message-item.tsx`、`conversation.tsx` 复用同一可见性规则，避免空白回复与重复状态。补充单元及浏览器回归，更新第三方来源说明。

接口与模型配置未改动。不同模型没有统一的 intent 字段。本次只使用宿主已经提供的可展示 reasoning；没有添加其他模型的后端适配，也不会把未提供的思考伪造成内容。首句摘要和普通模式临时思考是本次按用户要求增加的行为，不是 OpenClaudeDesktop 自带的 intent 能力。

## 验证

- `node --test tests/transcript-intent.test.js tests/transcript-status.test.js tests/transcript-view-modes.test.js tests/transcript-presentation.test.js tests/conversation-replies.test.js`：33/33 通过。
- `node node_modules/typescript/bin/tsc -b modules/frontend`：通过。
- `npm run lint:frontend`：无错误；已有 event-stream.tsx Fast Refresh 警告保留。
- 生产前端构建通过；已有 bundle 体积提示保留。
- `tests/conversation-intent-ui.cjs`：14 组通过，零 pageerror；检查四张截图，涵盖流式增量、首句、边界、模式、长标题和内外滚动。
- `tests/conversation-status-ui.cjs`、`tests/conversation-transcript-ui.cjs`：通过，零 pageerror。
- 浏览器回归使用隔离 fixture，没有发送真实模型或研究请求。运行中实例只做只读核验与前端刷新。

## 当前窗口

已加载 JS `/_app/index-Cx3KHd88.js`、CSS `/_app/index-CYcOOd9f.css`。宿主 PID 10648 保持不变，没有重启宿主，继续沿用 `E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z`。

核验原会话/消息/报告仍在，58 个插件、模型 `openai/gpt-6.1-sol`、思考档位 max、已有配置和密钥摘要不变，标签页与展示偏好保留。运行中的研究未被暂停，历史暂停任务未恢复。现场已观察到 5 个由真实思考首句生成的操作摘要；截图时没有正在返回的思考正文，流式行为由上述回归验证。

证据：`ui-deployment.json`、`live-after.png`、`ui/result.json`、`status-ui/result.json`、`transcript-ui/result.json`。本次独立差异保存为 `task.patch`，文件哈希记录在 `change-manifest.json`，未混入先前未提交的修改。
