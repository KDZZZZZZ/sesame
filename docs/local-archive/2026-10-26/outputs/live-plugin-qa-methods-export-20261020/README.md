# 方法报告静态导出 QA — 2026-10-20

仅固定并读取两份已发布 QA 报告及其引用数据；没有读取活跃子任务数据库、
执行业务能力、修改报告、操作实桌面或重启应用。
修复后的隔离测试使用最新源码和 Electron 44.5.1 / Chromium 152.0.7977.130。

| 固定报告 | 修订 | details / tables | 修复前测量高度 | 完整高度 | 修复后结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 量化方法实验 | 1 | 21 / 3 | 17,154px | PDF 18,695px / PNG 19,092px | PDF 13 页、1,464,038 字节；PNG 3 张、合计 1,922,834 字节 |
| 证据与方法对照 | 2 | 81 / 21 | 51,713px | PDF 340,249px / PNG 341,613px | PDF/PNG 均明确拒绝：422 `report_export_invalid`，超过 64,000px 高度预算；未调用打印/截图 |

随后确认并修复了空白末页：原来按屏幕样式固定 iframe 高度，但打印 CSS
会移除 padding 和控件、改变文字排布，外层多余高度会产生空页。
PDF 现在在打印样式下重新测量，量化报告从 14 页变为 13 页；
保留的 13 页文本逐页完全相同，Poppler 渲染末页图片的 SHA256 也相同。
PNG 三片尺寸、字节数和 SHA256 均未改变。见
`quant-methods-pdf-print-fixed/print-reflow-proof.json`。

## 确认的缺陷

打开 `details` 仍不足以完整导出滚动区域：

- 量化报告有 15 个 `pre` 被 `max-height:30rem`（420px）截断，
  另有 `.sc-table-wrap` 被 420px 高度裁切。
- 证据报告有 31 个 `pre.qa-code` 被 `max-height:32rem`（448px）截断；
  最长一块实际高度为 189,250px。
- 修复前量化 PDF 文本约 19,383 个非空白字符；修复后约 22,926 个。
  16 个裁切区都找到了以前缺失的尾部标记，见 `quant-methods-pdf-fixed/pdf-proof.json`。
- 修复前证据 PDF 虽有 36 页，但仅提取约 71,262 个非空白字符，
  完整 DOM 文本约 479,806 个；旧 PDF/PNG 不能视为完整报告。

准确的受限元素、原始 clientHeight / scrollHeight 与尾部样本保存在
`quant-methods-clipping/overflow.json` 和 `evidence-methods-clipping/overflow.json`。

## 最小修复

修改共享导出路径 `modules/agent/report-export-renderer.js`：

1. 导出副本中的 `pre` 取消高度限制、自动换行并显示完整内容。
2. 遍历 `pre` 和 `table` 的实际裁切祖先，解除滚动容器高度/溢出限制。
   不依赖报告作者的 CSS 类名，不显示原本隐藏的无关内容。
3. 然后使用原有尺寸测量、64,000px 高度、384 MiB 内存看门狗和 32 MiB 输出预算。
   没有提高限额或为大报告增加绕过模式。
4. PDF 在测量前调用内部 `printMedia()`；Electron 对宿主页和本报告的
   独立 iframe target 设置打印媒体，Playwright 使用已有 `emulateMedia`。
   两个实际适配器都已更新；没有公共 API 或兼容分支。

实桌面仅部署共享导出器和 `modules/frontend/electron/report-renderer.js`。
`modules/agent/report-playwright.js` 已同步更新源码，但现有桌面包中不存在
此文件，桌面使用 IPC 绑定的 Electron renderer；不要向桌面额外加入
Playwright 适配器或依赖。

源码、输入对象和独立打开的报告 UI 均保持原状。测试对比了导出前后的交互
窗口尺寸和原输入，并检查代码尾部、表格末行实际绘制、长代码换行与超高拒绝。

## 证据和验证

- 固定修订与引用：`snapshot-meta.json`；冻结输入：`fixtures.json`。
- 红测：`regression-red.log`，PDF/PNG 仍裁切、超高滚动代码未被拒绝。
- 绿测：`regression-green.log`，共享导出与 HTTP 回归 **18/18**。
- 真实 Electron：`electron-regression.log`，**15/15**。
- 空页红测：`print-reflow-red.log`，本应一页的打印内容生成四页。
- 最终共享导出 / HTTP 回归：`print-reflow-green.log`，**19/19**。
- 最终 Electron 回归：`print-reflow-electron.log`，**16/16**，增加打印重排、PNG 保持
  及实际尾部绘制检查。原并发中文用例额外核验全部 114 行；完整打印高度
  5,715px 可放入四页，不再沿用基于屏幕测量的旧“五页”下限。
- 修复前输出：`quant-methods-pdf/`、`quant-methods-png/`、
  `evidence-methods-pdf/`、`evidence-methods-png/`。
- 修复后输出及逐步测量：上述目录名称追加 `-fixed`；
  各目录 `result.json` 包含源码哈希、输入哈希、预算、尺寸、内存和产物哈希。
- 消除空页后的最终输出：目录名称追加 `-print-fixed`；这些结果替代
  `-fixed` 的 PDF。PNG 内容相同。
- 量化 PDF 的尾部内容证明：`quant-methods-pdf-fixed/pdf-proof.json`。
- Poppler 视觉核验：`quant-methods-pdf-fixed/page-13.png`（末尾来源）、
  `page-14.png`（空白末页）；PNG 最后一片包含方法、限制与来源。
- 语法及 `git diff --check` 通过。oxlint 仅报告三个现有测试警告：
  两处 utility worker callback 表达式，以及 fixture 解构 `_` 未使用。

最终量化 PDF / PNG 的采样私有占用峰值分别为 223,876 / 90,320 KiB。
证据报告在进入打印或截图前即按真实高度拒绝，峰值分别为
175,720 / 176,832 KiB。修复前证据 PDF 曾采到 424,556 KiB 短暂私有峰值，
但未与 250ms 看门狗采样重合；该看门狗是软监测，不是 OS 硬限。

## 复现

```powershell
node outputs/live-plugin-qa-methods-export-20261020/run.mjs new-attempt-name
```

每次使用新目录，固定输入不变。仅启动独立隐藏 Electron fixture。
不要重新运行快照采集脚本，也不要将修复前的截断输出当作合格交付。

部署由主任务执行。本目录未更改已安装应用。
