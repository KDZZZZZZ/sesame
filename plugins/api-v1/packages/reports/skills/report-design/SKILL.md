---
name: report-design
description: 设计带明确单位、缺失值、来源与可检查明细的原创离线 SVG 报告图表。
---

# 让图表解释证据

本插件 `assets/editorial.css` 与 `assets/editorial-charts.js` 是 MIT 的独立实现，零运行时依赖，采用系统字体。参考来源与非商业上游许可见 PROVENANCE.md；不可复制 lieflat-charts 的模板、代码、字体或资产进入 MIT 包。

使用 `SesameCharts.chart(element,{kind,rows,x,y,value,unit,title,onSelect})`，`SesameCharts.table(element,rows,columns)` 和 `SesameCharts.readRows(bindingId)`。report_template 已内联资产并接筛选、选择与明细。

- line：按明确时序展示变化。输入顺序决定横轴；null 断开曲线，不以零填补。
- bar：比较离散类别。柱形从零开始，正负值区分；单图控制类别数量。
- scatter：两个数值变量关系。注明 x/y 单位，关系不等于因果。
- matrix：两个分类维度交叉的数值。x/y/value 指定列；每格唯一，重复须事先聚合；缺失格保持空缺语义。
- units：非负整单位计数。`unitValue` 指定每点值，只接受精确整数倍，不四舍五入。超过 1,000 点时明确调整单位。

标题说清量、区间与范围；副标题给有证据的主要差异；来源注释注明精度、数据生成方式和缺失。视觉坐标采用 JS number，而表格和 tooltip 保留原字符串；不得据绘图坐标计算精确业务结果。

控制同时呈现的信息：一条主线与相关明细优先于堆叠卡片。图表不超过 2,500 条绘图记录；先明确聚合而非截掉尾部。表格默认显示 100 条并注明上限，筛选后检查明细。长列名、窄屏、键盘焦点、深浅主题、空状态均需实际检查。
