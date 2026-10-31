# 霞鹜文楷试用记录 · 2026-10-24

回复与报告已接入 LXGW WenKai 1.530。新构建已用原工作区打开，报告保持 v11，研究内容与固定数据未改动。

- 运行程序：`E:\brief2great\sesame\mt5agent\output\desktop-wenkai-20261024-lcwwOu\package\win-unpacked\Sesame.exe`
- 页面：http://127.0.0.1:40389/
- 工作区：`E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z/workspace`
- reports 插件：3.2.9；构建包含 56 个当前源码插件，239 个宿主模块文件完成哈希核对。
- 字体：Regular WOFF2，4,001,644 bytes；19,319 个码位，保留常用简繁字、拉丁字、数学与货币符号。强调使用合成粗体。
- 下载、构建、测试输出和浏览器临时目录均指定在 E 盘；没有安装系统字体。

## 修改

- 回复容器及报告使用统一 reading-font；代码与界面控件保留原有字体规则。
- 字体随应用离线打包，报告 iframe 与 PDF/PNG 导出使用同一字库。
- 离屏资源按二进制读取 WOFF2 并发送正确 MIME。
- PDF 静态文档通过 CDP 写入，避免大型内嵌字体超过 data URL 导航长度；原有隔离、预算和取消机制保持。
- reports 插件的模板 CSS、版本、lock、inventory 同步更新。
- 17 个文件的本轮改动保存在 change-index.json、changes.patch 与 before/after 中；未混入原有工作区修改。

## 验证

- 真实界面 CDP 确认回复、报告标题及正文实际采用 LXGWWenKai-Regular 自定义字体。
- 实际 v11 报告在 1000px 浅色、390px 浅色和 1000px 深色下通过；4 棵决策树、64 个节点、60 条边及蜡烛图保持完整，无横向溢出和渲染错误。
- 新运行程序导出：PDF 9 页、540,313 bytes；PNG 1000 × 12263、1,262,356 bytes。PDF 确认内嵌文楷字库，图片全高均有正文内容。
- 字体资源与主题测试 6/6；Electron 桌面渲染 20/20；插件模板及 inventory 9/9；构建和类型检查通过。
- lint 通过，保留原有 event-stream.tsx:21 Fast Refresh 提示。
- 双字重方案实际报告峰值 439 MiB，超过原预算；最终单字重真实报告 PDF 峰值约 277 MiB、PNG 255 MiB，未提高预算。
- 模型配置、消息、Run 状态、报告版本及报告目录与切换前逐项一致；数据库已备份。

字体来源：https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530。授权文本与来源哈希随字体存放。

导出文件位于 exports/，页面与 PDF 首屏截图位于 screenshots/。
