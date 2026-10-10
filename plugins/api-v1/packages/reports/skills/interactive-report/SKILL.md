---
name: interactive-report
description: 绑定实际固定数据，沿用原版 reportKit 与可选图表编写交互 HTML，发布不可变 report/1 revision 并检查真实渲染。
---

先确认实际已登记的 dataset、固定 DataRef 或 run/result：列名、单位、区间、时区、数据量及来源。更新时用 report_read 检查完整 ArtifactRef 和当前 revision，不能按标题猜身份或覆盖别的会话。

默认按 report-design 的原版 outline 用 reportKit.render 组织页面，按 report-writing 写可核对结论。report_template 生成可编辑的 HTML，内含插件自带样式与组件，不需要搭一套新页面。需要特殊图形、比较、参数探索或下钻时，使用 custom block 或组合组件；仍用原生 HTML/CSS/JS，不依赖外部运行时网络。

## 数据与初始化

已有 dataset 先 report_data 冻结，保留原始 decimal 字符串和 provenance。已有固定 DataRef 可直接加入 report_publish.data，binding 的 id 与 HTML 中完全一致。Demo 必须在页面及 provenance 中标明，不能改成实盘结果。

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

可用 reportKit 的原版趋势/面积/柱形/横条/散点/热图；需要真实计数或选点联动时，把 SesameCharts 的 units/matrix/可选点图放在 custom 中，与原版叙事共存。长表和方法默认折叠，用户仍能展开核对全部细节。不要让所有数据表挤占结论区。

Strategy 报告将真实策略、翻译、run、result 放入 report_publish.related，数值数据用 data 的固定引用。报告自己根据这些真实输入组织样本外表现、参数比较、权益、回撤与逐笔证据；不同后端可呈现各自数据。不存在隐式 MT5 backtest_ids 或自动注入的原生回测组件。没有完成回测时明确说明，不捏造收益。

## 发布与修复

用文件工具保存完整 HTML，资源本地打包，然后调用 report_publish（HTML ≤ 1 MiB，合计资源 ≤ 16 MiB），绑定 data 与 related。更新提供 artifact_id、expected_revision 和新 operation_id。只读桥可读取声明的数据/成果，不能访问 parent DOM、Node、磁盘、凭据或交易接口。

发布只固定内容。之后以返回完整 ref 调用 report_check，查看桌面/窄屏、数据请求、脚本和交互的实际 receipt。failed 时保留绑定、修 HTML 并发布新 revision，再检查；rendered 才是该版本通过渲染的依据。report_read.include_checks 可以核对历史，但旧 receipt 不能证明新版本成功。
