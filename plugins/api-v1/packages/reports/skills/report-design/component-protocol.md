# 通用组件调用

报告与回答使用同一个 `components_show`，协议为 `sesame-components/1`。知道组件就直接调用，不要求先列目录、读取规格或校验。

```json
{
  "target": "answer",
  "provenance_kind": "demo",
  "component": {
    "type": "chart",
    "kind": "bar",
    "rows": [{ "类别": "A", "数量": 2 }, { "类别": "B", "数量": 4 }],
    "options": { "x": "类别", "y": "数量", "unit": "个" }
  }
}
```

这是演示数据，所以显式声明 demo。真实成果可继承固定数据的来源性质；没有可继承来源时按提交的派生内容记录，不代表已核验为直接行情或用户原话。

## 内容与目标

- 一个块用 `component`，一组块用 `components`，默认纵向；`layout:"columns"` 并排，最多 12 个。完整文档用 `content`。三者选一。
- `target:"answer"` 在助手回复中展示；省略或 `"report"` 为报告。相关组件合并在一次调用中。
- 图表需要 kind、rows 或 data_id、对应 options；columns 自动从真实数据推导。使用 data_id 时在外层 data 声明同名固定 DataRef。
- `title` 可选，省略时从已提供内容生成索引名称；`operation_id` 可选，普通 Agent/MCP 调用使用宿主的稳定调用标识。脱离宿主执行时显式提供操作标识。
- summary 仅用于报告列表；locale、space、style、assets、references、related 按需提供。没有需要就不填。
- 固定数据、引用与字节仍走原发布流程。子 Agent 的 output 与报告绑定规则不变，不能绕过 `output.type="none"`。

## 文字放哪里

| 信息 | 位置 |
| --- | --- |
| title | 组件或所属章节的一个标题，不重复命名 |
| 结论、理由、判断条件 | 正文、judgment 或可选的图前 takeaway，正常阅读字号 |
| 单位、时点、尺度、分母 | 对应轴、标签、图例或统一范围 |
| note / caption | 仅必要的就近解释；不再复述标题、结论或图例 |
| source_note、方法与原始记录 | 固定输入与引用，读者需要时显式使用原位 details |

takeaway/source_note 均可省略，不为填字段而生成文字。单元不提供任意字号、自由 HTML/CSS、脚本或新的注释位置；没有补充内容就只显示主体。

## 按需工具

- `components_list({query?,category?,cursor?,limit?})`：按比较、趋势、分布、关联、流量、层级等数据关系找组件。
- `components_describe({ids})`：读取 1–12 个选中组件的准确 schema 与最小样例。
- `components_validate(...)`：与 show 使用相同规范化与静态检查，返回定位到输入字段的 diagnostics；只读、不发布。它不替代实际浏览器视觉检查。

## 更新与固定复用

需要更新现有报告时使用 `artifact_id` 和 `expected_revision`；稳定重试可显式传 `operation_id`。`input_ref:{ref,entry}` 指向完整 `{content,style?,assets?,target?}` JSON，使用后不再从外部覆盖这些字段；固定输入不被改写。

show 自动校验后发布，返回固定 `ref` 和原宿主回执。实际渲染仍可用 `report_check` 检查。报告与回答共用一个渲染器；本接口不声明跨客户端 MCP Apps UI 能力。
