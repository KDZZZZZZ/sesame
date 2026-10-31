# Slash composer 前端交付

## 实现

- / 输入命令菜单，搜索、方向键、Enter/Tab、Esc；/clear 沿用仅清屏接口，/plugin 插入精确插件 ID，/ultra /status /stop 由既有消息 API 发送。
- 配置模型 popover 使用现有 /models 和 provider mutation，只展示认证已配置的 provider 项，保留 thinking 与 busy 保护。
- BeautifulUI Rounded 官方可复制源码适配：单行输入自适应展开、14px 圆角/6px 内距/28px 按钮、紧凑菜单、滑动高亮、180ms/220ms 动效；沿用 Sesame 主题/字体。无新增依赖。
- 保留 @ 报告、IME、队列/安全点插入、失败和慢发送时保留草稿、窄窗口。
- 源码、许可与具体采用参数见 reference/prompt-bar-source-notes.md。UI入口为键入 @ 或 /；没有添加假的工具栏按钮或 dictation。

## 负责文件

修改：modules/frontend/src/features/conversation/composer.tsx、mention-editor.tsx。
新增：同目录 composer.css、composer-model-picker.tsx、slash-commands.ts、slash-command-menu.tsx、slash-command-menu.css。
新增测试：tests/slash-commands.test.js、tests/slash-composer-ui.cjs。

## 最终验证

- node --test tests/slash-commands.test.js：4/4。
- node tests/slash-composer-ui.cjs：10 组全部通过。
- node tests/composer-ui.cjs：既有 16 组全部通过。
- npm run build:frontend：通过，仅既有大包大小提示。
- 所属 TS/TSX/JS 文件 oxlint 和修改文件 diff-check：通过。
- 最终截图：frontend-ui/composer-rounded-compact.png、composer-rounded-expanded.png、slash-menu-light.png、slash-menu-dark.png、model-picker-light.png、model-picker-dark.png、composer-narrow.png。已目检暗色文字清晰、菜单退场无残影、窄栏不溢出。
- 所有 fixture/截图/临时目录在 E 盘；未操作真实 Sesame 或发送真实研究请求。

## Host 只读 review

已向主任务提交并复现：旧 Ultra start 若卡在异步 beforeAgentTurn，stop 扫描队列时不可见，stop 完成后旧 start 会入队重启。需 intake cutoff/barrier；主任务已接手修复。prepared.context.tools 覆盖新插件工具的问题由主任务自行发现和修复。我未改 host/runtime/server。
