# 通用内容与样式组合

本指南的内容字段属于 sesame/reports。宿主选择其他提供者时遵循其 inputSchema，不套用本插件的组件或便利入口。

Report 的组件和样式按信息关系设计，可用于研究、策略、运营或其他报告。它们不绑定品种、指标、流派或特定分析插件。Agent 提供已有结果、精简判断和来源，Report 生成页面、图表、公式与末尾附录。

分项判断使用统一无框样式：文档内容为 `{type:"judgments",items:[...]}`，每项建议包含 `问题/判断/对象/期限/依据/改判条件/历史参照`；可用 `presentation` 调整直接属性映射。模块字段使用 `presentation.kind:"judgments"`。原生回测在 `strategy_evidence.judgments`、信号研究在 `content.presentation.judgments` 提供同样数组，原有图表和全部试验仍保留。样式不从收益数字推断态度，不计算分数或概率。超过适合展示的数量或映射不足时完整回退，未映射数据仍在附录。

先调用 `host.reports.describe` 查看宿主所选提供者及 inputSchema。此插件接受 `input:{content,style?,assets?,strategy_source?,strategy_evidence?}`；用 `host.reports.publish` 发布，Agent 不选择 provider。`report_publish` 只是同一宿主发布的便利转接。不需要先生成模板；helper 只用于预览。公开入口不接受 HTML、CSS、JavaScript 或自定义渲染函数。

连续数值指标应选择适合读者的显示精度，原精度保留在依据。模块的 `number`/`integer` 字段可设 `presentation: {"kind":"metric","digits":2}`，不填属性映射 `value`；默认沿用字段单位，数字仍绑定原值。对象指标继续使用 `value` 映射。该声明只格式化显示，不换算单位，也不要求所有价格或统计量采用同一精度。

## 一份通用文档

下面是可提交给 `host.reports.publish` 的完整演示参数。所有数字都是内联虚构展示数据，因此 `provenanceKind` 为 `demo`、`data` 为空；真实报告须绑定原始固定成果并保留实际引用，不能沿用演示数值或补造 DataRef。

```json
{
  "title": "演示 · 两组结果比较",
  "summary": "虚构数据展示判断、比较图与证据附录的组合。",
  "locale": "zh-CN",
  "space": "research",
  "data": [],
  "operationId": "demo-generic-document-v1",
  "provenanceKind": "demo",
  "input": {
    "content": {
      "kind": "document",
      "sections": [
        {
          "title": "比较结果",
          "blocks": [
            {
              "type": "judgment",
              "text": "B 组达到目标的记录更多。",
              "note": "比较范围为本次两组各 40 条演示记录。"
            },
            {
              "type": "group",
              "layout": "columns",
              "blocks": [
                {
                  "type": "metrics",
                  "items": [
                    {
                      "label": "A 组达标",
                      "value": "24 / 40"
                    },
                    {
                      "label": "B 组达标",
                      "value": "30 / 40"
                    }
                  ]
                },
                {
                  "type": "range",
                  "label": "B 组已提供的完成率",
                  "min": 0,
                  "max": 100,
                  "value": 75,
                  "unit": "%",
                  "note": "展示已有结果的比例，不代表未来发生概率。"
                }
              ]
            },
            {
              "type": "chart",
              "kind": "hbar",
              "title": "两组达标记录数",
              "columns": [
                "group",
                "count"
              ],
              "options": {
                "x": "group",
                "y": "count",
                "unit": "条",
                "digits": 0
              },
              "rows": [
                {
                  "group": "A 组",
                  "count": 24
                },
                {
                  "group": "B 组",
                  "count": 30
                }
              ],
              "takeaway": "B 组比 A 组多 6 条。",
              "source_note": "虚构演示汇总；两组分母均为 40，达标定义相同。"
            },
            {
              "type": "reasoning",
              "steps": [
                "两组使用相同分母和达标定义。",
                "已提供的汇总为 24 条与 30 条，差值为 6 条。",
                "本次比较支持 B 组达标记录更多这一描述。"
              ]
            }
          ]
        }
      ],
      "appendix": [
        {
          "type": "details",
          "title": "演示来源与计算口径",
          "blocks": [
            {
              "type": "paragraph",
              "text": "这些固定数值仅用于组件演示，无市场或预测含义。"
            },
            {
              "type": "formula",
              "latex": "r = \\frac{n_{\\mathrm{target}}}{n_{\\mathrm{total}}}",
              "caption": "比例定义；已有完成率为 75%，Report 不重新计算研究结果。",
              "display": "block"
            },
            {
              "type": "table",
              "columns": [
                "组别",
                "达标数",
                "总数"
              ],
              "rows": [
                [
                  "A 组",
                  24,
                  40
                ],
                [
                  "B 组",
                  30,
                  40
                ]
              ],
              "caption": "完整演示汇总"
            }
          ]
        }
      ]
    }
  }
}
```

可按用户需要删除或重排组件，不要求同时使用指标、区间、图表与推理。`scores` 适合展示来源已给出的量表；`range` 适合位置；`chart` 适合多项比较。两者都不产生新分数或指定指标。公式通过 `formula.latex` 渲染，不用上传 HTML 或展示英文函数串。

真实数据图将 `rows` 换为 `data_id`，并在 `data` 中加入对应的 `{id, ref, usage}`；ref 必须是实际发布且可读取的完整固定引用。原始明细、参数、来源和方法放 `details`，Report 把证据集中在末尾并生成往返锚点。

## 复用大型研究成果

已有研究运行可以使用 `content.kind: "signal-study"`。`run` 和 `run_source: {ref, entry: "run.json"}` 二选一；后者只读已发表成果中打包的固定 JSON，避免让 Agent 抄写完整运行记录。ref 必须同时在 `report_publish.references` 或 `data` 声明，不接受 HTML 作为运行来源，也不重新执行研究。可选 `presentation` 只承接已有总结、注解、标签和条件；不改原指标、试验或选择。

这一结果适配仍使用同一个通用 `style`。用户需要不同组件组合时可使用 document，不为不同工作流维护独立样式或指定计算方法。

## 统一排版

`report_styles` 返回统一默认、受支持组件及已保存用户样式。省略 `style` 使用同一套蓝灰、无框、留白排版，不选择预设。主图直接放正文，不套层层卡片。Agent 按信息关系使用 `group.layout: columns|stack` 组织并排或上下内容；深浅主题及公式渲染由 Report 统一处理。

正文只保留影响理解的验证提示。相同的 `validation.note` 或历史限制集中说明一次，不给每个事实重复同一句；完整方法、来源与逐项依据放末尾附录，各判断的真实验证状态和独有重要条件保持不变。

正文金额选合适的数量级并写明单位，显示名不用内部列名；能直观表达比较、范围或分布时优先使用现有内置图表，原始明细留在末尾附录。一句判断不在多个小标题下重复；不要求每个字段必须画图，用户可调整布局与表达方式。

## 完整 JSON 引用发布

长报告和含公式的内容先将整个 `input` 对象保存为 UTF-8 JSON，登记成含 `application/json` 附件的固定 ArtifactRef。随后向宿主提交原元数据、data/related/references 与 `inputRef:{ref,entry}`，不要重新抄写长 JSON。inputRef 与内联 input 严格二选一；便利入口使用 `input_ref`。文件内只放提供者 input，不包发布外壳，也不只放 content。所有原始数字、缺失、反斜杠和固定引用保持原样。

宿主记录确切输入及提供者版本并发布生成包。检查当前发布 ref 的渲染结果，还要将保存输入与准备稿逐项核对；rendered 不等于文字、公式或引用复制正确。

## 声明式扩展与复用

仅用户明确要求样式调整时，记录具体阅读需求并调整受控 token。下面的参数可直接提交给 `report_style_save`，它只保存样式，不修改报告内容。

```json
{
  "operation_id": "save-wide-comparison-v1",
  "id": "wide-comparison",
  "title": "宽幅比较",
  "description": "为并排比较和较长图例增加空间，保持蓝灰无框。",
  "expected_version": 0,
  "style": {
    "reason": "用户要求增加图宽与字号，便于阅读较长的比较标签。",
    "tokens": {
      "content_width": 1240,
      "body_size": 16,
      "section_gap": 48,
      "chart_height": 420,
      "columns": 2,
      "heading": "sans"
    }
  }
}
```

新建使用 `expected_version: 0`；更新同一 ID 时先读取当前版本，传该版本并使用新的 operation ID。相同 operation 的重试必须保持相同内容。发布时直接使用保存回执中的 `style`，例如首次保存返回版本 1 时：

```json
{
  "saved_id": "wide-comparison",
  "saved_version": 1
}
```

一次性扩展不必保存：将上面 `style` 定义放入发布参数的 `style.custom`，例如 `{custom: {reason, tokens}}`。不能同时选择 `custom` 与 `saved_id`；没有 base、preset、theme 或 density 选项。保存样式只改呈现，不改变数据、方法、量表或概率。

| token | 可接受值 |
|---|---|
| `content_width` | 整数 640–1440 |
| `body_size` | 整数 14–20 |
| `section_gap` | 整数 24–88 |
| `chart_height` | 整数 180–640 |
| `columns` | 整数 1–3 |
| `heading` | `serif` 或 `sans` |
| `accent`、`context` | 六位十六进制颜色，如 `#315f9b`、`#75808d` |
| `accent_dark`、`context_dark` | 深色主题对应的六位十六进制颜色 |

这些受控 token 覆盖常见调整，不接受任意 CSS、字体 URL、脚本或 HTML。样式需求超出当前 token 时，保留具体需求，使用现有组件完成可表达的内容；组件能力的产品扩展仍归 Report 插件。

发布后对当前完整 ref 调用 `report_check`。样式版本或内容变化均形成新报告修订，需要重新核验，不能复用旧版 rendered 回执。


## 盈亏与涨跌的颜色

统一蓝灰主题中，只有表达涨跌、收益或盈亏的内容使用红绿：涨或赚为绿，跌或亏为红，零值为灰。保留数值、负号和上下位置，不能只靠颜色。配色按指标种类决定，不按这批数据是否同时出现正负值决定：盈亏图全赚仍绿、全亏仍红；回撤、净值、估值、样本量和评分用普通蓝灰色阶。

- `chart.options.tone: "signed"`：ReportKit 的柱形、横条、热力图、折线、面积、散点按已有数值正负着色。回撤和净值省略 tone 或用 `"neutral"`，不会因正负分布改变颜色。只有明确把正数记为盈利额或亏损额时，才分别用 `"positive"` 或 `"negative"`；不将回撤归入此类。多系列用排列顺序、编号图例、折线虚实及悬停名称区分；颜色只表示财务方向。
- `metrics.items[].tone: "auto"`：值必须是数值；涨跌百分数或货币已经写成字符串时，明确选 `"positive"`、`"negative"` 或 `"neutral"`，不让样式从名称或文字猜测。
- `table.column_tones`：与列一一对应；普通列用 `null`，数值收益列用 `"auto"`，最大回撤列用 `null`。例如 `[null,"auto",null]` 对应名称、收益、回撤。零值及缺失值保持中性。

这些选项只表达已有结果，不改写正负号、精度或来源，不决定方法和结论。原生 K 线、回测盈亏热力图与报告沿用同一红绿约定，深浅主题自动更新。

普通比较依次交替使用蓝色色阶和主题反差的中性色阶：浅色主题用深灰/黑，深色主题用浅灰/白；多序列保持相同顺序，图例、线条和数据点同步。盈亏与涨跌的红绿优先，不把中性色替换成亏损色。
