# 交互图集

本机预览路径为 `<本插件安装目录>/examples/chart-gallery.html`，在文件管理器双击，或通过浏览器的“打开文件”加载。这个完整离线演示可切换图形、主题，并用鼠标或键盘检查原始行。组件源码和演示数据均已内联，也可单独复制这份 HTML 后打开；编写报告时按需读取下列较小的资源即可。

| 图形 | 参数与数据语义 | 示例规格和虚构数据 | 独立组件源码 |
| --- | --- | --- | --- |
| waterfall、dumbbell、strip、histogram、boxplot、ridgeline、violin | `skills/report-design/statistical-charts.md` | `examples/statistical-fixtures.json` | `assets/charts-statistics.js` |
| calendar、parallel、bump、lifecycle | `skills/report-design/temporal-charts.md` | `examples/temporal-fixtures.json` | `assets/charts-temporal.js` |
| treemap、threads、flow、network-circular、network-force | `skills/report-design/structural-charts.md` | `examples/structural-fixtures.json` | `assets/charts-structure.js` |

每份 fixture 的 `charts` 数组包含图名、说明与 `spec`。这些值全是明确登记为 demo 的虚构样本，不能作为真实行情、账户或策略结论。

实际报告先取得固定数据，再调用 `report_template`，将所需字段映射与显示选项放入 `chart_options`；节点数组经 `chart_data` 读取固定绑定，不能把 fixture 的 `rows` 或 `nodes` 填进选项。保留原版 `reportKit` 的排版与自由布局，只添加有助于回答研究问题的图。

鼠标悬停或聚焦显示精确原值，点击或按 Enter / Space 联动数据明细。表格搜索只筛明细；平行坐标的维度过滤同时筛图和明细。图集切换时释放旧图实例，完整示例的构建源码为 `scripts/build-chart-gallery.mjs`。
