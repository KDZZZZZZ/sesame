---
name: interactive-report
description: 绑定实际固定数据，沿用原版 reportKit 与可选图表编写交互 HTML，发布不可变 report/1 revision 并检查真实渲染。
---

先确认实际已登记的 dataset、固定 DataRef 或 run/result：列名、单位、区间、时区、数据量及来源。更新时用 report_read 检查完整 ArtifactRef 和当前 revision，不能按标题猜身份或覆盖别的会话。

默认按 report-design 的原版 outline 用 reportKit.render 组织页面，按 report-writing 写可核对结论。report_template 生成可编辑的 HTML，内含插件自带样式与组件，不需要搭一套新页面。纯正文或决策说明使用 report_document_template({title,locale?,body_html,output_path})，复用相同 editorial 样式，不虚构图表或占位数据；body_html 中合法离线样式/交互保留，仍受发布检查与运行时沙箱约束。需要特殊图形、比较、参数探索或下钻时，使用 custom block 或组合组件；仍用原生 HTML/CSS/JS，不依赖外部运行时网络。

## 数据与初始化

已有 dataset 先按所属来源冻结：仅 host#datasets 中的宿主登记 ID 使用 report_data({operation_id,dataset_id})；MT5 等插件回执的 dataset_id 使用 report_data({operation_id,source:<原来源SourceRef>,input:{datasetId:<原ID>},title})，不传顶层 dataset_id。SourceRef 沿用目录中精确的 providerId/revision/binding，不能把插件 ID 当宿主 ID 或在失败后跨来源猜测。保留原始 decimal 字符串和 provenance。已有固定 DataRef 无需再冻结，可直接加入 report_publish.data，binding 的 id 与 HTML 中完全一致。Demo 必须在页面及 provenance 中标明，不能改成实盘结果。

`await reportKit.rows(bindingId)` 从 `window.report.readData` 读完 page.nextCursor，默认 50,000 行预算，拒绝重复 cursor。可显式传 `{maxRows}`（最多一百万），大型结果优先用有记录的聚合或自行分页。也可直接 `await window.report.readData(id,{cursor,limit})`。不能把第一页当全部，不按标题选数据，不能用旧 reportData.query。reportKit 是插件资产，先通过模板或资产内联加载；宿主不提供 reportI18n 或自动 backtest 组件。

```js
async function initialize() {
  const rows = await reportKit.rows('bound-data');
  // rows 来自固定输入，outline 的结论与图表必须与它一致。
  reportKit.render('#report', outlineFrom(rows));
}
window.report.track(initialize()).catch(error => {
  document.getElementById('report').textContent = error.message;
});
```

不要用 catch 返回空数组或虚构数值掩盖失败。异步数据或图表初始化交给 report.track，加载失败要能被报告检查记录。

## 交互与策略报告

筛选、比较、图例开关、缩放和逐笔检查操作固定输入。异步交互也交给 report.track。给控件可访问名称，键盘与窄屏可用。重新生成 chart 容器前，reportKit.destroy(container) 释放旧图；SesameCharts.chart 同一目标自动替换旧图，离开页面时可调用返回句柄的 destroy()。

可用 reportKit 的原版趋势/面积/柱形/横条/散点/热图；需要真实计数或选点联动时，把 SesameCharts 的 统计对照、分布、时序、结构和可选点图放在 custom 中，与原版叙事共存。长表和方法默认折叠，用户仍能展开核对全部细节。不要让所有数据表挤占结论区。

折叠和交互分页不会减少 PDF/图片静态导出时应呈现的完整内容，不能把当前页或裁切的滚动区域当作完整导出。报告内呈现关键证据和必要表格，完整原始 JSON、大结果通过固定数据引用或证据附件保留并在报告中引用，避免反复嵌入同一完整回执；发布前核对引用仍可追溯，检查导出内容与报告声明的范围一致。

Strategy 报告将真实策略、翻译、run、result 放入 report_publish.related，数值数据用 data 的固定引用。报告自己根据这些真实输入组织样本外表现、参数比较、权益、回撤与逐笔证据；不同后端可呈现各自数据。不存在隐式 MT5 backtest_ids 或自动注入的原生回测组件。没有完成回测时明确说明，不捏造收益。

## 发布与修复

先核对本次 Run 已绑定的报告交付位置。用户指定报告或路径时，须实际生成并发布报告；数据成果引用和聊天摘要不会出现在报告区，不能替代交付。若子任务绑定为 output.type="none"，将交付不匹配交回所属 Agent 处理，不擅自改绑。报告目录的预留文件或源码草稿也不代表已有固定发布；交付前通过报告文件与 Run 读取能力核对当前路径和状态。

用文件工具保存完整 HTML，资源本地打包，然后调用 report_publish（HTML ≤ 1 MiB，合计资源 ≤ 16 MiB），绑定 data 与 related。更新提供 artifact_id、expected_revision 和新 operation_id。只读桥可读取声明的数据/成果，不能访问 parent DOM、Node、磁盘、凭据或交易接口。

发布只固定内容。需要交付可浏览报告时，以返回完整 ref 调用 report_check，查看桌面/窄屏、数据请求、脚本和交互的实际 receipt。failed 时保留绑定、修 HTML 并发布新 revision，再检查；rendered 才是该版本通过渲染的依据。用户只要求发布或没有可用验收环境时，保留发布成功与渲染尚未验收这两个状态。report_read.include_checks 可以核对历史，但旧 receipt 不能证明新版本成功。

## 静态导出是独立能力

发布成功只固定内容，report_check 的 rendered 只证明交互视图通过检查，两者都不保证 PDF/PNG。report_publish 返回的 exportability.checked="source" 是廉价作者建议：candidateFormats 不是已验证格式，needs-render-check 不能写成导出成功。不在每次发布时盲目生成 PDF，也不因 PDF 限制拒绝全部有效交互报告。

需要静态交付时，用 report_export_check({ref}) 检查完整固定引用。它复用实际导出的隔离准备过程，返回 supportedFormats、逐格式 formats.status/reasons 和 limits，不生成文件，outputVerified 始终为 false。最终导出仍独立检查内容、布局和输出字节；检查与导出之间的运行时状态可能变化，不承诺输出相等。

- PDF 拒绝无法忠实复制的状态：开放或关闭的 shadow DOM、音视频/动画 SVG、没有 CSS 字体源的运行时 FontFace、移交的 canvas、未保留 drawing buffer 的 WebGL、非图像 blob 资源。保留原交互报告，或另写有依据的静态视图；不得静默删去/展平媒体后称完整导出。
- PNG 是静态屏幕视图，不保留交互或音频。导出会展开 details 和 reportKit 折叠行、展开表格/代码滚动区；任意自定义分页/筛选的未渲染数据不会自动补全。关键证据不能只放在当前未呈现的交互状态。
- 固定宽 1000px、完整高不超过 64000px、像素预算 64×1024×1024；PDF/PNG 合计输出最多 32 MiB。PNG 高于 16000px 时切成最多 8000px 高的页并一起下载。过大时按真实章节拆报告并保留固定来源，不截断或伪造全量。
- 多文件资源按包内路径保留；引号/无引号/实体编码/脚本动态 URL 都可能依赖原目录。不确定自包含时不要为美化路径移动文件。草稿仅支持自包含资源，依赖包的报告从固定发布版本检查与导出。
