# Ultra 状态栏显示修正

已应用到当前打开的 Sesame，只刷新前端，服务进程与本地数据目录保持不变。

- 胶囊与输入框同列居中，宽屏和窄屏均对齐。
- 已开启只显示 Ultra，执行暂停不再冒充模式状态，也不会熄灭模式流光。关闭后隐藏。
- 保留关闭按钮、草稿、既有研究及原有模式开关语义。

验证：11 项 UI 检查通过，零模型请求及页面异常；TypeScript 与生产构建通过。lint 保留原有 event-stream.tsx Fast Refresh 警告，构建保留原有包体积提示。

修改文件：ultra-status.tsx、ultra-status.css、ultra-status-ui.cjs。本轮精确差异保存在 task.patch，旧前端保存在 frontend-backup。live-verification.json 与 live-composer.png 为实际程序验证记录。
