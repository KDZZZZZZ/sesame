# 目录默认页与思考展示修复

已完成代码、回归、打包，并将当前运行窗口更新到本次前端构建。采用前端资源更新加页面刷新，Sesame PID 22996 保持不变；没有重启宿主、发送研究请求或停止研究任务。已有标签、消息、报告、模型配置与 58 个插件均保留。

## 可见行为

- 没有标签页时默认显示目录；关闭最后一个标签和重新打开空布局也回到目录。目录不占标签，已有报告的选中状态保留。
- “正在请求模型”、准备、重试等只保留一处活动状态，回复区域不再重复生成空的思考块。
- 仅非空公开摘要显示为思考内容，收到时展开，结束后收起，可再次展开。模型没有返回公开摘要时，只显示真实工作状态。
- 正在显示的摘要、工具调用或流式正文已表示当前活动时，隐藏重复的底部状态。重试和停止状态保留；已完成工具仍折叠。

参考了 [Codex 的摘要与状态实现](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/tui/src/chatwidget/streaming.rs#L333-L408) 和 [Claude Code 的思考展示规则](https://code.claude.com/docs/en/model-config#extended-thinking)。完整出处与适配边界在 reference.md。

## 验证

| 检查 | 结果 |
| --- | --- |
| 工作区持久化 | 10 项通过；修改前新增要求复现 3 项失败 |
| 独立标签栏交互 | 5 组通过，含键盘、窄屏、明暗主题 |
| 独立回复界面 | 7 组通过，含真实摘要形状的流式/完成/展开与工具折叠 |
| 完整目录页面 | 通过，含空布局首次进入、最后标签关闭、刷新恢复 |
| 完整会话页面 | 通过；修改前请求状态复现两处，修改后单一状态与摘要生命周期通过 |
| TypeScript / 前端 lint / build | 通过；lint 仅有既存 event-stream.tsx Fast Refresh warning |
| 独立只读审查 | 未发现本轮阻塞问题 |
| 桌面包 | 58 插件源码摘要匹配；242 个打包 module 文件逐项匹配 |
| 当前窗口 | 新 JS/CSS 已加载，原 PID、标签、模型与插件保留，无页面异常 |

真实模型证据需分开看：运行中的 gpt-6.1-sol 曾返回 353 字公开摘要，API 与界面均有投影；另一次隔离观测中的两个完整请求未返回公开摘要，回调和会话 guard 正常。隔离脚本曾提前结束自动续接，**不计为整个问答验收通过**。本轮不修改宿主摘要采集器，不使用私有 thinking 补位。完整限制在 reasoning/delivery.md。

## 构建与记录

- 新完整桌面构建：`E:/brief2great/sesame/mt5agent/output/desktop-conversation-display-20261024-isqzrq/package/win-unpacked/Sesame.exe`。
- 当前仍是原桌面进程，加载的新前端：`/_app/index-CGeyLuvf.js` 和 `/_app/index-DoGszcuR.css`。两包宿主、插件完全一致，只差前端入口与两个带内容摘要的资源。旧资源保留，入口备份在 running-ui-backup/，更新记录在 ui-deployment.json。
- 本轮精确 12 文件增量：task.patch；变更前后 SHA-256：change-manifest.json。已验证此补丁可以从当前代码反向应用，未混入之前工作区改动。
- 界面证据：status-ui/、reply-ui/、catalog/ui/；当前实际窗口：live-after.png。
- 构建与临时文件均位于 E 盘。

本轮产品改动仅涉及会话展示、目录状态和对应设计文档；插件及宿主接口没有改变。
