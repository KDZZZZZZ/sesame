# 组件与组合

components_list 按表达关系查目录；components_describe 返回准确 schema、何时用、数据要求及最小示例。38 种图表和 15 种内容块均可用，无需先选报告模板。

```js
components_show({ title: "结果比较", target: "report", provenance_kind: "demo", components: [
  { type: "paragraph", text: "演示：B 的数量是 A 的两倍。" },
  { type: "chart", kind: "bar", rows: [{item:"A",n:2},{item:"B",n:4}], options:{x:"item",y:"n"} }
] })
```

component 是单块，components 是最多 12 块的一组，layout 可选 stack/columns。长文档用 content:{kind:"document",sections:[{title:"",blocks:[...]}]}，空节标题不占一行。group 与 details 最多嵌套 5 层。没有必备首屏、摘要、情景树或附录。

连续变化用 line/area，比较用 bar/hbar，范围内定位用 range/spectrum。分布图提供已有观测、分箱或统计量，不代算统计。总量用组成图，连接用关系图，保留真实分母、单位、缺失与方向。

judgment 突出一句已有判断；judgments 接收 items:[{label,value,details?:[{label,value}]}]，不预设研究字段。logic 接收通用 nodes/edges，不解读策略或因子源码。decision-tree 分支表达条件，叶子只放结果。formula 使用 LaTeX。
