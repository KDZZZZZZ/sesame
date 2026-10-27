# 报告导出反馈与折叠状态 · 2026-10-24

已在当前 Sesame 的原工作区验证并打开。PDF/图片导出成功后，按钮旁显示“导出成功”，3 秒后自动消失；提示显示期间可继续导出。

导出不再主动打开 details 或移除折叠组，也不再自动展开 reportKit 的额外表格行；保留报告自身的默认展开状态。

运行程序：`E:\brief2great\sesame\mt5agent\output\desktop-export-feedback-20261024-9GWetI\package\win-unpacked\Sesame.exe`
页面：http://127.0.0.1:4217/

修改文件：

- modules/frontend/src/features/report-dock/report-export-buttons.tsx：成功提示、定时清理和再次导出时重置。
- modules/shared/report-export-renderer.js：删除强制展开逻辑。
- tests/report-export-renderer.test.js：已发布/源文件 PDF/PNG 的关闭与主动打开状态，以及表格行数。
- tests/fixtures/report-renderer-electron.cjs：并发中文 PDF 保留折叠状态。
- tests/report-export-ui.cjs：真实下载成功提示、按钮可用及提示自动消失。

验证：折叠导出 5/5、尺寸/错误处理 1/1、Electron 渲染 20/20、真实下载 UI 测试、前端构建/类型检查与定向 lint 通过。

当前 v11 黄金报告的 6 个折叠项在导出前后均保持关闭。实际 PDF 为 5 页，PNG 为 1000 × 5832；PDF 保留文楷字体，原始折叠表格行未被展开。
模型配置、消息、Run 状态和报告版本与切换前一致，切换前已备份数据库。所有构建、下载和测试文件位于 E 盘。

本轮独立 diff：changes.patch；逐文件哈希：change-index.json；实际下载与提示核对：live-verification.json；按钮截图：pdf-success.png、png-success.png。
