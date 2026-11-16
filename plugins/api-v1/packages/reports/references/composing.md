# 组件与组合

components_list 按表达关系查目录；components_describe 返回准确 schema、何时用、数据要求及最小示例。38 种图表和 15 种内容块均可用，无需先选报告模板。

```js
components_show({ title: "结果比较", target: "report", provenance_kind: "demo", components: [
  { type: "paragraph", text: "演示：B 的数量是 A 的两倍。" },
  { type: "chart", kind: "bar", rows: [{item:"A",n:2},{item:"B",n:4}], options:{x:"item",y:"n"} }
] })
```

component 是单块，components 是最多 12 块的一组，layout 可选 stack/columns。长文档用 content:{kind:"document",sections:[{title:"",blocks:[...]}]}，空节标题不占一行。group 与 details 最多嵌套 5 层。没有必备首屏、摘要、情景树或附录。

按希望读者看出的关系选组件，而不是把长文写完再补配图：连续变化用 line/area，比较用 bar/hbar/dumbbell，范围内定位用 range/spectrum，增减贡献用 waterfall，两个连续变量的关联用 scatter。分布图提供已有观测、分箱或统计量，不代算统计。总量用组成图，连接用关系图，保留真实分母、单位、缺失与方向。

只有两个时期的数值就比较这两个时期，不补造趋势；只有区间就展示上下界和参照，不编造分布。先确认实际数据足以支持要表达的关系，再选图。共享同一单位和比较目标的数据可放在一图或并排组合；同一组数字不再逐项写成正文。

judgment 突出一句已有判断；judgments 接收 items:[{label,value,details?:[{label,value}]}]，不预设研究字段。logic 接收通用 nodes/edges，不解读策略或因子源码。decision-tree 分支表达条件，叶子只放结果。formula 使用 LaTeX。
