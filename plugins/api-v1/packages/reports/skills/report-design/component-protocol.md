# 通用组件工具

组件协议为 `sesame-components/1`，使用现有 Reports `document` 内容、固定数据引用和同一个渲染器。按数据关系选择图型：比较、时间变化、分布、关联、流量、层级以及布局均可使用，不限定研究领域或业务模板。

## 直接显示

已经知道要用什么组件时，直接调用 `components_show`：一个块填 `component`，一组块填 `components`，工具自动补齐现有 document 包装。无需先列目录、读规格或单独校验。多组件默认纵向排列，可传 `layout:"columns"` 并排；一次最多 12 个。完整排版仍可传原 `content`。

主 Agent 在简短回答中展示组件时设置 `target:"answer"`，相关多个组件合在一次调用中。省略 target 或设置 `target:"report"` 保持报告页面。answer 使用同一个 document 渲染器与固定发布流程，隐藏报告级标题和重复摘要、去掉页面外边距；组件自己的标题、标签、来源与明细交互保留。子 Agent 的 output 声明和报告交付规则不变，不能绕过 `output.type="none"`。

```json
{
  "operation_id": "demo-component-counts-v1",
  "title": "两组计数（演示）",
  "target": "answer",
  "provenance_kind": "demo",
  "component": {
    "type": "chart",
    "kind": "bar",
    "title": "组别计数",
    "columns": ["label", "value"],
    "options": { "x": "label", "y": "value" },
    "rows": [{ "label": "A", "value": 2 }, { "label": "B", "value": 4 }],
    "takeaway": "演示中 B 组计数较多",
    "source_note": "虚构软件演示，单位：个"
  }
}
```

`component`、`components`、`content` 三选一，show 还可选择完整固定 `input_ref`。`layout` 仅用于前两种便捷输入。`data` 省略时为 `[]`；有 data_id 时仍须提供真实固定绑定，不能用缺省值代替数据。

## 按需发现

1. `components_list({query?, category?, cursor?, limit?})` 返回简短用途索引。默认 20 项，最多 100 项；继续读取时使用返回的 cursor。
2. `components_describe({ids})` 接受 1–12 个索引 ID，返回当前公开 schema、最小样例、数据要求和组合位置。只读取本次需要的组件。样例里的数值都是演示数据。
3. 选中的块或图表 example 可直接填入 `component` 或 `components`；overview 等完整布局位置使用 `content`。组件 ID 用于目录发现，输入中仍使用 schema 声明的 `type`、图表 `kind` 和字段。

`whenToUse` 描述组件表达的数据关系。先判断需要比较大小、观察路径、看分布还是解释连接，再选择对应图型；它不要求执行任何特定分析方法。

## 只读校验

需要发布前诊断时，可选调用 `components_validate`。它接受 `component`、`components` 或 `content`，以及原始 `data`、`references`、`assets`、`style`、`target`、`title`、`summary`、`locale`、`provenance_kind`、`related`。省略 title 使用校验标题，summary 为空，data 为 `[]`，provenance_kind 为 `derived`，target 为 report。省略 locale 使用现有最宽语言限制；实际发布仍按宿主最终语言检查。

它复用公开 schema、目录中的具体图型 schema、服务端渲染器、现有 chartValue 字段校验及资产检查。固定图表数据通过原完整 DataRef 读取真实 `json-rows`，核对声明的列、图型必要选项及各图型行数上限（总上限 2500）；额外 nodes 也必须是声明的真实绑定。工作区附件复用只读路径检查，不登记资源、不写文件、不发布报告。

返回 `valid`、`status`、`diagnostics:[{path,message}]`、`protocol` 和 `coverage`。路径对应本工具参数，例如 `/component/options/x`、`/components/1`、`/content/sections/0/blocks/1`、`/assets/0/ref`。`status:"incomplete"` 表示资源读取等检查未能完成，不能解释为有效。未知组件、缺失数据列、脚本或 CSS 字段以及不安全资产均不能通过。

`valid:true` 只覆盖返回的静态与服务端检查；`coverage.browser` 始终为 `not_run`。它没有验证实际图表绘制、浏览器布局、交互或研究结论。发布后仍可对返回的固定报告调用 `report_check` 取得真实渲染检查。

## 发布与固定复用

`components_show` 的发布参数沿用 `report_publish`：`operation_id`、`title`、`provenance_kind` 必填，另提供一种组件输入；可选 `target`、`data`、`summary`、`locale`、`space`、`style`、`assets`、`references`、`related`、`artifact_id`、`expected_revision`。summary 省略时为空，data 默认为 `[]`。更新已有报告须保留原 artifact_id 并传当前 expected_revision。

`input_ref:{ref,entry}` 必须指向包含完整 `{content,style?,assets?,target?}` 的固定 application/json 输入，且 content 是本目录的 document；使用它时不再传 component/components/content/layout/style/assets/target，目标由固定输入决定。证据绑定仍放在外层。show 自动运行与 validate 相同的只读预检，再调用原发布入口；固定 input_ref 不会被改写。宿主按已配置提供者执行其必要检查、渲染、幂等与修订发布，调用方不能选择 provider。

结果保留真实宿主回执及 `ref`、`renderStatus`、`provider`、`presentation`，附带 `protocol`、实际 `renderer` 和 `componentRef:{ref,protocol,kind,inputDigest?}`。其中 ref 是本次固定报告，inputDigest 来自宿主；不会返回整份 HTML。来源和精确原值保留在固定输入与引用中；读者需要的明细可用正文原位的 details/table/attachments，不自动生成末尾附录。

`target:"answer"` 在发布前固化到 provider input，实际渲染结果的 `presentation.metadata` 为 `{layout:"unified",surface:"answer",protocol:"sesame-components/1"}`，回答端据这份固定成果决定展示；默认 report 保持 `{layout:"unified"}`。标记来自真实 provider 输出，不仅出现在工具回执中。本接口不声明 MCP Apps UI 资源，也不接收自行编写的 HTML、CSS 或脚本。
