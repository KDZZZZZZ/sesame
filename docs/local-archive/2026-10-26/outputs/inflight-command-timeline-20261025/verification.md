# 工作台边界与生成期间消息修复

已更新正在使用的 Sesame，保留原数据目录：`E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z`。

## 行为

- 左侧、行情顶部不再提供额外滚动留白。保留既有 4px 图表布局边距。
- 右侧正常吸附位置贴齐窗口；右侧、底部持续长按方向键后可进入 160px 留白，便于拖动尺寸边界。
- 行情布局高度、三栏实际总宽至少填满工作台可视区域，窗口缩放、鼠标拖拽和键盘调整使用相同最小尺寸。
- 宽屏按比例补宽时遵守已有单栏 320–3000px 保存约束，超出上限的余量分给其他栏。
- 生成期间即时命令按接收位置插入；命令确认不接管当前模型回复计时。慢命令完成次序不会打乱输入顺序。
- 插入点保留 Markdown 格式块、完整复制文本和原最终回复；完成后过程折叠规则继续有效。

## 主要变更文件

- `modules/frontend/src/features/canvas/`：workspace-scroll.ts、use-workspace-scroll.ts、workspace-layout.ts、canvas-workbench.tsx、chart-desktop.tsx、tile-splits.ts、use-chart-gestures.ts。
- `modules/agent/conversation-commands.js`、`docs/openapi.yaml`。
- `modules/frontend/src/lib/`：conversation-replies.ts、types.ts。
- `modules/frontend/src/features/conversation/`：conversation.tsx、reply-segments.tsx、reply-copy-button.tsx、transcript-grouping.mjs、transcript-intent.mjs。
- 相关逻辑/API测试及 workspace-edge-scroll-ui.cjs、conversation-command-timeline-ui.cjs。

沿用现有滚动与布局计算、消息投影和 Markdown 词法分析器；未增加依赖，未修改研究或交易执行逻辑。

## 验证

- 边界真实前端回归 13 组通过，含 3840、5120、7680 宽屏保存及刷新。
- 对话真实前端回归 12 组通过，含逆序命令、格式块、复制、计时、普通插入消息和独立排队。
- 相关单元/API检查、类型检查、构建与 lint 通过；保留原有 Fast Refresh 和构建包大小提示。
- 界面回归使用隔离流式快照，不请求真实模型、不发起交易。
- 正常退出前已确认无活动 Run；历史待处理消息属于已暂停的任务，未恢复或清除。
- 6 个数据库已备份并通过 SQLite quick_check。
- 重启后校验 510 条消息、92 份报告、60 个暂停 Run，以及模型/插件/密钥配置摘要、队列和全部相关 ID 均保留。
- 当前进程 PID 36284；资源 `/_app/index-DvOXEg2B.js`；实际界面左/顶部额外 padding 均为 0。
- 对话测试所用构建为 `index-DJc3lW13.js`；之后仅调整画布列宽分配，对话源文件哈希与测试证据一致。

## 记录

- `f52cd14`：边界吸附与窗口最小宽高。
- `be812a6`：宽屏补宽保持可保存上限。
- `340e074`：即时命令插入及计时。
- `5e4d157`：记录修复前已存在的对话实现，分离既有改动与本次修复。

界面证据：`ui/result.json`、`ui/provenance.json`、`../workspace-bounds-refinement-20261025/final/ui-result.json`。

备份和实际重启校验：`update-Qg45ZK/backup-manifest.json`、`update-Qg45ZK/verification.json`、`update-Qg45ZK/desktop-after.png`。

即时命令的精确插入位置从新接收的命令开始记录；没有为旧消息虚构历史锚点或修改存储内容。
