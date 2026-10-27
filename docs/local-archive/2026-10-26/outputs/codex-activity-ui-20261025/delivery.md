# Codex TUI 活动显示逻辑试用版

已更新到当前打开的 Sesame 前端。沿用原有 E: 运行目录和本地数据，没有重启宿主，正在运行的任务未中断。

## 显示规则

- 当前思考标题采用最新有效摘要行；空摘要或尚未闭合的标题片段不会覆盖上一条有效摘要。
- 思考正文实时显示。摘要只代表当前活动，不再用后来的思考为历史工具永久命名。
- 连续工具之间的思考归入同一组，展开后保持实际先后顺序。新正文、真实用户输入和可见状态构成分界。
- 工具组折叠时，当前正在流式生成的思考仍可见；完成后回到历史详情。
- 保留用户要求的完成规则：每轮结束后中间过程默认收起，最终回复和用户输入留在外面。单个工具独立展开。
- 修复实时思考进入工具组时的键盘焦点丢失；用户正在输入时不抢走输入框焦点。

## 参考和适配边界

参考官方 OpenAI Codex `rust-v0.159.3`，提交 `01fc69f4026735edfdf6789820549727a4867b11` 的实时摘要、流式消息与活动分组实现。

- [实时摘要](https://github.com/openai/codex/blob/01fc69f4026735edfdf6789820549727a4867b11/codex-rs/tui/src/chatwidget/streaming.rs)
- [活动分组](https://github.com/openai/codex/blob/01fc69f4026735edfdf6789820549727a4867b11/codex-rs/tui/src/chatwidget/activity_groups.rs)

Sesame 保留通用工具组与用户指定的整轮完成折叠。未新增 Codex 专有的工具类别；这是一份按其活动逻辑适配的前端，而非完整复制 TUI。Apache 许可证和 NOTICE 已加入构建。

## 验证

- 39 项单元测试全部通过。
- 5 套界面回归通过：摘要及流式显示 19 项、对话分组 19 项、状态显示 14 项、完成折叠 11 项，以及 3 个焦点场景。
- TypeScript 检查和前端构建通过；lint 仅保留原有 `event-stream.tsx` Fast Refresh 警告，构建仅保留原有包体积提示。
- 焦点修复后重新验证完成折叠和焦点场景，其余界面套件在此前同一轮实现上通过。
- 界面回归使用测试数据，未发起模型或研究请求；真实工作区验证了资源加载、数据保留和历史折叠。部署快照当时没有正在流式显示的思考，流式行为由界面回归验证。

## 当前运行版本

- 宿主 PID：`10648`，更新前后相同。
- 页面：`http://127.0.0.1:61662/`。
- 前端：`/_app/index-MwqyeRel.js`，样式：`/_app/index-Dpiar53H.css`。
- 运行目录：`E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z`。
- 部署验证时保留 58 个插件、模型配置、已有会话和报告、暂停任务；2 个活动运行未因更新被暂停。
- 历史折叠快照：13 个过程入口默认收起，12 个最终回复可见，没有最终回复或用户输入误收入折叠区域，页面错误为 0。

## 修改和留档

产品改动集中于 `reply-segments.tsx`、`reply-segments.css`、`conversation.tsx`、`transcript-grouping.mjs`、`transcript-intent.mjs`；同时更新针对性测试和第三方声明。未修改插件、宿主接口或模型配置。

`task.patch`、`change-manifest.json`、`baseline/` 和 `captured/` 保存本次独立差异、哈希及修改前后文件。本次未新建 Git 提交，工作区中其他既有改动保持原样。

详细证据：`unit-tests.log`、各界面套件的 `result.json`、`ui-deployment.json`、`live-after.png`。部署前的前端入口与界面偏好备份位于 `running-ui-backup-yBdZYy/`。
